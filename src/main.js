// =====================
// Dice RPG Boardgame v4
// - マスを日本語表記
// - マスを大きく
// - ツールチップ即表示（自作）
// - 手番終了は「次へ」ボタン式（読めるように）
// - 戦闘結果は短く・自分→敵の順で見える（敵行動は少し遅らせる）
// - プレイ中もホームに戻れる
// =====================
const APP_VERSION = "0.1.0";

const $ = (id) => document.getElementById(id);

const DATA_PATHS = {
  board: "data/board.json",
  jobs: "data/jobs.json",
  skills: "data/skills.json",
  items: "data/items.json",
  equipment: "data/equipment.json",
  events: "data/events.json",
  treasure: "data/treasure.json",
  monsters: "data/monsters.json",
  bosses: "data/bosses.json",
};

const TYPE_JA = {
  START: "スタート",
  MONSTER: "モンスター",
  EVENT: "イベント",
  SAFE: "セーフ",
  BOSS: "ボス",
  RETURN: "帰還", // ★追加
};

const RETURN_POS = 23; // ★追加：マス#23（0始まりの #23）
let BOSS_POS = -1;     // ★追加：ボスマス位置（起動時に確定）


let RESULT_DELAY_MS = 650; // 自分の行動→敵の行動の間の待ち（見やすさ）

let DATA = null;
let state = null;

// ---------- utils ----------
function hpMpClass(cur, max) {
  const c = Number(cur ?? 0);
  const m = Number(max ?? 0);
  if (m <= 0) return "";
  const r = c / m;

  if (r <= 0.2) return "danger"; // 20%以下
  if (r <= 0.5) return "warn";   // 50%以下
  return "";
}

function fmtSigned(n) {
  n = Number(n || 0);
  return (n >= 0 ? `+${n}` : `${n}`);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function rollD6() { return (Math.random() * 6 | 0) + 1; }

function parseExpr(expr) {
  const m = /^(\d+)d6(?:\+(\d+))?$/.exec(String(expr).trim());
  if (!m) throw new Error("Bad dice expr: " + expr);
  return { n: Number(m[1]), mod: m[2] ? Number(m[2]) : 0 };
}
function buildExpr(n, mod) {
  const m = mod ? `+${mod}` : "";
  return `${n}d6${m}`;
}
function expectedExpr(expr) {
  const { n, mod } = parseExpr(expr);
  return n * 3.5 + mod;
}
function rollExpr(expr, opts = {}) {
  const { n, mod } = parseExpr(expr);
  const rolls = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let r = opts.overrideDie ?? rollD6();
    if (opts.minDie != null) r = Math.max(r, opts.minDie);
    rolls.push(r);
    sum += r;
  }
  return { total: sum + mod, rolls, mod };
}
function adjustDiceExpr(expr, delta) {
  const { n, mod } = parseExpr(expr);
  const nn = Math.max(1, n + (delta || 0));
  return buildExpr(nn, mod);
}
function fmtRollShort(roll) {
  const a = `[${roll.rolls.join(",")}]`;
  const m = roll.mod ? `+${roll.mod}` : "";
  return `${a}${m}=${roll.total}`;
}
function escapeAttr(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function jobName(jobId) { return DATA.jobs[jobId]?.name ?? jobId; }
function tileTypeAt(pos) { return DATA.board.tiles[pos]; }
function tileTypeJa(type) { return TYPE_JA[type] ?? type; }

// ---------- UI messages ----------
function setActionInfo(text) {
  state.ui.actionInfo = text;
  const el = $("actionInfo");
  if (el) el.textContent = text;
}
function setBattleInfo(text) {
  state.ui.battleInfo = text;
  const el = $("battleInfo");
  if (el) el.textContent = text;
}
function appendBattleInfo(more) {
  const cur = state.ui.battleInfo || "";
  const next = cur ? (cur + "\n\n" + more) : more;
  setBattleInfo(next);
}

// ---------- log ----------
function logLine(text) {
  state.log.push(text);
  if (state.log.length > 400) state.log.shift();
  renderLog();
}

function canUseDragEquip() {
  if (!state) return false;
  if (state.battle) return false;
  if (state.awaitingContinue) return false;
  if (state.awaitingChoice) return false;
  if (state.pendingSkillChoice) return false;
  return true;
}

function initEquipDnD() {
  // dragstart
  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest("[data-dnd-gear='1']");
    if (!el) return;
    if (!canUseDragEquip()) { e.preventDefault(); return; }

    const gearId = el.dataset.gear;
    const from = el.dataset.from; // "bag" or "slot"
    if (!gearId) { e.preventDefault(); return; }

    state.ui.drag = {
      playerIndex: state.turn.playerIndex,
      from,
      gearId,
      idx: (from === "bag") ? Number(el.dataset.idx) : null,
      slot: (from === "slot") ? String(el.dataset.slot) : null,
    };

    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify(state.ui.drag));
    } catch {}
  });

  // dragover（drop許可）
  document.addEventListener("dragover", (e) => {
    const zone = e.target.closest("[data-drop-target]");
    if (!zone) return;
    if (!canUseDragEquip()) return;

    // drop可能にする
    e.preventDefault();
    zone.classList.add("dndHover");
  });

  // dragleave（見た目戻す）
  document.addEventListener("dragleave", (e) => {
    const zone = e.target.closest("[data-drop-target]");
    if (!zone) return;
    zone.classList.remove("dndHover");
  });

  // drop（実処理）
  document.addEventListener("drop", (e) => {
    const zone = e.target.closest("[data-drop-target]");
    if (!zone) return;

    zone.classList.remove("dndHover");
    if (!canUseDragEquip()) return;

    let drag = state.ui.drag;
    try {
      const txt = e.dataTransfer.getData("text/plain");
      if (txt) drag = JSON.parse(txt);
    } catch {}

    if (!drag) return;
    if (drag.playerIndex !== state.turn.playerIndex) return; // 手番変わったら無効

    const p = currentPlayer();
    const gear = DATA.equipmentById[drag.gearId];
    if (!gear) return;

    const targetType = zone.dataset.dropTarget; // "slot" or "bag"

    // ---- drop to slot（装備する/入替）----
    if (targetType === "slot") {
      const targetSlot = String(zone.dataset.slot);

      // スロット不一致は拒否
      if (gear.slot !== targetSlot) {
        setActionInfo(`この装備は「${slotName(gear.slot)}」枠です。\n「${slotName(targetSlot)}」には装備できません。`);
        state.ui.drag = null;
        renderAll();
        return;
      }

      // 1) from bag → slot
      if (drag.from === "bag") {
        const idx = drag.idx;
        if (idx == null || idx < 0 || idx >= p.gearBag.length) return;

        // バッグから外す
        p.gearBag.splice(idx, 1);

        // 付け替えなら今の装備をバッグへ
        const cur = p.equip[targetSlot];
        if (cur) p.gearBag.push(cur);

        // 装備
        p.equip[targetSlot] = drag.gearId;

        logLine(`${p.id} DnD装備：${slotName(targetSlot)} → 「${gear.name}」`);
        setActionInfo(`装備変更：${slotName(targetSlot)} → ${gear.name}\n${gear.desc ?? ""}`.trim());
        state.ui.drag = null;
        renderAll();
        return;
      }

      // 2) from slot → slot（スロット間移動は基本同種なので発生しにくいが保険）
      if (drag.from === "slot") {
        const fromSlot = String(drag.slot);
        if (!fromSlot) return;
        if (fromSlot === targetSlot) return;

        // 同種装備以外なら拒否（本来 gear.slot===targetSlot なのでここは通る）
        if (gear.slot !== targetSlot) {
          setActionInfo(`この装備は「${slotName(gear.slot)}」枠です。`);
          state.ui.drag = null;
          renderAll();
          return;
        }

        const curTarget = p.equip[targetSlot];
        p.equip[targetSlot] = drag.gearId;
        p.equip[fromSlot] = curTarget || null;

        logLine(`${p.id} DnD入替：${slotName(fromSlot)} ↔ ${slotName(targetSlot)}`);
        setActionInfo(`装備を入れ替えました。`);
        state.ui.drag = null;
        renderAll();
        return;
      }
    }

    // ---- drop to bag（外す）----
    if (targetType === "bag") {
      if (drag.from === "slot") {
        const fromSlot = String(drag.slot);
        if (!fromSlot) return;
        if (p.equip[fromSlot] !== drag.gearId) return;

        p.equip[fromSlot] = null;
        p.gearBag.push(drag.gearId);

        logLine(`${p.id} DnD解除：${slotName(fromSlot)} → バッグへ`);
        setActionInfo(`装備を外しました：${slotName(fromSlot)} → バッグ`);
        state.ui.drag = null;
        renderAll();
        return;
      }
      // bag→bag は何もしない（並べ替えしたいなら次ステップで追加可能）
    }
  });
}

// ---------- 自作ツールチップ ----------
function setupTooltip() {
  const tip = $("tooltip");
  let current = null;

  document.addEventListener("mousemove", (e) => {
    if (!current) return;
    tip.style.left = (e.clientX + 12) + "px";
    tip.style.top  = (e.clientY + 12) + "px";
  });

  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    current = t;
    tip.textContent = t.dataset.tip || "";
    tip.classList.remove("hidden");
  });

  document.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    if (current === t) current = null;
    tip.classList.add("hidden");
  });
}

// ---------- equipment helpers ----------
function playerAtkFlatInBattle(p) {
  let v = playerAtkFlat(p);
  if (state?.battle && currentPlayer() === p) v += Number(state.battle.playerMods?.atkFlat ?? 0);
  return v;
}
function playerDefFlatInBattle(p) {
  let v = playerDefFlat(p);
  if (state?.battle && currentPlayer() === p) v += Number(state.battle.playerMods?.defFlat ?? 0);
  return v;
}

const EQUIP_SLOTS = ["weapon", "armor", "accessory"];

function equippedGearIds(p) {
  return EQUIP_SLOTS.map(s => p.equip[s]).filter(Boolean);
}

// ★追加：装備によるスキル補正（全スキルに適用）
function equipSkillMpCostDelta(p) {
  return sumEquip(p, "mpCost"); // 例：-1, -2 ...
}
function equipSkillCtDelta(p) {
  return sumEquip(p, "ct");     // 例：-1 ...
}

function sumEquip(p, key) {
  let sum = 0;
  for (const id of equippedGearIds(p)) {
    const g = DATA.equipmentById[id];
    if (!g) continue;
    sum += (g.effects?.[key] ?? 0);
  }
  return sum;
}
function playerAtkExpr(p) {
  return adjustDiceExpr(p.atkExpr, sumEquip(p, "atkDice") + (p.atkDiceBonus || 0));
}
function playerDefExpr(p) {
  return adjustDiceExpr(p.defExpr, sumEquip(p, "defDice") + (p.defDiceBonus || 0));
}
function playerAtkFlat(p) {
  const temp = (state && state.battle && currentPlayer() === p) ? (state.battle.playerTempAtkFlat ?? 0) : 0;
  return (p.atkFlatBonus ?? 0) + sumEquip(p, "atkFlat") + temp;
}
function playerDefFlat(p) {
  const temp = (state && state.battle && currentPlayer() === p) ? (state.battle.playerTempDefFlat ?? 0) : 0;
  return (p.defFlatBonus ?? 0) + sumEquip(p, "defFlat") + temp;
}


function slotName(slot) {
  if (slot === "weapon") return "武器";
  if (slot === "armor") return "防具";
  return "装飾";
}

function addGearToBag(p, gearId) { p.gearBag.push(gearId); }
function autoEquipIfEmpty(p, gearId) {
  const g = DATA.equipmentById[gearId];
  if (!g) return false;

  const slot = g.slot;
  if (!EQUIP_SLOTS.includes(slot)) return false;

  // 空なら自動装備
  if (!p.equip[slot]) {
    p.equip[slot] = gearId;

    // ★すでにバッグに入っている分を1個だけ取り除く（重複防止）
    const idx = p.gearBag.indexOf(gearId);
    if (idx >= 0) p.gearBag.splice(idx, 1);

    return true;
  }
  return false;
}


function equipTooltip(gearId) {
  const g = DATA.equipmentById[gearId];
  if (!g) return "";
  const e = g.effects || {};
  const lines = [
    `${g.name}`,
    `枠：${slotName(g.slot)}`,
    `効果：${g.desc}`,
    `----`,
    `ATKダイス:${e.atkDice ?? 0} / ATK固定:${e.atkFlat ?? 0}`,
    `DEFダイス:${e.defDice ?? 0} / DEF固定:${e.defFlat ?? 0}`,
    `スキルMP:${e.mpCost ?? 0} / スキルCT:${e.ct ?? 0}`,
  ];
  return lines.join("\n");
}

function equipFromBagByIndex(p, idx) {
  const gearId = p.gearBag[idx];
  if (!gearId) return;
  const g = DATA.equipmentById[gearId];
  if (!g) return;

  const slot = g.slot;
  const currently = p.equip[slot];

  if (currently) {
    const yes = confirm(`「${g.name}」を ${slotName(slot)} に装備します。\n今の装備「${DATA.equipmentById[currently].name}」はバッグに戻ります。OK？`);
    if (!yes) return;
    p.gearBag.push(currently);
  }

  p.equip[slot] = gearId;
  p.gearBag.splice(idx, 1);
  logLine(`${p.id} 装備変更：${slotName(slot)} → 「${g.name}」`);
  setActionInfo(`装備変更：${slotName(slot)} → ${g.name}\n${g.desc}`);
}

function openEquipManager() {
  const p = currentPlayer();
  if (state.battle || state.awaitingContinue || state.awaitingChoice) return;


  if (p.gearBag.length === 0) {
    alert("バッグに装備がありません。");
    return;
  }

  const eqW = p.equip.weapon ? DATA.equipmentById[p.equip.weapon].name : "なし";
  const eqA = p.equip.armor ? DATA.equipmentById[p.equip.armor].name : "なし";
  const eqX = p.equip.accessory ? DATA.equipmentById[p.equip.accessory].name : "なし";

  const list = p.gearBag.map((id, i) => {
    const g = DATA.equipmentById[id];
    return `${i + 1}) [${slotName(g.slot)}] ${g.name}  (${g.desc})`;
  }).join("\n");

  const ans = prompt(
    `装備変更\n装備中:\n武器: ${eqW}\n防具: ${eqA}\n装飾: ${eqX}\n\nバッグ:\n${list}\n\n装備したい番号を入力（0でやめる）`,
    "1"
  );

  const n = Number(ans);
  if (!n || n <= 0) return;

  const idx = n - 1;
  if (idx < 0 || idx >= p.gearBag.length) return;

  equipFromBagByIndex(p, idx);
  renderAll();
}

// ---------- init / load ----------
async function loadAllData() {
  const entries = await Promise.all(Object.entries(DATA_PATHS).map(async ([k, path]) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return [k, await res.json()];
  }));
  const d = Object.fromEntries(entries);

  d.skillsById = {};
  d.skills.forEach(s => d.skillsById[s.id] = s);
  d.skillsByJob = {};
  d.skills.forEach(s => {
    if (!d.skillsByJob[s.job]) d.skillsByJob[s.job] = [];
    d.skillsByJob[s.job].push(s.id);
  });

  d.itemsById = {};
  d.items.items.forEach(it => d.itemsById[it.id] = it);

  d.equipmentById = {};
  d.equipment.gear.forEach(g => d.equipmentById[g.id] = g);

  return d;
}

// ---------- decks ----------
function buildTreasureDeck() {
  const draw = [];
  for (const [k, count] of Object.entries(DATA.treasure.counts)) {
    for (let i = 0; i < count; i++) draw.push(Number(k));
  }
  shuffle(draw);
  return { draw, discard: [] };
}
function drawTreasureBase() {
  const deck = state.decks.treasure;
  if (deck.draw.length === 0) { deck.draw = shuffle(deck.discard); deck.discard = []; }
  const v = deck.draw.pop();
  deck.discard.push(v);
  return v;
}
function buildSkillDeckAll() {
  const all = DATA.skills.map(s => s.id);
  return { draw: shuffle([...all]), discard: [] };
}
// ★追加：条件に合うスキルIDを山札からランダムに1枚引く（見つからなければnull）
function drawSkillByPredicate(predFn) {
  const deck = state.decks.skill;

  const pickFromDraw = () => {
    const idxs = [];
    for (let i = 0; i < deck.draw.length; i++) {
      const id = deck.draw[i];
      if (predFn(id)) idxs.push(i);
    }
    if (idxs.length === 0) return null;

    const idx = idxs[(Math.random() * idxs.length) | 0];
    const pick = deck.draw[idx];
    deck.draw.splice(idx, 1);
    deck.discard.push(pick);
    return pick;
  };

  // 1回目
  let got = pickFromDraw();
  if (got) return got;

  // 条件に合うものが draw に無いなら、discard を混ぜて再抽選
  if (deck.discard.length > 0) {
    deck.draw = shuffle([...deck.draw, ...deck.discard]);
    deck.discard = [];
    got = pickFromDraw();
    if (got) return got;
  }

  return null;
}

function drawSkillFromJob(jobId) {
  return drawSkillByPredicate((id) => DATA.skillsById[id]?.job === jobId);
}
// ★追加：自職以外のスキルを引く
function drawSkillFromOtherJobs(myJobId) {
  return drawSkillByPredicate((id) => DATA.skillsById[id]?.job !== myJobId);
}

// ★追加：完全ランダム（職不問）で引く
function drawSkillAny() {
  return drawSkillByPredicate(() => true);
}

// ★追加：LvUP用の抽選（他職混ざる）
function drawSkillForLevelUp(p) {
  return drawSkillAny();
}



function buildItemDeck() {
  const ids = DATA.items.items.map(it => it.id);
  return { draw: shuffle([...ids]), discard: [] };
}
function drawItem() {
  const deck = state.decks.item;
  if (deck.draw.length === 0) { deck.draw = shuffle(deck.discard); deck.discard = []; }
  const id = deck.draw.pop();
  deck.discard.push(id);
  return id;
}
function buildEquipDeck() {
  const ids = DATA.equipment.gear.map(g => g.id);
  return { draw: shuffle([...ids]), discard: [] };
}
function drawGear() {
  const deck = state.decks.equip;
  if (deck.draw.length === 0) { deck.draw = shuffle(deck.discard); deck.discard = []; }
  const id = deck.draw.pop();
  deck.discard.push(id);
  return id;
}

// ---------- game setup ----------
function buildJobSelectors() {
  const root = $("jobSelectors");
  root.innerHTML = "";

  const count = Number($("playersCount").value);
  const jobIds = Object.keys(DATA.jobs);

  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <label>P${i+1}</label>
      <select id="jobSel_${i}"></select>
    `;
    root.appendChild(row);

    const sel = row.querySelector("select");
    jobIds.forEach(j => {
      const opt = document.createElement("option");
      opt.value = j;
      opt.textContent = DATA.jobs[j].name;
      sel.appendChild(opt);
    });
  }

  const updateDisable = () => {
    const chosen = new Set();
    for (let i = 0; i < count; i++) chosen.add($(`jobSel_${i}`).value);

    for (let i = 0; i < count; i++) {
      const sel = $(`jobSel_${i}`);
      const my = sel.value;
      Array.from(sel.options).forEach(opt => {
        opt.disabled = (opt.value !== my) && chosen.has(opt.value);
      });
    }
  };

  for (let i = 0; i < count; i++) $(`jobSel_${i}`).addEventListener("change", updateDisable);
  updateDisable();
}

function initPlayer(pid, jobId) {
  const j = DATA.jobs[jobId];
  const hpMax = rollExpr(j.base.hp).total;
  const mpMax = rollExpr(j.base.mp).total;

  return {
    id: pid,
    job: jobId,
    pos: 0,
    depth: 1,

    level: 1,
    exp: 0,

    growthDice: 0,     // レベルアップで貰う「成長ダイス」の残り
    atkDiceBonus: 0,   // ATKのダイス数+（レベルアップ分）
    defDiceBonus: 0,   // DEFのダイス数+（レベルアップ分）


    hpMax, mpMax,
    hp: hpMax,
    mp: mpMax,

    atkExpr: j.base.atk,
    defExpr: j.base.def,

    atkFlatBonus: 0,
    defFlatBonus: 0,

    bankGold: 0,
    bagTreasure: [],
    items: [],

    equip: { weapon: null, armor: null, accessory: null },
    gearBag: [],

    skillsEquipped: [],
    skillCT: {},

    skipNextTileEffect: false,

        // 次の戦闘だけ有効な固定値補正（イベント用）
    nextBattleAtkFlatMod: 0,
    nextBattleDefFlatMod: 0,

    winOnceUsedThisDive: false,

  };
}

function startGame() {
  const playersCount = Number($("playersCount").value);
  const roundsTotal = Number($("roundsTotal").value);
  const timerEnabled = $("timerEnabled").value === "true";

  const players = [];
  for (let i = 0; i < playersCount; i++) {
    const jobId = $(`jobSel_${i}`).value;
    players.push(initPlayer(`P${i+1}`, jobId));
  }

  state = {
    settings: { playersCount, roundsTotal, timerEnabled },
    turn: { round: 1, playerIndex: 0 },
    decks: {
      treasure: buildTreasureDeck(),
      skill: buildSkillDeckAll(),
      item: buildItemDeck(),
      equip: buildEquipDeck(),
    },
    battle: null,
    log: [],
    ui: { actionInfo: "", battleInfo: "", drag: null },

    // 手番を止める仕組み
    awaitingContinue: null, // { label, enabled, token, cb }

    // ★追加：選択ボタン待ち（confirm/prompt置換用）
    awaitingChoice: null,   // { message, options:[{label, className, tip, disabled, onClick}] }

    afterGrowth: null, // 例："endTurn" / "bossReturn"

    pendingSkillChoice: null,  // { playerIndex, newSkillId }
    levelUpSkillFlow: null,    // { playerIndex, remaining, doneCb }
      
  };

  state.players = players;

  // 初期スキル：自職から
for (const p of state.players) {
  const need = Number(DATA.jobs[p.job].startSkillCount ?? 0);
  for (let k = 0; k < need; k++) {
    const sid = drawSkillFromJob(p.job); // ★初期は自職限定
    if (!sid) break;
    if (p.skillsEquipped.length < 3) {
      p.skillsEquipped.push(sid);
      p.skillCT[sid] = 0;
    }
  }
}
  // 初期：財宝/アイテム/装備
  for (const p of state.players) {
    const base = drawTreasureBase();
    const value = base * p.depth;

    const it = drawItem();
    p.items.push(it);

    const gearId = drawGear();
    addGearToBag(p, gearId);
    const equipped = autoEquipIfEmpty(p, gearId);

    logLine(`${p.id} 初期：財宝${value}G / アイテム「${DATA.itemsById[it].name}」`);
    const g = DATA.equipmentById[gearId];
    logLine(`${p.id} 初期：装備「${g.name}」入手（${equipped ? "自動装備" : "バッグへ"}）`);
  }

  $("setup").classList.add("hidden");
  $("game").classList.remove("hidden");

  logLine("=== ゲーム開始 ===");
  setActionInfo("ゲーム開始！\nまずは移動（1d6）して進もう。");
  beginPlayerTurn();
  renderAll();
}
function showChoice(message, options) {
  // message は actionInfo に出す（3.A）
  if (message) setActionInfo(message);

  state.awaitingChoice = { message, options };
  renderAll();
}

function clearChoice() {
  state.awaitingChoice = null;
  renderAll();
}

// ---------- “次へ”で止める ----------
function waitContinue(label, cb, delayMs = 450) {
  const token = ((state._continueToken ?? 0) + 1);
  state._continueToken = token;

  state.awaitingContinue = { label, cb, enabled: false, token };
  renderAll();

  setTimeout(() => {
    if (!state) return;
    if (!state.awaitingContinue) return;
    if (state.awaitingContinue.token !== token) return;
    state.awaitingContinue.enabled = true;
    renderAll();
  }, delayMs);
}

// ---------- turn flow ----------
function currentPlayer() { return state.players[state.turn.playerIndex]; }

function beginPlayerTurn() {
  const p = currentPlayer();

  // MP+1
  p.mp = Math.min(p.mpMax, p.mp + 1);

  // CT-1
  for (const sid of p.skillsEquipped) {
    p.skillCT[sid] = Math.max(0, (p.skillCT[sid] ?? 0) - 1);
  }

  logLine(`--- ${p.id}(${jobName(p.job)}) の手番 / Round ${state.turn.round} ---`);
  setActionInfo(`${p.id} の手番です。\n「移動（1d6）」を押してください。`);
  setBattleInfo("");
  renderAll();
}

function endTurn() {
  state.awaitingContinue = null;

  state.turn.playerIndex++;
  if (state.turn.playerIndex >= state.settings.playersCount) {
    state.turn.playerIndex = 0;
    state.turn.round++;
    if (state.turn.round > state.settings.roundsTotal) {
      finishGame();
      return;
    }
  }
  beginPlayerTurn();
}

function doGoHomeNow() {
  state = null;
  $("game").classList.add("hidden");
  $("setup").classList.remove("hidden");
  $("log").textContent = "";
  $("battlePanel").innerHTML = "";
  $("playerInfo").innerHTML = "";
  $("actionButtons").innerHTML = "";
  $("actionInfo").textContent = "ホームに戻りました。";
  buildJobSelectors();
}

function goHome() {
  if (!state) return;

  // 何か待ちの最中ならまず止める（好みで）
  if (state.awaitingContinue) return;

  showChoice("ホームに戻ります。\n今のゲームは終了します。よろしいですか？", [
    {
      label: "はい（終了して戻る）",
      className: "btn primary",
      onClick: () => {
        clearChoice();
        doGoHomeNow();
      }
    },
    {
      label: "いいえ（続ける）",
      className: "btn",
      onClick: () => {
        clearChoice();
        setActionInfo("キャンセルしました。");
        renderAll();
      }
    }
  ]);
}


function finishGame() {
  renderAll();

  const results = state.players.map(p => {
  const bag = p.bagTreasure.reduce((a,b)=>a+b, 0);
  const total = p.bankGold + bag;
  return {
    id: p.id,
    job: jobName(p.job),
    bank: p.bankGold,
    bag,
    total
  };
}).sort((a,b)=>b.total-a.total);


  logLine("=== ゲーム終了 ===");

  // ★ここから追加：ソロ用の終了表示
  if (state.players.length === 1) {
    const r = results[0];
    logLine(`ソロ結果: ${r.id}(${r.job}) 合計=${r.total}G（確定=${r.bank} / バッグ=${r.bag}）`);
    setActionInfo(`探索終了！\n${r.id}（${r.job}）\n最終スコア：${r.total}G\n（確定${r.bank} / バッグ${r.bag}）`);

    $("battlePanel").innerHTML = "";
    $("actionButtons").innerHTML = "";
    return; // ★ここで終わり（順位表示の処理に進まない）
  }
  // ★追加ここまで

  // 複数人のときは今まで通り順位を出す
  results.forEach((r, i) =>
  logLine(`${i+1}位: ${r.id}(${r.job}) 合計=${r.total}G（確定=${r.bank} / バッグ=${r.bag}）`)
);


  setActionInfo("ゲーム終了！\nログに順位が出ています。");
  $("battlePanel").innerHTML = "";
  $("actionButtons").innerHTML = "";
}

// ---------- movement ----------
function moveRoll() {
  const p = currentPlayer();
    if (state.battle || state.awaitingContinue || state.awaitingChoice) return;
  const oldPos = p.pos;
  const r = rollD6();

// ★強制停止候補（帰還ポイント + ボス）
const stops = new Set([RETURN_POS, BOSS_POS].filter(v => v >= 0));

let newPos = oldPos;
let forced = false;
for (let i = 0; i < r; i++) {
  newPos = (newPos + 1) % 40;

  // 通過したらそこで止まる（すり抜け不可）
  if (newPos !== oldPos && stops.has(newPos)) {
    forced = true;
    break;
  }
}

// 深度増加（0をまたいだら増える。r<=6なので final比較でOK）
if (newPos < oldPos) {
  p.depth += 1;
  logLine(`${p.id} 深度+1 → 深度${p.depth}`);
}

p.pos = newPos;

const type = (p.pos === RETURN_POS) ? "RETURN" : tileTypeAt(p.pos);
const forcedReason =
  (forced && p.pos === BOSS_POS) ? " ※ボスで強制停止" :
  (forced && p.pos === RETURN_POS) ? " ※帰還ポイントで強制停止" :
  (forced ? " ※強制停止" : "");

logLine(`${p.id} 移動: 1d6=${r} → マス${p.pos}(${tileTypeJa(type)})${forcedReason}`);
setActionInfo(`移動：1d6=${r}\n→ マス${p.pos}（${tileTypeJa(type)}）${forcedReason ? "\n" + forcedReason.trim() : ""}`);



resolveTile({ chain: 0 });

}

function applyNonMonsterCTBonus(p) {
  for (const sid of p.skillsEquipped) {
    p.skillCT[sid] = Math.max(0, (p.skillCT[sid] ?? 0) - 1);
  }
}

function resetAllSkillCT(p) {
  if (!p || !p.skillCT) return;
  for (const sid of Object.keys(p.skillCT)) {
    p.skillCT[sid] = 0;
  }
}


// ---------- event system ----------
function randomEvent() {
  const list = DATA.events.events;
  return list[(Math.random() * list.length) | 0];
}

function moveToPos(p, newPos, reasonText, opts) {
  const oldPos = p.pos;
  p.pos = ((newPos % 40) + 40) % 40;

  // ★teleport のときは深度変化なし（後退ワープ等で深度が増えるバグを防ぐ）
  if (!opts?.teleport) {
    if (p.pos < oldPos) p.depth += 1;
  }

  const type = tileTypeAt(p.pos);
  logLine(`${p.id} ${reasonText} → マス${p.pos}(${tileTypeJa(type)})`);
  setActionInfo(`${reasonText}\n→ マス${p.pos}（${tileTypeJa(type)}）`);

  resolveTile({ chain: (opts?.chain ?? 0) + 1, fromEventMove: true });
}


function applyEvent(opts) {
  const p = currentPlayer();

  if ((opts?.chain ?? 0) >= 4) {
    logLine("イベント連鎖が長すぎるため停止（安全装置）");
    setActionInfo("イベント連鎖が長すぎるため停止しました。");
    applyNonMonsterCTBonus(p);
    waitContinue("次へ（手番終了）", endTurn);
    return { moved: true };
  }

  const ev = randomEvent();
  logLine(`イベント: ${ev.name}`);
  setActionInfo(`イベント：${ev.name}\n${ev.desc ?? ""}`.trim());

  const key = String(ev.effectKey ?? "").trim();
  const params = ev.params ?? {};

  // ---- 便利：財宝/アイテム/装備の count 対応 ----
  const gainTreasure = (count = 1) => {
    const got = [];
    for (let i = 0; i < count; i++) {
      const base = drawTreasureBase();
      const value = base * p.depth;
      p.bagTreasure.push(value);
      got.push(value);
    }
    logLine(`財宝GET：${got.join(",")}G`);
    setActionInfo(`イベント：${ev.name}\n財宝GET：${got.join(",")}G（バッグ）`);
    return { moved: false };
  };

  const gainItem = (count = 1) => {
    const names = [];
    for (let i = 0; i < count; i++) {
      const it = drawItem();
      p.items.push(it);
      names.push(DATA.itemsById[it]?.name ?? it);
    }
    logLine(`アイテムGET：${names.join(" / ")}`);
    setActionInfo(`イベント：${ev.name}\nアイテムGET：${names.join(" / ")}`);
    return { moved: false };
  };

  const gainEquip = (count = 1) => {
    const names = [];
    for (let i = 0; i < count; i++) {
      const gearId = drawGear();
      addGearToBag(p, gearId);
      const equipped = autoEquipIfEmpty(p, gearId);
      const g = DATA.equipmentById[gearId];
      names.push(`${g.name}${equipped ? "（自動装備）" : "（バッグ）"}`);
    }
    logLine(`装備GET：${names.join(" / ")}`);
    setActionInfo(`イベント：${ev.name}\n装備GET：${names.join(" / ")}`);
    return { moved: false };
  };

  // ---- 相対移動（±）を安全に処理（強制停止も対応）----
  const moveRelative = (delta, reasonText) => {
    const oldPos = p.pos;
    const dir = delta >= 0 ? 1 : -1;
    const steps = Math.abs(delta);

    const stops = new Set([RETURN_POS, BOSS_POS].filter(v => v >= 0));
    let newPos = oldPos;
    let forced = false;

    for (let i = 0; i < steps; i++) {
      newPos = (newPos + dir + 40) % 40;

      // 深度+1は「前進で0を跨いだ時だけ」
      if (dir === 1 && newPos === 0 && oldPos !== 0) {
        p.depth += 1;
        logLine(`${p.id} 深度+1 → 深度${p.depth}`);
      }

      if (newPos !== oldPos && stops.has(newPos)) { forced = true; break; }
    }

    p.pos = newPos;

    const type = (p.pos === RETURN_POS) ? "RETURN" : tileTypeAt(p.pos);
    const forcedReason =
      (forced && p.pos === BOSS_POS) ? " ※ボスで強制停止" :
      (forced && p.pos === RETURN_POS) ? " ※帰還ポイントで強制停止" :
      (forced ? " ※強制停止" : "");

    logLine(`${p.id} ${reasonText} → マス${p.pos}(${tileTypeJa(type)})${forcedReason}`);
    setActionInfo(`${reasonText}\n→ マス${p.pos}（${tileTypeJa(type)}）${forcedReason ? "\n" + forcedReason.trim() : ""}`);

    resolveTile({ chain: (opts?.chain ?? 0) + 1, fromEventMove: true });
    return { moved: true };
  };

  // ===== ここから effectKey 別処理 =====
  if (key === "gainTreasure") return gainTreasure(Number(params.count ?? 1));
  if (key === "gainItem") return gainItem(Number(params.count ?? 1));
  if (key === "gainEquip") return gainEquip(Number(params.count ?? 1));

  if (key === "loseLowestTreasure") {
    if (p.bagTreasure.length === 0) {
      logLine("落とし穴：失う財宝がない");
      setActionInfo(`イベント：${ev.name}\n失う財宝がありません。`);
      return { moved: false };
    }
    const min = Math.min(...p.bagTreasure);
    const idx = p.bagTreasure.indexOf(min);
    p.bagTreasure.splice(idx, 1);
    logLine(`財宝ロスト：${min}G`);
    setActionInfo(`イベント：${ev.name}\n財宝ロスト：${min}G（バッグ）`);
    return { moved: false };
  }

  if (key === "stealLowestTreasure") {
    const others = state.players.filter(pl => pl !== p && (pl.bagTreasure?.length ?? 0) > 0);
    if (others.length === 0) {
      logLine("盗賊の手：盗める相手がいない");
      setActionInfo(`イベント：${ev.name}\n盗める相手がいません。`);
      return { moved: false };
    }
    const target = others[(Math.random() * others.length) | 0];
    const min = Math.min(...target.bagTreasure);
    const idx = target.bagTreasure.indexOf(min);
    target.bagTreasure.splice(idx, 1);
    p.bagTreasure.push(min);
    logLine(`盗み成功：${target.id} から ${min}G`);
    setActionInfo(`イベント：${ev.name}\n盗み成功：${target.id} から ${min}G（バッグへ）`);
    return { moved: false };
  }

  if (key === "disableEquippedItem") {
    const slots = ["weapon", "armor", "accessory"].filter(s => p.equip?.[s]);
    if (slots.length === 0) {
      logLine("装備破損：壊れる装備がない");
      setActionInfo(`イベント：${ev.name}\n壊れる装備がありません。`);
      return { moved: false };
    }
    const slot = slots[(Math.random() * slots.length) | 0];
    const gid = p.equip[slot];
    const g = DATA.equipmentById[gid];
    p.equip[slot] = null; // 破損＝失う（バッグには戻さない）
    logLine(`装備破損：${slotName(slot)}「${g?.name ?? gid}」`);
    setActionInfo(`イベント：${ev.name}\n装備破損：${slotName(slot)}「${g?.name ?? gid}」`);
    return { moved: false };
  }

  if (key === "healAndMp") {
    const hpExpr = String(params.hpExpr ?? "1d6");
    const mpFlat = Number(params.mpFlat ?? 0);

    const r = rollExpr(hpExpr);
    const beforeHp = p.hp;
    const beforeMp = p.mp;

    p.hp = Math.min(p.hpMax, p.hp + r.total);
    p.mp = Math.min(p.mpMax, p.mp + mpFlat);

    logLine(`回復：HP+${r.total} / MP+${mpFlat}`);
    setActionInfo(
      `イベント：${ev.name}\n` +
      `HP回復：${hpExpr} → ${fmtRollShort(r)}（${beforeHp}→${p.hp}/${p.hpMax}）\n` +
      `MP回復：+${mpFlat}（${beforeMp}→${p.mp}/${p.mpMax}）`
    );
    return { moved: false };
  }

  if (key === "nextBattleAtkFlatMod") {
    const delta = Number(params.delta ?? 0);
    p.nextBattleAtkFlatMod = Number(p.nextBattleAtkFlatMod ?? 0) + delta;
    logLine(`次戦ATK固定補正：${delta}`);
    setActionInfo(`イベント：${ev.name}\n次の戦闘だけ ATK固定 ${delta >= 0 ? "+" : ""}${delta}`);
    return { moved: false };
  }

  if (key === "nextBattleDefFlatMod") {
    const delta = Number(params.delta ?? 0);
    p.nextBattleDefFlatMod = Number(p.nextBattleDefFlatMod ?? 0) + delta;
    logLine(`次戦DEF固定補正：${delta}`);
    setActionInfo(`イベント：${ev.name}\n次の戦闘だけ DEF固定 ${delta >= 0 ? "+" : ""}${delta}`);
    return { moved: false };
  }

  if (key === "warpByD6") {
    const r = rollD6();
    const oddDelta = Number(params.oddDelta ?? 0);
    const evenDelta = Number(params.evenDelta ?? 0);
    const delta = (r % 2 === 1) ? oddDelta : evenDelta;
    return moveRelative(delta, `イベント：ワープ 1d6=${r} → ${delta >= 0 ? "+" : ""}${delta}マス`);
  }

  if (key === "lostAndFound") {
    const pick = Math.random() < 0.5 ? "item" : "equip";
    if (pick === "item") return gainItem(1);
    return gainEquip(1);
  }

   if (key === "transferAtkDefDie") {
    const canAtkToDef = (p.atkDiceBonus ?? 0) > 0;
    const canDefToAtk = (p.defDiceBonus ?? 0) > 0;

    if (!canAtkToDef && !canDefToAtk) {
      logLine("再配分：移せる成長がない");
      setActionInfo(`イベント：${ev.name}\n移せるATK/DEF成長がありません。`);
      return { moved: false };
    }

    const msg =
      `イベント：${ev.name}\n` +
      `再配分の祠：どちらに1移しますか？\n` +
      `ATK追加ダイス：${p.atkDiceBonus ?? 0}\n` +
      `DEF追加ダイス：${p.defDiceBonus ?? 0}`;

    const optsArr = [];

    if (canAtkToDef) {
      optsArr.push({
        label: "ATK→DEFに1移す",
        className: "btn primary",
        onClick: () => {
          const pp = currentPlayer();
          pp.atkDiceBonus -= 1;
          pp.defDiceBonus = (pp.defDiceBonus ?? 0) + 1;

          logLine("再配分：ATK→DEF に1移動");
          setActionInfo(`イベント：${ev.name}\nATK→DEF に1移しました。`);

          clearChoice();
          applyNonMonsterCTBonus(pp);
          waitContinue("次へ（次のプレイヤー）", endTurn);
        }
      });
    }

    if (canDefToAtk) {
      optsArr.push({
        label: "DEF→ATKに1移す",
        className: "btn primary",
        onClick: () => {
          const pp = currentPlayer();
          pp.defDiceBonus -= 1;
          pp.atkDiceBonus = (pp.atkDiceBonus ?? 0) + 1;

          logLine("再配分：DEF→ATK に1移動");
          setActionInfo(`イベント：${ev.name}\nDEF→ATK に1移しました。`);

          clearChoice();
          applyNonMonsterCTBonus(pp);
          waitContinue("次へ（次のプレイヤー）", endTurn);
        }
      });
    }

    // やめる（必須）
    optsArr.push({
      label: "やめる（変更しない）",
      className: "btn",
      onClick: () => {
        const pp = currentPlayer();
        setActionInfo(`イベント：${ev.name}\n変更なし。`);

        clearChoice();
        applyNonMonsterCTBonus(pp);
        waitContinue("次へ（次のプレイヤー）", endTurn);
      }
    });

    showChoice(msg, optsArr);
    return { paused: true }; // ★ここが重要：resolveTile側で手番終了させない
  }


  // ---- moveByD6 / moveTo / moveToBoss を残したい場合（互換）----
  if (key === "moveByD6") {
    const r = rollD6();
    return moveRelative(r, `イベント移動：1d6=${r}`);
  }
  if (key === "moveTo") {
    const to = Number(params.pos ?? 0);
    moveToPos(p, to, `イベント移動：指定マスへ`, { ...opts, teleport: true });
    return { moved: true };
  }
  if (key === "moveToBoss") {
    const bossPos = DATA.board.tiles.findIndex(t => t === "BOSS");
    const to = bossPos >= 0 ? bossPos : 39;
    moveToPos(p, to, `イベント移動：ボスのマスへ`, { ...opts, teleport: true });
    return { moved: true };
  }

  // ★絶対に「効果なし」にしない保険：未定義なら財宝1
  logLine(`未定義effectKey(${key}) → フォールバック：財宝+1`);
  setActionInfo(`イベント：${ev.name}\n効果が未定義だったので財宝を獲得します。`);
  return gainTreasure(1);
}



// ---------- battle ----------
// レベルアップ時にスキルを入手（自職から抽選）
// - 装備枠に空きがあれば自動装備
// - 空きがなければ入れ替えを選ばせる（0/キャンセルで破棄）
function startLevelUpSkillFlow(playerIndex, count, doneCb) {
  state.levelUpSkillFlow = { playerIndex, remaining: count, doneCb };
  processNextLevelUpSkill();
}

function processNextLevelUpSkill() {
  const flow = state.levelUpSkillFlow;
  if (!flow) return;

  const p = state.players[flow.playerIndex];

  while (flow.remaining > 0) {
    const sid = drawSkillForLevelUp(p);   // 中身が drawSkillAny() なので完全ランダム
// もしくは const sid = drawSkillAny();

    if (!sid) {
      logLine(`${p.id} LvUPスキル抽選：入手できるスキルがありません`);
      flow.remaining = 0;
      break;
    }

    const sName = DATA.skillsById[sid]?.name ?? sid;

    // 空きがあるなら自動装備
    if (p.skillsEquipped.length < 3) {
      p.skillsEquipped.push(sid);
      p.skillCT[sid] = 0;
      logLine(`${p.id} LvUPスキル獲得：${sName}（装備）`);
      flow.remaining -= 1;
      continue;
    }

    // 枠がない → 4つのボタンで「捨てる1つ」を選ばせる
    state.pendingSkillChoice = {
      playerIndex: flow.playerIndex,
      newSkillId: sid,
    };

    setActionInfo(
      `レベルアップ！新スキル「${sName}」を獲得！\n` +
      `使わないスキルを1つ選んで捨ててください（4つのボタン）`
    );
    renderAll();
    return; // クリック待ちへ
  }

  // ここまで来たら全部終わり
  const cb = flow.doneCb;
  state.levelUpSkillFlow = null;
  state.pendingSkillChoice = null;
  if (typeof cb === "function") cb();
}

function chooseSkillToDiscard(discardSkillId) {
  const choice = state.pendingSkillChoice;
  const flow = state.levelUpSkillFlow;
  if (!choice || !flow) return;

  const p = state.players[choice.playerIndex];
  const newId = choice.newSkillId;

  const newName = DATA.skillsById[newId]?.name ?? newId;

  // 「新スキル」を捨てた → 何もしない（獲得しない）
  if (discardSkillId === newId) {
    logLine(`${p.id} 新スキル破棄：${newName}`);
  } else {
    const idx = p.skillsEquipped.indexOf(discardSkillId);
    if (idx >= 0) {
      const outName = DATA.skillsById[discardSkillId]?.name ?? discardSkillId;

      p.skillsEquipped[idx] = newId;
      p.skillCT[newId] = 0;

      // 古いCTは消しておく（キーが残り続けるの防止）
      delete p.skillCT[discardSkillId];

      logLine(`${p.id} スキル入替：${outName} → ${newName}`);
    } else {
      // 念のため：見つからないなら新スキル破棄扱い
      logLine(`${p.id}（保険）新スキル破棄：${newName}`);
    }
  }

  state.pendingSkillChoice = null;
  flow.remaining -= 1;

  processNextLevelUpSkill();
}



// ===== battle: skills & items =====
function diceCountFromExpr(expr) {
  if (!expr) return 0;
  const s = String(expr).toLowerCase().replace(/\s+/g, "");
  let sum = 0;
  const re = /(\d*)d6/g; // "d6" は 1d6 扱い
  let m;
  while ((m = re.exec(s))) {
    sum += Number(m[1] || 1);
  }
  return sum;
}

function safeEvalArithmetic(expr) {
  // 数字と四則演算と括弧だけ許可（安全にする）
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return NaN;
  try {
    return Function(`"use strict"; return (${expr});`)();
  } catch {
    return NaN;
  }
}

function getSkillMpCost(skill, p = null) {
  const raw =
    skill.mp ??
    skill.mpCost ??
    skill.costMp ??
    skill.cost?.mp ??
    0;

  const player = p ?? (typeof currentPlayer === "function" ? currentPlayer() : null);
  const atkExpr = player ? playerAtkExpr(player) : "";
  const atkDice = diceCountFromExpr(atkExpr);

  let cost = 0;

  // 1) 数値
  if (typeof raw === "number" && Number.isFinite(raw)) {
    cost = raw;
  }
  // 2) mp がオブジェクト（例：{base:0, perAtkDie:1}）
  else if (raw && typeof raw === "object") {
    const base = Number(raw.base ?? raw.flat ?? 0) || 0;
    const perAtkDie = Number(raw.perAtkDie ?? 0) || 0;
    cost = base + perAtkDie * atkDice;
  }
  // 3) 文字列（保険）
  else if (typeof raw === "string") {
    const v = Number(raw.trim());
    cost = Number.isFinite(v) ? v : 0;
  }

  // ★追加：装備でスキルMPを増減
  if (player) cost += equipSkillMpCostDelta(player);

  return Math.max(0, Math.floor(cost));
}

function getSkillCt(skill, p = null) {
  const base = Number(skill.ct ?? skill.cooldown ?? skill.ctMax ?? skill.costCt ?? 0) || 0;
  const player = p ?? (typeof currentPlayer === "function" ? currentPlayer() : null);

  let ct = base;

  // ★追加：装備でスキルCTを増減
  if (player) ct += equipSkillCtDelta(player);

  return Math.max(0, Math.floor(ct));
}

function getSkillDesc(skill) {
  return String(skill.desc ?? skill.description ?? skill.text ?? "（説明が未設定）");
}
function getItemDesc(item) {
  return String(item.desc ?? item.description ?? item.text ?? "（説明が未設定）");
}

function enemyDefExtra(enemy) {
  if (!enemy) return 0;
  if ((enemy.tempDefTurns ?? 0) <= 0) return 0;
  return Number(enemy.tempDefFlat ?? 0);
}
function tickEnemyTemp(enemy) {
  if (!enemy) return;
  if ((enemy.tempDefTurns ?? 0) > 0) {
    enemy.tempDefTurns -= 1;
    if (enemy.tempDefTurns <= 0) {
      enemy.tempDefTurns = 0;
      enemy.tempDefFlat = 0;
    }
  }
}

// プレイヤー行動後：敵行動→ターン進行（今の流れを共通化）
function proceedAfterPlayerAction(skipCtSkillId = null) {
  const p = currentPlayer();
  const b = state.battle;
  if (!b) return;

  // 敵が死んでたら勝利
  if (b.enemy.hp <= 0) {
    b.locked = false;
    onBattleWin();
    return;
  }

  // ★毒（敵行動前）
  if ((b.enemy.poisonTurns ?? 0) > 0) {
    const expr = String(b.enemy.poisonExpr ?? "1d6");
    const r = rollExpr(expr);
    b.enemy.hp -= r.total;
    if (b.enemy.hp < 0) b.enemy.hp = 0;

    appendBattleInfo(
`【毒】
${b.enemy.name}に${r.total}ダメージ（${fmtRollShort(r)}）
敵HP：${b.enemy.hp}/${b.enemy.hpMax}`
    );

    b.enemy.poisonTurns -= 1;

    if (b.enemy.hp <= 0) {
      b.locked = false;
      onBattleWin();
      return;
    }
  }

  setTimeout(() => {
    if (!state || !state.battle) return;

    const { text } = enemyActionText();
    appendBattleInfo(text);

    if (p.hp <= 0) {
      onPlayerDeath();
      return;
    }

    // 敵の一時効果のターン消費
    tickEnemyTemp(b.enemy);

    // 戦闘中CTを1減らす（装備中スキル）
    for (const sid of p.skillsEquipped) {
      if (sid === skipCtSkillId) continue;
      p.skillCT[sid] = Math.max(0, (p.skillCT[sid] ?? 0) - 1);
    }
    // 戦闘中もターンごとにMP+1（生存時）
    p.mp = Math.min(p.mpMax, p.mp + 1);

    b.turnNow += 1;
    b.freeItemUsedThisTurn = false;
    b.locked = false;

    // タイムアップ
    if (b.turnNow > b.turnLimit && b.enemy.hp > 0) {
      logLine("タイムアップ！経験値なしで1マス戻る（効果発動なし）");
      setActionInfo("タイムアップ！\n経験値なしで1マス戻ります（効果なし）");
      const prev = (p.pos - 1 + 40) % 40;
      p.pos = prev;
      p.skipNextTileEffect = true;
      state.battle = null;

      resolveTile({ fromBattleRetreat: true, chain: 0 });
      return;
    }

    renderAll();
  }, RESULT_DELAY_MS);
}

function useSkillInBattle(skillId) {
  const p = currentPlayer();
  const b = state.battle;
  if (!b || b.locked) return;

  const s = DATA.skillsById[skillId];
  if (!s) return;

  // battle 保険（古い startBattle でも落ちないように）
  b.playerMods ??= { atkFlat: 0, defFlat: 0 };
  b.playerStatus ??= { evadeTurns: 0, nextDamageMinusFlat: 0, defDiceThisTurn: 0, hp1TripleActive: false };
  b.expMult ??= 1;
  b.lastDamageToPlayer ??= 0;
  b.enemy.poisonTurns ??= 0;
  b.enemy.poisonExpr ??= "1d6";

  const curCt = p.skillCT[skillId] ?? 0;
  const mpCost = getSkillMpCost(s, p);
  const ct = getSkillCt(s, p);

  if (curCt > 0) {
    setBattleInfo(`CT中なので使えません：${s.name}\nCT残り：${curCt}`);
    return;
  }
  if (p.mp < mpCost) {
    setBattleInfo(`MP不足で使えません：${s.name}\n必要MP：${mpCost} / 今MP：${p.mp}`);
    return;
  }

  const effect = String(s.effectKey ?? "").trim(); // ★effectKey完全一致で処理する
  const params = s.params ?? {};

  // 「潜り中1回」系は支払い前にチェック（無駄消費防止）
  if (effect === "win_battle_once_per_dive" && p.winOnceUsedThisDive) {
    setBattleInfo(`【スキル：${s.name}】\nこの潜りではもう使えません。`);
    return;
  }

  b.locked = true;
  renderAll();

  // 支払い
  p.mp -= mpCost;
  p.skillCT[skillId] = ct;

  // ---- 共通：弱点2倍判定 ----
  const isWeak = (element) => {
    const e = String(element ?? "").toLowerCase();
    return e && e === String(b.enemy.weakness ?? "").toLowerCase();
  };

  // ---- 共通：1回攻撃する（多くの effectKey がこれを使う）----
  const doAttackOnce = (opt = {}) => {
    const element = String(opt.element ?? s.element ?? "physical").toLowerCase();
    const ignoreDef = Boolean(opt.ignoreDef ?? false);

    const atkDiceDelta = Number(opt.atkDiceDelta ?? 0);
    const atkFlatAdd  = Number(opt.atkFlatAdd ?? 0);
    const mult        = Number(opt.mult ?? 1);
    const finalMult   = Number(opt.finalMult ?? 1);

    const minDie = (opt.minDie == null) ? null : Number(opt.minDie);
    const overrideDie = (opt.overrideDie == null) ? null : Number(opt.overrideDie);

    const enemy = b.enemy;

    // 固定ダメ（防御無視）
    if (opt.fixedDamage != null) {
      let dmg = Math.max(1, Math.floor(Number(opt.fixedDamage)));

      // 背水（HP1なら×3）
      if (b.playerStatus?.hp1TripleActive && p.hp === 1) dmg *= 3;

      // 弱点×2
      if (isWeak(element)) dmg *= 2;

      enemy.hp -= dmg;
      if (enemy.hp < 0) enemy.hp = 0;

      return {
        dmg,
        text:
       `【スキル：${s.name}】（固定ダメ）
       MP-${mpCost} / CT=${ct}
       固定ダメ：${dmg}${isWeak(element) ? "（弱点×2）" : ""}
       敵HP：${enemy.hp}/${enemy.hpMax}`
      };
    }

    // 通常攻撃（ダイスATK - ダイスDEF）
    const atkExpr = adjustDiceExpr(playerAtkExpr(p), atkDiceDelta);
    const atkRoll = rollExpr(atkExpr, {
      minDie: minDie,
      overrideDie: overrideDie,
    });

    const defRoll = rollExpr(enemy.defExpr);

    // 力の薬：次の攻撃ATK固定+（スキル攻撃にも適用）※1回で消える
    const nextFlat = Number(b.playerStatus?.nextAtkFlatNext ?? 0);
    if (nextFlat > 0) b.playerStatus.nextAtkFlatNext = 0;

    const atkVal = atkRoll.total + playerAtkFlatInBattle(p) + atkFlatAdd + nextFlat;

    const defVal = ignoreDef ? 0 : (defRoll.total + enemyDefExtra(enemy));

    let dmg = Math.max(1, atkVal - defVal);
    dmg = Math.floor(dmg * mult);
    dmg = Math.floor(dmg * finalMult);

    // 背水（HP1なら×3）
    if (b.playerStatus?.hp1TripleActive && p.hp === 1) dmg *= 3;

    // 弱点×2
    if (isWeak(element)) dmg *= 2;

    enemy.hp -= dmg;
    if (enemy.hp < 0) enemy.hp = 0;

    const text =
`【スキル：${s.name}】（攻撃）
MP-${mpCost} / CT=${ct}
自分ATK：${fmtRollShort(atkRoll)} +固定${playerAtkFlatInBattle(p)} +${atkFlatAdd} → ${atkVal}
敵DEF：${ignoreDef ? "無視" : `${fmtRollShort(defRoll)} +補正${enemyDefExtra(enemy)} → ${defVal}`}
与ダメ：${dmg}${isWeak(element) ? "（弱点×2）" : ""}
敵HP：${enemy.hp}/${enemy.hpMax}`;

    return { dmg, text };
  };

  // -------------------------
  // effectKey 完全一致で分岐
  // -------------------------
  switch (effect) {
    // --- 剣 ---
    case "attack_min_die": {
      const min = Number(params.min ?? 1);
      const r = doAttackOnce({ minDie: min, element: s.element });
      setBattleInfo(r.text);
      logLine(`${p.id} スキル ${s.name} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_fixed_damage": {
      // 例：{by:"level", mul:10}
      const by = String(params.by ?? "level");
      const mul = Number(params.mul ?? 10);
      const fixed = (by === "level") ? (p.level * mul) : mul;
      const r = doAttackOnce({ fixedDamage: fixed, element: s.element });
      setBattleInfo(r.text);
      logLine(`${p.id} スキル ${s.name} fixed=${fixed} dmg=${r.dmg}`);
      // 固定ダメで倒す可能性あるので proceed の前に勝利チェック
      if (b.enemy.hp <= 0) { b.locked = false; onBattleWin(); return; }
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_element_magic": {
      const r = doAttackOnce({ element: "magic" });
      setBattleInfo(r.text);
      logLine(`${p.id} スキル ${s.name} dmg=${r.dmg} (magic)`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_atk_flat": {
      const add = Number(params.add ?? 0);
      const r = doAttackOnce({ atkFlatAdd: add, element: s.element });
      setBattleInfo(r.text);
      logLine(`${p.id} スキル ${s.name} +flat${add} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "buff_triple_while_hp1": {
      b.playerStatus.hp1TripleActive = true;
      setBattleInfo(
`【スキル：${s.name}】（バフ）
MP-${mpCost} / CT=${ct}
HPが1の間、与ダメージ×3（この戦闘中）`
      );
      logLine(`${p.id} スキル ${s.name} 背水ON`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    // --- 魔法 ---
    case "attack_atk_mult": {
      const mul = Number(params.mul ?? 2);
      const r = doAttackOnce({ mult: mul, element: s.element });
      setBattleInfo(r.text);
      logLine(`${p.id} スキル ${s.name} mult=${mul} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "debuff_enemy_def_flat": {
      const delta = Number(params.delta ?? -6);
      const turns = Number(params.turns ?? 3);
      b.enemy.tempDefFlat = delta;
      b.enemy.tempDefTurns = turns;

      setBattleInfo(
`【スキル：${s.name}】（デバフ）
MP-${mpCost} / CT=${ct}
敵DEF補正：${delta} を ${turns}ターン`
      );
      logLine(`${p.id} スキル ${s.name} enemyDEF ${delta} turns=${turns}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "hp_to_mp_xd6": {
      // 1d6ぶんHPを失い、同量MPを得る（HPは最低1残す）
      const r = rollExpr("1d6");
      const beforeHp = p.hp;
      const beforeMp = p.mp;

      const loss = r.total;
      p.hp = Math.max(1, p.hp - loss);
      p.mp = Math.min(p.mpMax, p.mp + loss);

      setBattleInfo(
`【スキル：${s.name}】（変換）
MP-${mpCost} / CT=${ct}
HP-${loss} / MP+${loss}（${fmtRollShort(r)}）
HP：${beforeHp}→${p.hp}/${p.hpMax}
MP：${beforeMp}→${p.mp}/${p.mpMax}`
      );
      logLine(`${p.id} スキル ${s.name} HP->MP ${loss}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "mp_to_atk_xd6": {
      // 1d6を振り、その分MPを消費して、この攻撃のATK固定に加算
      const r0 = rollExpr("1d6");
      const need = r0.total;

      if (p.mp <= 0) {
        setBattleInfo(`【スキル：${s.name}】\nMPが0なので不発。`);
        b.locked = false;
        renderAll();
        return;
      }

      const pay = Math.min(p.mp, need);
      p.mp -= pay;

      const r = doAttackOnce({ atkFlatAdd: pay, element: s.element });
      setBattleInfo(
`【スキル：${s.name}】（暴走）
追加消費MP：${pay}（1d6=${need}）\n` + r.text
      );
      logLine(`${p.id} スキル ${s.name} MP->ATK ${pay} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    // --- 勇者 ---
    case "buff_atk_def_plus_1d6": {
      const r = rollExpr("1d6");
      const add = r.total;
      b.playerMods.atkFlat = Number(b.playerMods.atkFlat ?? 0) + add;
      b.playerMods.defFlat = Number(b.playerMods.defFlat ?? 0) + add;

      setBattleInfo(
`【スキル：${s.name}】（バフ）
MP-${mpCost} / CT=${ct}
ATK固定+${add} / DEF固定+${add}（${fmtRollShort(r)}）
（この戦闘中）`
      );
      logLine(`${p.id} スキル ${s.name} atk/def +${add}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "buff_battle_exp_mult": {
      const mul = Number(params.mul ?? 2);
      b.expMult = Number(b.expMult ?? 1) * mul;

      setBattleInfo(
`【スキル：${s.name}】（バフ）
MP-${mpCost} / CT=${ct}
この戦闘の獲得EXP ×${mul}
（現在 ×${b.expMult}）`
      );
      logLine(`${p.id} スキル ${s.name} expMult=${b.expMult}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "win_battle_once_per_dive": {
      p.winOnceUsedThisDive = true;
      b.enemy.hp = 0;

      setBattleInfo(
`【スキル：${s.name}】（勝利確定）
MP-${mpCost} / CT=${ct}
この潜りで1回だけ、戦闘に勝利する`
      );
      logLine(`${p.id} スキル ${s.name} winOnce used`);
      b.locked = false;
      onBattleWin();
      return;
    }

    case "attack_atk_plus_1d6_plus_flat": {
      const flat = Number(params.flat ?? 0);
      const r0 = rollExpr("1d6");
      const add = r0.total + flat;

      const r = doAttackOnce({ atkFlatAdd: add, element: s.element });
      setBattleInfo(
`【スキル：${s.name}】（強化攻撃）
追加：1d6+${flat} → ${add}（${fmtRollShort(r0)}）\n` + r.text
      );
      logLine(`${p.id} スキル ${s.name} +${add} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    // --- 弓 ---
    case "attack_twice": {
      const a1 = doAttackOnce({ element: s.element });
      if (b.enemy.hp <= 0) {
        setBattleInfo(`【スキル：${s.name}】（2連撃）\n1発目で撃破！\n\n${a1.text}`);
        logLine(`${p.id} スキル ${s.name} hit1=${a1.dmg} kill`);
        b.locked = false;
        onBattleWin();
        return;
      }
      const a2 = doAttackOnce({ element: s.element });

      setBattleInfo(
`【スキル：${s.name}】（2連撃）
1発目:${a1.dmg} / 2発目:${a2.dmg}
合計:${a1.dmg + a2.dmg}

（1発目）
${a1.text}

（2発目）
${a2.text}`
      );
      logLine(`${p.id} スキル ${s.name} hit=${a1.dmg}+${a2.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_apply_poison": {
      const turns = Number(params.turns ?? 3);
      const r = doAttackOnce({ element: s.element });

      // 毒付与（上書きでOK、好みで max にしてもよい）
      b.enemy.poisonTurns = Math.max(Number(b.enemy.poisonTurns ?? 0), turns);
      b.enemy.poisonExpr = String(params.poisonExpr ?? b.enemy.poisonExpr ?? "1d6");

      setBattleInfo(
`${r.text}

【追加効果：毒】
${turns}ターン（毎ターン ${b.enemy.poisonExpr}）`
      );
      logLine(`${p.id} スキル ${s.name} poison turns=${turns} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_atk_plus_dice": {
      // params.dice 例："2d6"
      const diceExpr = String(params.dice ?? "1d6");
      const plusDice = diceCountFromExpr(diceExpr);

      const r = doAttackOnce({ atkDiceDelta: plusDice, element: s.element });
      setBattleInfo(
`【スキル：${s.name}】（ダイス追加）
ATKダイス +${plusDice}（${diceExpr}）\n` + r.text
      );
      logLine(`${p.id} スキル ${s.name} +dice${plusDice} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_damage_equals_taken": {
      const element = String(s.element ?? "physical").toLowerCase();
      let dmg = Math.max(1, Number(b.lastDamageToPlayer ?? 0));

      // 背水
      if (b.playerStatus?.hp1TripleActive && p.hp === 1) dmg *= 3;
      // 弱点
      if (isWeak(element)) dmg *= 2;

      b.enemy.hp -= dmg;
      if (b.enemy.hp < 0) b.enemy.hp = 0;

      setBattleInfo(
`【スキル：${s.name}】（報復）
MP-${mpCost} / CT=${ct}
直前被ダメ：${b.lastDamageToPlayer} → 報復ダメ：${dmg}${isWeak(element) ? "（弱点×2）" : ""}
敵HP：${b.enemy.hp}/${b.enemy.hpMax}`
      );
      logLine(`${p.id} スキル ${s.name} revenge dmg=${dmg}`);

      if (b.enemy.hp <= 0) { b.locked = false; onBattleWin(); return; }
      proceedAfterPlayerAction(skillId);
      return;
    }

    // --- 盗賊 ---
    case "attack_final_mult": {
      const mul = Number(params.mul ?? 1.5);
      const r = doAttackOnce({ finalMult: mul, element: s.element });
      setBattleInfo(r.text);
      logLine(`${p.id} スキル ${s.name} finalMult=${mul} dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "buff_evade_turns": {
      const turns = Number(params.turns ?? 1);
      b.playerStatus.evadeTurns = Math.max(Number(b.playerStatus.evadeTurns ?? 0), turns);

      setBattleInfo(
`【スキル：${s.name}】（回避）
MP-${mpCost} / CT=${ct}
${turns}ターン、敵の攻撃を回避`
      );
      logLine(`${p.id} スキル ${s.name} evade turns=${turns}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "auto_escape": {
      setBattleInfo(
`【スキル：${s.name}】（逃走）
MP-${mpCost} / CT=${ct}
逃走成功（確定）`
      );
      logLine(`${p.id} スキルで逃走成功 ${s.name}`);

      // 1マス戻る（効果なし）
      const prev = (p.pos - 1 + 40) % 40;
      p.pos = prev;
      p.skipNextTileEffect = true;
      state.battle = null;
      resolveTile({ fromBattleRetreat: true, chain: 0 });
      return;
    }

    case "gain_treasure_now": {
      const base = drawTreasureBase();
      const value = base * p.depth;
      p.bagTreasure.push(value);

      setBattleInfo(
`【スキル：${s.name}】（財宝）
MP-${mpCost} / CT=${ct}
財宝GET：${value}G（バッグ）`
      );
      logLine(`${p.id} スキル ${s.name} treasure=${value}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "attack_all_dice_6": {
      const r = doAttackOnce({ overrideDie: 6, element: s.element });
      setBattleInfo(
`【スキル：${s.name}】（確定）
全ダイス=6\n` + r.text
      );
      logLine(`${p.id} スキル ${s.name} all6 dmg=${r.dmg}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    // --- 僧侶 ---
    case "cleanse_self": {
      // 現状、プレイヤー側の状態異常は少ないので「解除できるものを解除」
      b.playerStatus.evadeTurns = 0;
      b.playerStatus.nextDamageMinusFlat = 0;
      b.playerStatus.defDiceThisTurn = 0;

      setBattleInfo(
`【スキル：${s.name}】（浄化）
MP-${mpCost} / CT=${ct}
状態を整えた（回避/祈り/一時防御をリセット）`
      );
      logLine(`${p.id} スキル ${s.name} cleanse`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "heal_hp_expr": {
      const healExpr = String(params.expr ?? params.healExpr ?? "2d6");
      const r = rollExpr(healExpr);
      const before = p.hp;
      p.hp = Math.min(p.hpMax, p.hp + r.total);

      setBattleInfo(
`【スキル：${s.name}】（回復）
MP-${mpCost} / CT=${ct}
回復：${healExpr} → ${fmtRollShort(r)}
HP：${before} → ${p.hp}/${p.hpMax}`
      );
      logLine(`${p.id} スキル回復 ${s.name} +${r.total}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "buff_next_damage_minus_flat": {
      const flat = Number(params.flat ?? 0);
      b.playerStatus.nextDamageMinusFlat = Math.max(Number(b.playerStatus.nextDamageMinusFlat ?? 0), flat);

      setBattleInfo(
`【スキル：${s.name}】（祈り）
MP-${mpCost} / CT=${ct}
次に受けるダメージ -${flat}`
      );
      logLine(`${p.id} スキル ${s.name} nextDamage -${flat}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    case "buff_def_plus_dice_this_turn": {
      const diceExpr = String(params.dice ?? "1d6");
      const addDice = diceCountFromExpr(diceExpr);
      b.playerStatus.defDiceThisTurn = Number(b.playerStatus.defDiceThisTurn ?? 0) + addDice;

      setBattleInfo(
`【スキル：${s.name}】（守護）
MP-${mpCost} / CT=${ct}
次の敵攻撃まで DEFダイス +${addDice}（${diceExpr}）`
      );
      logLine(`${p.id} スキル ${s.name} defDiceThisTurn +${addDice}`);
      proceedAfterPlayerAction(skillId);
      return;
    }

    default: {
      // 未対応の effectKey：落ちないようにメッセージ
      setBattleInfo(
`【スキル：${s.name}】
MP-${mpCost} / CT=${ct}
effectKey「${effect}」が未対応です。`
      );
      logLine(`${p.id} スキル未対応 ${s.name} key=${effect}`);
      proceedAfterPlayerAction(skillId);
      return;
    }
  }
}

// アイテム使用（items.json の情報にできるだけ合わせる）
// opts.freeAction === true のとき：敵行動なし / ターン進行なし（＝ターン消費なし）
function useItemInBattle(itemId, opts = {}) {
  const p = currentPlayer();
  const b = state.battle;
  if (!b || b.locked) return;

  // 1ターン1回制限（freeActionアイテム用）
  if (opts.freeAction && b.freeItemUsedThisTurn) return;

  const it = DATA.itemsById[itemId];
  if (!it) return;

  // battle 保険
  b.playerStatus ??= { evadeTurns: 0, nextDamageMinusFlat: 0, defDiceThisTurn: 0, hp1TripleActive: false };
  b.playerStatus.escapeBonusNext ??= 0;      // 逃走ロープ
  b.playerStatus.nextAttackElement ??= null; // 魔力付与札（今回は通常攻撃にのみ使用）
  b.playerStatus.nextAtkFlatNext ??= 0;      // 力の薬（今回は通常攻撃にのみ使用）

  const key = String(it.effectKey ?? it.type ?? it.kind ?? "").trim().toLowerCase();
  const params = it.params ?? {};

  // 消費は「実行が確定してから」行う（キャンセル時に消えないように）
  const consumeItem = () => {
    const idx = p.items.indexOf(itemId);
    if (idx >= 0) p.items.splice(idx, 1);
  };

  const finish = () => {
    if (opts.freeAction) {
      b.freeItemUsedThisTurn = true;
      b.locked = false;
      renderAll();
      return;
    }
    proceedAfterPlayerAction();
  };

  const abortNoConsume = (msg) => {
    setBattleInfo(`【アイテム：${it.name}】\n${msg}`);
    b.locked = false;
    renderAll();
  };

  b.locked = true;
  renderAll();

  switch (key) {
    // -----------------------
    // 回復（exprは params.expr）
    // -----------------------
    case "heal_hp_expr": {
      const healExpr = String(params.expr ?? "2d6");
      const r = rollExpr(healExpr);
      const before = p.hp;
      p.hp = Math.min(p.hpMax, p.hp + r.total);

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】（HP回復）
回復：${healExpr} → ${fmtRollShort(r)}
HP：${before} → ${p.hp}/${p.hpMax}`
      );
      logLine(`${p.id} アイテムHP回復 ${it.name} +${r.total}`);
      finish();
      return;
    }

    case "heal_mp_expr": {
      const healExpr = String(params.expr ?? "2d6");
      const r = rollExpr(healExpr);
      const before = p.mp;
      p.mp = Math.min(p.mpMax, p.mp + r.total);

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】（MP回復）
回復：${healExpr} → ${fmtRollShort(r)}
MP：${before} → ${p.mp}/${p.mpMax}`
      );
      logLine(`${p.id} アイテムMP回復 ${it.name} +${r.total}`);
      finish();
      return;
    }

    // -----------------------
    // バフ系
    // -----------------------
    case "buff_evade_turns": { // 煙玉
      const turns = Number(params.turns ?? 1);
      b.playerStatus.evadeTurns = Math.max(Number(b.playerStatus.evadeTurns ?? 0), turns);

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
${turns}ターン、敵の攻撃を回避`
      );
      logLine(`${p.id} アイテム回避 ${it.name} turns=${turns}`);
      finish();
      return;
    }

    case "buff_next_damage_minus_flat": { // 鉄の護符
      const flat = Number(params.flat ?? 0);
      b.playerStatus.nextDamageMinusFlat = Math.max(Number(b.playerStatus.nextDamageMinusFlat ?? 0), flat);

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
次に受けるダメージ -${flat}（最低0）`
      );
      logLine(`${p.id} アイテム被ダメ軽減 ${it.name} -${flat}`);
      finish();
      return;
    }

        case "reduce_skill_ct": { // 迅速の符：選んだスキルのCTを減らす
        const delta = Number(params.delta ?? 2);
        if (!p.skillsEquipped || p.skillsEquipped.length === 0) {
        abortNoConsume("スキルが無いので使えません。");
        return;
        }

        // ★prompt廃止：ボタンで選択
        const msg =
        `【${it.name}】CTを減らすスキルを選んでください（-${delta} / 最低0）`;

        const options = p.skillsEquipped.map((sid) => {
        const s = DATA.skillsById[sid];
        const name = s?.name ?? sid;
        const cur = p.skillCT[sid] ?? 0;

        return {
          label: `${name}（CT:${cur}）`,
          className: "btn primary",
          tip: skillTooltip(p, sid),
          onClick: () => {
            const before = p.skillCT[sid] ?? 0;
            p.skillCT[sid] = Math.max(0, before - delta);

            consumeItem();

            setBattleInfo(
            `【アイテム：${it.name}】
            ${name} のCT：${before} → ${p.skillCT[sid]}`
            );
            logLine(`${p.id} アイテムCT短縮 ${it.name} ${name} ${before}->${p.skillCT[sid]}`);

            clearChoice();
            finish();
          }
        };
      });

      options.push({
        label: "キャンセル",
        className: "btn",
        onClick: () => {
          clearChoice();
          abortNoConsume("キャンセルしました。");
        }
      });

      showChoice(msg, options);
      return;
    }


    case "escape_bonus_next": { // 逃走ロープ（次の逃走判定に+）
      const add = Number(params.add ?? 0);
      b.playerStatus.escapeBonusNext = Number(b.playerStatus.escapeBonusNext ?? 0) + add;

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
次の逃走判定に +${add}（1回だけ）`
      );
      logLine(`${p.id} アイテム逃走補正 ${it.name} +${add}`);
      finish();
      return;
    }

    case "next_attack_element": { // 魔力付与札（今回は通常攻撃にだけ反映）
      const element = String(params.element ?? "magic").toLowerCase();
      b.playerStatus.nextAttackElement = element;

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
次の通常攻撃を「${element}」属性にする`
      );
      logLine(`${p.id} アイテム次攻撃属性 ${it.name} element=${element}`);
      finish();
      return;
    }

    case "next_attack_atk_flat": { // 力の薬（今回は通常攻撃にだけ反映）
      const add = Number(params.add ?? 0);
      b.playerStatus.nextAtkFlatNext = Number(b.playerStatus.nextAtkFlatNext ?? 0) + add;

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
次の通常攻撃のATK固定 +${add}（1回だけ）`
      );
      logLine(`${p.id} アイテム次攻撃ATK固定 ${it.name} +${add}`);
      finish();
      return;
    }

    // -----------------------
    // 攻撃・状態異常
    // -----------------------
    case "deal_fixed_damage": { // 火炎瓶
      const base = Number(params.damage ?? 0);
      const element = String(params.element ?? "physical").toLowerCase();
      let dmg = Math.max(0, Math.floor(base));

      const isWeak = element && element === String(b.enemy.weakness ?? "").toLowerCase();
      if (isWeak) dmg *= 2;

      b.enemy.hp -= dmg;
      if (b.enemy.hp < 0) b.enemy.hp = 0;

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
固定ダメ：${dmg}${isWeak ? "（弱点×2）" : ""}
敵HP：${b.enemy.hp}/${b.enemy.hpMax}`
      );
      logLine(`${p.id} アイテム固定ダメ ${it.name} dmg=${dmg}`);

      if (b.enemy.hp <= 0) {
        b.locked = false;
        onBattleWin();
        return;
      }

      finish();
      return;
    }

    case "apply_poison": { // 毒針
      const turns = Number(params.turns ?? 3);
      b.enemy.poisonTurns = Math.max(Number(b.enemy.poisonTurns ?? 0), turns);
      b.enemy.poisonExpr = String(params.poisonExpr ?? b.enemy.poisonExpr ?? "1d6");

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
敵に毒：${turns}ターン（毎ターン ${b.enemy.poisonExpr}）`
      );
      logLine(`${p.id} アイテム毒 ${it.name} turns=${turns}`);
      finish();
      return;
    }

    case "debuff_enemy_def_flat": { // 弱体粉
      const delta = Number(params.delta ?? -4);
      const turns = Number(params.turns ?? 2);
      b.enemy.tempDefFlat = delta;
      b.enemy.tempDefTurns = turns;

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
敵DEF補正：${delta} を ${turns}ターン`
      );
      logLine(`${p.id} アイテムDEFデバフ ${it.name} delta=${delta} turns=${turns}`);
      finish();
      return;
    }

    case "cleanse_self": { // 祈りの札（簡易）
      b.playerStatus.evadeTurns = 0;
      b.playerStatus.nextDamageMinusFlat = 0;
      b.playerStatus.defDiceThisTurn = 0;
      b.playerStatus.escapeBonusNext = 0;
      b.playerStatus.nextAttackElement = null;
      b.playerStatus.nextAtkFlatNext = 0;

      consumeItem();

      setBattleInfo(
`【アイテム：${it.name}】
簡易デバフ解除（回避/祈り/一時防御/逃走補正/次攻撃系をリセット）`
      );
      logLine(`${p.id} アイテム浄化 ${it.name}`);
      finish();
      return;
    }

    default: {
      // 未対応
      consumeItem();
      setBattleInfo(`【アイテム：${it.name}】\nこの効果は未対応です。\n(effectKey: ${key})`);
      logLine(`${p.id} アイテム未対応 ${it.name} key=${key}`);
      finish();
      return;
    }
  }
}



function pickMonsterByDepth(depth) {
  const d = clamp(depth, 1, 5);
  const list = DATA.monsters.byDepth[String(d)];
  return list[(Math.random() * list.length) | 0];
}
function pickBossByDepth(depth) {
  const d = clamp(depth, 1, 5);
  return DATA.bosses.bosses.find(b => b.depth === d) ?? DATA.bosses.bosses[DATA.bosses.bosses.length - 1];
}

function startBattle(kind) {
  const p = currentPlayer();

  // イベントの「次の戦闘だけ」補正を戦闘に持ち込み、プレイヤー側はリセット
  const battleAtkFlatMod = Number(p.nextBattleAtkFlatMod ?? 0);
  const battleDefFlatMod = Number(p.nextBattleDefFlatMod ?? 0);
  p.nextBattleAtkFlatMod = 0;
  p.nextBattleDefFlatMod = 0;

  let enemy;
  let turnLimit;
  if (kind === "boss") { enemy = pickBossByDepth(p.depth); turnLimit = 15; }
  else { enemy = pickMonsterByDepth(p.depth); turnLimit = 10; }

  state.battle = {
    kind,
    enemy: {
      id: enemy.id,
      name: enemy.name,
      hp: enemy.hp,
      hpMax: enemy.hp,
      mp: enemy.mp ?? 0,
      atkExpr: enemy.atkExpr,
      defExpr: enemy.defExpr,
      weakness: enemy.weakness,

      // 既存
      tempDefFlat: 0,
      tempDefTurns: 0,

      // 追加：毒
      poisonTurns: 0,
      poisonExpr: "1d6",
    },
    turnNow: 1,
    turnLimit,
    locked: false,
    freeItemUsedThisTurn: false,

    // 既存：この戦闘だけの固定補正（イベント用）
    playerTempAtkFlat: battleAtkFlatMod,
    playerTempDefFlat: battleDefFlatMod,

    // 追加：戦闘中バフ/状態
    playerMods: { atkFlat: 0, defFlat: 0 }, // 奮起など（戦闘中ずっと）
    playerStatus: {
  evadeTurns: 0,
  nextDamageMinusFlat: 0,
  defDiceThisTurn: 0,
  hp1TripleActive: false,

  escapeBonusNext: 0,       // 逃走ロープ用
  nextAttackElement: null,  // 魔力付与札用（次の通常攻撃の属性）
  nextAtkFlatNext: 0,       // 力の薬用（次の攻撃ATK固定+）
},


    // 追加：覇者の勲功 / 報復射ち
    expMult: 1,
    lastDamageToPlayer: 0,
  };

  logLine(`戦闘開始：${enemy.name}（弱点:${enemy.weakness==="magic"?"魔法":"物理"}）`);
  setBattleInfo(
`戦闘開始：${enemy.name}
弱点：${enemy.weakness==="magic"?"魔法":"物理"}
ターン ${state.battle.turnNow}/${state.battle.turnLimit}`
  );
  renderAll();
}


function enemyActionText() {
  const p = currentPlayer();
  const b = state.battle;
  const enemy = b.enemy;

  // 1) 回避（煙幕回避）
  if ((b.playerStatus?.evadeTurns ?? 0) > 0) {
    b.playerStatus.evadeTurns -= 1;
    b.lastDamageToPlayer = 0;
    const text =
`【敵の攻撃】
回避！
${enemy.name}の攻撃をかわした`;
    logLine(text.replaceAll("\n"," / "));
    return { text, dmg: 0 };
  }

  const enemyAtkRoll = rollExpr(enemy.atkExpr);

  // 2) 守護強化：このターンだけDEFダイス+Xd6
  const extraDefDice = Number(b.playerStatus?.defDiceThisTurn ?? 0);
  if (b.playerStatus) b.playerStatus.defDiceThisTurn = 0;

  const defExpr = adjustDiceExpr(playerDefExpr(p), extraDefDice);
  const playerDefRoll = rollExpr(defExpr);

  const defVal = playerDefRoll.total + playerDefFlatInBattle(p);
  let dmg = Math.max(1, enemyAtkRoll.total - defVal);

  // 3) 守りの祈り：次の被ダメ-固定
  const reduce = Number(b.playerStatus?.nextDamageMinusFlat ?? 0);
  if (reduce > 0) {
    dmg = Math.max(0, dmg - reduce);
    b.playerStatus.nextDamageMinusFlat = 0;
  }

  p.hp -= dmg;
  b.lastDamageToPlayer = dmg;

  const text =
`【敵の攻撃】
敵ATK：${fmtRollShort(enemyAtkRoll)}
自分DEF：${fmtRollShort(playerDefRoll)}${extraDefDice ? `（+${extraDefDice}d6）` : ""} +固定${playerDefFlatInBattle(p)} → ${defVal}
被ダメ：${dmg}
自分HP：${p.hp}/${p.hpMax}`;

  logLine(`敵攻撃 dmg=${dmg} / ${p.id} HP=${p.hp}/${p.hpMax}`);
  return { text, dmg };
}

function offerReturnAfterBoss() {
  const p = currentPlayer();
  const bagSum = p.bagTreasure.reduce((a,b)=>a+b, 0);

  const msg =
    `ボス討伐！\n` +
    `バッグ：${bagSum}G を確定Gにしてスタートへ戻りますか？`;

  showChoice(msg, [
    {
      label: "はい（帰還する）",
      className: "btn primary",
      onClick: () => {
        const pp = currentPlayer();
        const sum = pp.bagTreasure.reduce((a,b)=>a+b, 0);

        pp.bankGold += sum;
        pp.bagTreasure = [];
        pp.pos = 0;
        pp.depth = 1;
        pp.winOnceUsedThisDive = false;
        resetAllSkillCT(pp); // ★ボス帰還でもCT全リセット

        logLine(`${pp.id} ボス後帰還：バッグ${sum}Gを確定（確定G=${pp.bankGold}） → STARTへ`);
        setActionInfo(
          `ボス討伐！帰還しました。\n` +
          `バッグ${sum}G → 確定G\n確定G：${pp.bankGold}G\nSTARTへ戻りました。`
        );

        clearChoice();
        waitContinue("次へ（次のプレイヤー）", endTurn);
      }
    },
    {
      label: "いいえ（帰還しない）",
      className: "btn",
      onClick: () => {
        setActionInfo(`ボス討伐！\n帰還せず続行します。`);
        clearChoice();
        waitContinue("次へ（次のプレイヤー）", endTurn);
      }
    }
  ]);
}

function onPlayerDeath() {
  const p = currentPlayer();

  logLine(`${p.id} は死亡…（バッグ財宝は全ロスト）`);
  setActionInfo(`${p.id} は死亡…\nバッグ財宝は全ロスト。\nSTARTへ戻ります。`);

  // 死亡処理
  p.bagTreasure = [];
  p.pos = 0;
  p.depth = 1;
  p.winOnceUsedThisDive = false;
  resetAllSkillCT(p);

  p.hp = p.hpMax;
  p.mp = p.mpMax;

  state.battle = null;

  // ★ここで自動で次の手番に行かない
  waitContinue("次へ（次のプレイヤー）", endTurn);
}

function requiredExp(p) {
  const atkVal = expectedExpr(playerAtkExpr(p)) + playerAtkFlat(p);
  const defVal = expectedExpr(playerDefExpr(p)) + playerDefFlat(p);
  const avg = (p.hpMax + p.mpMax + atkVal + defVal) / 4;
  return Math.ceil(avg * Math.sqrt(p.level));
}
function expFromBattle(battle) {
  const e = battle.enemy;
  const base = (e.hpMax + (e.mp ?? 0) + expectedExpr(e.atkExpr) + expectedExpr(e.defExpr)) / 4;
  const mult = (battle.kind === "boss") ? 1.6 : 1.0; // ボスは多め（好みで調整）
  return Math.max(1, Math.round(base * mult));
}

function addExpAndLevelUp(p, gained) {
  let ups = 0;
  p.exp += gained;

  while (p.exp >= requiredExp(p)) {
    p.exp -= requiredExp(p);
    p.level += 1;
    p.growthDice = (p.growthDice || 0) + 1; // レベルアップごとに成長ダイス+1
    ups += 1;
  }
  return ups;
}

function applyGrowth(kind) {
  const p = currentPlayer();
  if (!p || (p.growthDice || 0) <= 0) return;

  p.growthDice -= 1;

  if (kind === "HP") {
    const r = rollExpr("1d6");
    p.hpMax += r.total;
    p.hp = Math.min(p.hpMax, p.hp + r.total); // 増えた分だけ回復もしてOK（気持ちいい）
    logLine(`${p.id} 成長：HP +${r.total}（HPMax=${p.hpMax}）`);
    setActionInfo(`成長：HP +${r.total}\n残り成長ダイス：${p.growthDice}`);
  } else if (kind === "MP") {
    const r = rollExpr("1d6");
    p.mpMax += r.total;
    p.mp = Math.min(p.mpMax, p.mp + r.total);
    logLine(`${p.id} 成長：MP +${r.total}（MPMax=${p.mpMax}）`);
    setActionInfo(`成長：MP +${r.total}\n残り成長ダイス：${p.growthDice}`);
  } else if (kind === "ATK") {
    p.atkDiceBonus = (p.atkDiceBonus || 0) + 1;
    logLine(`${p.id} 成長：ATKダイス +1（追加=${p.atkDiceBonus}）`);
    setActionInfo(`成長：ATKダイス +1\n残り成長ダイス：${p.growthDice}`);
  } else if (kind === "DEF") {
    p.defDiceBonus = (p.defDiceBonus || 0) + 1;
    logLine(`${p.id} 成長：DEFダイス +1（追加=${p.defDiceBonus}）`);
    setActionInfo(`成長：DEFダイス +1\n残り成長ダイス：${p.growthDice}`);
  }

   if ((p.growthDice || 0) <= 0) {
  if (state.afterGrowth === "endTurn") {
    state.afterGrowth = null;
    renderAll();
    waitContinue("次へ（次のプレイヤー）", endTurn);
    return;
  }
  if (state.afterGrowth === "bossReturn") {
    state.afterGrowth = null;
    renderAll();
    offerReturnAfterBoss(); // ★ボス討伐後の帰還確認へ
    return;
  }
}

  renderAll();
}

function onBattleWin() {
  const p = currentPlayer();
  const b = state.battle;
  const wasBoss = (b.kind === "boss"); // ★追加：ボス戦だった？


  const base = expFromBattle(b);
  const mult = Number(b.expMult ?? 1);
  const gained = Math.max(1, Math.round(base * mult));

  const beforeLv = p.level;
  const ups = addExpAndLevelUp(p, gained);

// ★追加：LvUPした回数ぶんスキル獲得
  state.battle = null;

  const finalizeAfterLevelUpSkills = () => {
    if ((p.growthDice || 0) > 0) {
      state.afterGrowth = wasBoss ? "bossReturn" : "endTurn";
      setActionInfo(
        `勝利！ EXP+${gained}\n` +
        `LV${beforeLv}→LV${p.level}\n` +
        `成長ダイス：${p.growthDice}\n` +
        `どこを強化しますか？（HP/MPは1d6増、ATK/DEFはダイス+1）`
      );
      renderAll();
      return;
    }

    if (wasBoss) { offerReturnAfterBoss(); return; }

    setActionInfo(`勝利！\nEXP+${gained}\n（ここで「次へ」を押すまで手番が切り替わりません）`);
    waitContinue("次へ（次のプレイヤー）", endTurn);
  };

  // ★LvUPしたなら「スキル選択フロー」を先に実行
  if (ups > 0) {
    startLevelUpSkillFlow(state.turn.playerIndex, ups, finalizeAfterLevelUpSkills);
    return;
  }

  finalizeAfterLevelUpSkills();
}

function doNormalAttack() {
  const p = currentPlayer();
  const b = state.battle;
  if (!b || b.locked) return;

  b.locked = true;
  renderAll();

  const enemy = b.enemy;

  const atkRoll = rollExpr(playerAtkExpr(p));
  const defRoll = rollExpr(enemy.defExpr);

  // 次の通常攻撃の属性（魔力付与札）※1回で消える
  const element = String(b.playerStatus?.nextAttackElement ?? "physical").toLowerCase();
  if (b.playerStatus?.nextAttackElement) b.playerStatus.nextAttackElement = null;

  // 次の攻撃ATK固定（力の薬）※1回で消える
  const nextFlat = Number(b.playerStatus?.nextAtkFlatNext ?? 0);
  if (nextFlat > 0) b.playerStatus.nextAtkFlatNext = 0;

  const atkVal = atkRoll.total + playerAtkFlatInBattle(p) + nextFlat;
  const defVal = defRoll.total + enemyDefExtra(enemy);

  let dmg = Math.max(1, atkVal - defVal);

  // 背水の極意：HP1なら与ダメ×3
  if (b.playerStatus?.hp1TripleActive && p.hp === 1) dmg *= 3;

  // 弱点×2（通常攻撃にも適用）
  const isWeak = element && element === String(enemy.weakness ?? "").toLowerCase();
  if (isWeak) dmg *= 2;

  enemy.hp -= dmg;
  if (enemy.hp < 0) enemy.hp = 0;

  // ---- 表示（②-3の本体）----
  const elementJa = (element === "magic") ? "魔法" : "物理";

  const myText =
`【自分の攻撃（通常）】
属性：${elementJa}${isWeak ? "（弱点×2）" : ""}

自分ATK：${fmtRollShort(atkRoll)} +固定${playerAtkFlatInBattle(p)}${nextFlat ? ` +薬${nextFlat}` : ""} → ${atkVal}
敵DEF：${fmtRollShort(defRoll)} +補正${enemyDefExtra(enemy)} → ${defVal}
与ダメ：${dmg}
敵HP：${enemy.hp}/${enemy.hpMax}
ターン：${b.turnNow}/${b.turnLimit}`;

  logLine(`${p.id} 通常攻撃 dmg=${dmg} / 敵HP=${enemy.hp}/${enemy.hpMax}`);
  setBattleInfo(myText);

  proceedAfterPlayerAction(null);
}

// ---------- escape ----------
function escapeAttempt() {
  const p = currentPlayer();
  const b = state.battle;
  if (!b || b.locked) return;

  b.locked = true;
  renderAll();

const r = rollD6();
const bonusJob = Number(DATA.jobs[p.job].escapeBonus ?? 0);
const bonusItem = Number(b.playerStatus?.escapeBonusNext ?? 0);

const sum = r + bonusJob + bonusItem;

// 1回使ったら消える
if (bonusItem > 0) b.playerStatus.escapeBonusNext = 0;

  const ok = sum >= 4;

  const myText =
`【逃走】
1d6=${r} + 職補正${bonusJob}${bonusItem ? ` + アイテム補正${bonusItem}` : ""} = ${sum}
結果：${ok ? "成功" : "失敗"}`;


  logLine(myText.replaceAll("\n"," / "));
  setBattleInfo(myText);

  if (ok) {
    logLine("逃走成功：1マス戻る（効果発動なし）");
    const prev = (p.pos - 1 + 40) % 40;
    p.pos = prev;
    p.skipNextTileEffect = true;
    state.battle = null;

    resolveTile({ fromBattleRetreat: true, chain: 0 });
    return;
  }

      // 失敗
  proceedAfterPlayerAction(null);
}

// ---------- tile resolve ----------
function resolveTile(opts = {}) {
  const p = currentPlayer();
  const tNow = tileTypeAt(p.pos);

  // ★ボスだけは skip でも止めない（保険）
  if (p.skipNextTileEffect && tNow !== "BOSS") {
    p.skipNextTileEffect = false;
    logLine("（戻ったマスの効果は発動しない）");
    setActionInfo("（戻ったマスの効果は発動しない）");

    applyNonMonsterCTBonus(p);
    waitContinue("次へ（次のプレイヤー）", endTurn);
    return;
  }
  if (p.skipNextTileEffect && tNow === "BOSS") {
    p.skipNextTileEffect = false; // ★消すだけ消して続行
  }

    if (p.pos === RETURN_POS) {
    const bagSum = p.bagTreasure.reduce((a,b)=>a+b, 0);

    const msg =
      `帰還ポイントです。\n` +
      `バッグ：${bagSum}G を確定Gにしてスタートへ戻りますか？`;

    showChoice(msg, [
      {
        label: "はい（帰還する）",
        className: "btn primary",
        onClick: () => {
          const pp = currentPlayer(); // 念のためその場で取得
          const sum = pp.bagTreasure.reduce((a,b)=>a+b, 0);

          pp.bankGold += sum;
          pp.bagTreasure = [];
          pp.pos = 0;
          pp.depth = 1;
          pp.winOnceUsedThisDive = false;
          resetAllSkillCT(pp); // ★帰還でCT全リセット

          logLine(`${pp.id} 帰還：バッグ${sum}Gを確定（確定G=${pp.bankGold}） → STARTへ`);
          setActionInfo(
            `帰還しました。\nバッグ${sum}G → 確定G\n現在の確定G：${pp.bankGold}G\nSTARTへ戻りました。`
          );

          clearChoice();
          applyNonMonsterCTBonus(pp);
          waitContinue("次へ（次のプレイヤー）", endTurn);
        }
      },
      {
        label: "いいえ（帰還しない）",
        className: "btn",
        onClick: () => {
          const pp = currentPlayer();
          setActionInfo(`帰還ポイントに到達。\n（帰還せず手番終了）`);

          clearChoice();
          applyNonMonsterCTBonus(pp);
          waitContinue("次へ（次のプレイヤー）", endTurn);
        }
      }
    ]);

    return;
  }


  const t = tileTypeAt(p.pos);

  if (t === "MONSTER") { startBattle("normal"); return; }
  if (t === "BOSS") { startBattle("boss"); return; }

  if (t === "EVENT") {
    const res = applyEvent(opts);

    // ★移動 or 選択待ちならここで止める
    if (res?.moved || res?.paused) return;

    applyNonMonsterCTBonus(p);
    waitContinue("次へ（次のプレイヤー）", endTurn);
    return;
  }


  if (t === "SAFE") {
    setActionInfo("セーフ：一息つける場所。\n（ここでCTが少し回復します）");
    applyNonMonsterCTBonus(p);
    waitContinue("次へ（次のプレイヤー）", endTurn);
    return;
  }

  if (t === "START") {
    setActionInfo("スタート：入口。\n（現状はここで特別な処理なし）");
    applyNonMonsterCTBonus(p);
    waitContinue("次へ（次のプレイヤー）", endTurn);
    return;
  }

  setActionInfo(`マス：${tileTypeJa(t)}`);
  applyNonMonsterCTBonus(p);
  waitContinue("次へ（次のプレイヤー）", endTurn);
}

// ---------- tooltips content ----------
function itemTooltip(itemId) {
  const it = DATA.itemsById[itemId];
  if (!it) return "";
  return `${it.name}\n効果：${it.desc ?? ""}`.trim();
}
function skillTooltip(p, skillId) {
  const s = DATA.skillsById[skillId];
  if (!s) return "";

  const ctNow = p.skillCT[skillId] ?? 0;
  const ctMax = getSkillCt(s, p);
  const mpCost = getSkillMpCost(s, p);
  const desc = getSkillDesc(s);

  const elementJa =
    s.element === "magic" ? "魔法" :
    s.element === "physical" ? "物理" :
    (s.element ? String(s.element) : "");

  const lines = [
    `${s.name}`,
    `職業：${jobName(s.job)}`,
    elementJa ? `属性：${elementJa}` : null,
    `MP：${mpCost}`,
    `CT：${ctNow}/${ctMax}`,
    `----`,
    desc
  ].filter(Boolean);

  return lines.join("\n");
}


// ---------- render ----------
function renderStatusLine() {
  const el = $("statusText");
  if (!el) return;

  if (!state) { el.textContent = ""; return; }
  el.textContent = `Round ${state.turn.round}/${state.settings.roundsTotal} / 手番: ${currentPlayer().id}`;
}

// 7x7 の外側から内側へ渦巻き（時計回り）に並べる
function buildSpiralCoords(N) {
  const coords = [];
  let left = 0, right = N - 1, top = 0, bottom = N - 1;

  while (left <= right && top <= bottom) {
    // 下段を左→右
    for (let x = left; x <= right; x++) coords.push({ x, y: bottom });
    bottom--;

    // 右列を下→上
    for (let y = bottom; y >= top; y--) coords.push({ x: right, y });
    right--;

    // 上段を右→左
    if (top <= bottom) {
      for (let x = right; x >= left; x--) coords.push({ x, y: top });
      top++;
    }

    // 左列を上→下
    if (left <= right) {
      for (let y = top; y <= bottom; y++) coords.push({ x: left, y });
      left++;
    }
  }
  return coords;
}

function posToCoord(pos) {
  const N = 7;
  const coords = buildSpiralCoords(N);
  return coords[pos]; // pos=0..39 を想定
}


function renderBoard() {
  const root = $("board");
  root.innerHTML = "";

  const N = 7;
  const p = currentPlayer();

  const cellPos = Array.from({ length: N * N }, () => null);
  for (let pos = 0; pos < 40; pos++) {
    const { x, y } = posToCoord(pos);
    cellPos[y * N + x] = pos;
  }

  for (let i = 0; i < N * N; i++) {
    const pos = cellPos[i];
    if (pos == null) {
      const empty = document.createElement("div");
      empty.className = "tile empty";
      root.appendChild(empty);
      continue;
    }

    const type = (pos === RETURN_POS) ? "RETURN" : tileTypeAt(pos);
    const cell = document.createElement("div");
    cell.className = "tile" + (pos === p.pos ? " active" : "");
    const tokens = state.players.filter(pl => pl.pos === pos).map(pl => pl.id);

    cell.innerHTML = `
      <div class="top">
        <div>#${pos}</div>
        <div class="type ${type}">${tileTypeJa(type)}</div>
      </div>
      <div class="tokens">
        ${tokens.map(t=>`<span class="token">${t}</span>`).join("")}
      </div>
    `;
    root.appendChild(cell);
  }
}

function renderPlayerInfo() {
  const root = $("playerInfo");
  if (!root || !state) return;

  const p = currentPlayer(); // ←先に宣言する

  const hpCls = hpMpClass(p.hp, p.hpMax);
  const mpCls = hpMpClass(p.mp, p.mpMax);

   const bagSum = p.bagTreasure.reduce((a, b) => a + b, 0);
    // ---- ATK/DEF 内訳（初期+成長 / 装備 / イベント） ----
  const growthAtkDice = Number(p.atkDiceBonus ?? 0);
  const growthDefDice = Number(p.defDiceBonus ?? 0);

  const equipAtkDice = sumEquip(p, "atkDice");
  const equipDefDice = sumEquip(p, "defDice");

  const baseAtkExpr = adjustDiceExpr(p.atkExpr, growthAtkDice);
  const baseDefExpr = adjustDiceExpr(p.defExpr, growthDefDice);

  const finalAtkExpr = adjustDiceExpr(p.atkExpr, growthAtkDice + equipAtkDice);
  const finalDefExpr = adjustDiceExpr(p.defExpr, growthDefDice + equipDefDice);

  const baseAtkFlat = Number(p.atkFlatBonus ?? 0);
  const baseDefFlat = Number(p.defFlatBonus ?? 0);

  const equipAtkFlat = sumEquip(p, "atkFlat");
  const equipDefFlat = sumEquip(p, "defFlat");

  // イベント補正（戦闘中は battle 側に移されている / 非戦闘中は次戦だけ保持）
  const eventAtkFlat = state?.battle
    ? Number(state.battle.playerTempAtkFlat ?? 0)
    : Number(p.nextBattleAtkFlatMod ?? 0);

  const eventDefFlat = state?.battle
    ? Number(state.battle.playerTempDefFlat ?? 0)
    : Number(p.nextBattleDefFlatMod ?? 0);

  // 合計（表示用）
  const totalAtkFlat = baseAtkFlat + equipAtkFlat + eventAtkFlat + (state?.battle ? Number(state.battle.playerMods?.atkFlat ?? 0) : 0);
  const totalDefFlat = baseDefFlat + equipDefFlat + eventDefFlat + (state?.battle ? Number(state.battle.playerMods?.defFlat ?? 0) : 0);

  const atkExprNow = playerAtkExpr(p);
  const defExprNow = playerDefExpr(p);

  // 戦闘中だけ表示を戦闘補正込みにしたい場合
  const atkFlatNow = state?.battle ? playerAtkFlatInBattle(p) : playerAtkFlat(p);
  const defFlatNow = state?.battle ? playerDefFlatInBattle(p) : playerDefFlat(p);

  const eqWeapon = p.equip.weapon ? DATA.equipmentById[p.equip.weapon] : null;
  const eqArmor  = p.equip.armor ? DATA.equipmentById[p.equip.armor] : null;
  const eqAcc    = p.equip.accessory ? DATA.equipmentById[p.equip.accessory] : null;

  const skillsHtml = p.skillsEquipped.map(id => {
    const s = DATA.skillsById[id];
    const ct = p.skillCT[id] ?? 0;
    return `<div class="small" data-tip="${escapeAttr(skillTooltip(p, id))}">
      ${escapeHtml(s.name)} <span class="${ct > 0 ? "bad" : "good"}">CT:${ct}</span>
    </div>`;
  }).join("");

  const itemsHtml = (p.items.length === 0)
    ? `<div class="small">（なし）</div>`
    : p.items.map(id => {
        const it = DATA.itemsById[id];
        return `<div class="small" data-tip="${escapeAttr(itemTooltip(id))}">${escapeHtml(it.name)}</div>`;
      }).join("");

  const bagGearHtml = (p.gearBag.length === 0)
    ? `<div class="small">（なし）</div>`
    : p.gearBag.map((id, i) => {
        const g = DATA.equipmentById[id];
        return `
          <div class="small dndGear"
            draggable="true"
            data-dnd-gear="1"
            data-from="bag"
            data-idx="${i}"
            data-gear="${escapeAttr(id)}"
            data-tip="${escapeAttr(equipTooltip(id))}">
            ${escapeHtml(g.name)}
          </div>
        `;
      }).join("");

  root.innerHTML = `
    <div class="panelTitle">プレイヤー</div>

    <div class="kv"><div>ID</div><div>${escapeHtml(p.id)}（${escapeHtml(jobName(p.job))}）</div></div>
    <div class="kv"><div>HP</div><div><span class="${hpCls}">${p.hp}/${p.hpMax}</span></div></div>
    <div class="kv"><div>MP</div><div><span class="${mpCls}">${p.mp}/${p.mpMax}</span></div></div>

    <div class="kv"><div>ATK</div><div>${escapeHtml(finalAtkExpr)} + 固定${totalAtkFlat}</div></div>
    <div class="kv"><div>DEF</div><div>${escapeHtml(finalDefExpr)} + 固定${totalDefFlat}</div></div>


    <div class="kv"><div>Lv</div><div>${p.level}</div></div>
    <div class="kv"><div>位置</div><div>#${p.pos} / 深度${p.depth}</div></div>
    <div class="kv"><div>確定G</div><div>${p.bankGold}G</div></div>
    <div class="kv"><div>バッグG</div><div>${bagSum}G</div></div>

    <div class="hr"></div>

    <div><b>装備中（ドラッグで入替）</b></div>

    <div class="small dndSlot"
      data-drop-target="slot"
      data-slot="weapon"
      data-tip="${escapeAttr(eqWeapon ? equipTooltip(eqWeapon.id) : "武器枠")}">
      武器：
      ${
        eqWeapon
          ? `<span class="dndGear"
              draggable="true"
              data-dnd-gear="1"
              data-from="slot"
              data-slot="weapon"
              data-gear="${escapeAttr(eqWeapon.id)}"
              data-tip="${escapeAttr(equipTooltip(eqWeapon.id))}">
              ${escapeHtml(eqWeapon.name)}
            </span>`
          : `<span class="small note">（なし）</span>`
      }
    </div>

    <div class="small dndSlot"
      data-drop-target="slot"
      data-slot="armor"
      data-tip="${escapeAttr(eqArmor ? equipTooltip(eqArmor.id) : "防具枠")}">
      防具：
      ${
        eqArmor
          ? `<span class="dndGear"
              draggable="true"
              data-dnd-gear="1"
              data-from="slot"
              data-slot="armor"
              data-gear="${escapeAttr(eqArmor.id)}"
              data-tip="${escapeAttr(equipTooltip(eqArmor.id))}">
              ${escapeHtml(eqArmor.name)}
            </span>`
          : `<span class="small note">（なし）</span>`
      }
    </div>

    <div class="small dndSlot"
      data-drop-target="slot"
      data-slot="accessory"
      data-tip="${escapeAttr(eqAcc ? equipTooltip(eqAcc.id) : "装飾枠")}">
      装飾：
      ${
        eqAcc
          ? `<span class="dndGear"
              draggable="true"
              data-dnd-gear="1"
              data-from="slot"
              data-slot="accessory"
              data-gear="${escapeAttr(eqAcc.id)}"
              data-tip="${escapeAttr(equipTooltip(eqAcc.id))}">
              ${escapeHtml(eqAcc.name)}
            </span>`
          : `<span class="small note">（なし）</span>`
      }
    </div>

    <div class="hr"></div>

    <div><b>バッグ装備（装備枠へドラッグ / ここへドロップで外す）</b></div>
    <div id="bagDropZone" class="dndBag" data-drop-target="bag">
      ${bagGearHtml}
    </div>

    <div class="hr"></div>
    <div><b>スキル（触ると効果）</b></div>
    ${skillsHtml || `<div class="small">（なし）</div>`}

    <div class="hr"></div>
    <div><b>アイテム（触ると効果）</b></div>
    ${itemsHtml}
  `;
}


function renderActions() {
  const btnRoot = $("actionButtons");
  btnRoot.innerHTML = "";
  // ★選択ボタン待ち（confirm/prompt代替）を最優先で表示
  if (state.awaitingChoice) {
    const { options } = state.awaitingChoice;

    options.forEach(opt => {
      const b = document.createElement("button");
      b.className = opt.className ?? "btn";
      b.textContent = opt.label ?? "選択";
      b.disabled = !!opt.disabled;
      if (opt.tip) b.dataset.tip = opt.tip;

      b.onclick = () => {
        if (b.disabled) return;
        if (typeof opt.onClick === "function") opt.onClick();
      };

      btnRoot.appendChild(b);
    });
    return;
  }


  // “次へ待ち” の時は次へ＋ホームだけ
  if (state.awaitingContinue) {
    const btnNext = document.createElement("button");
    btnNext.className = "btn primary";
    btnNext.textContent = state.awaitingContinue.label ?? "次へ";
    btnNext.disabled = !state.awaitingContinue.enabled;
    btnNext.onclick = () => {
      if (!state.awaitingContinue.enabled) return;
      const cb = state.awaitingContinue.cb;
      state.awaitingContinue = null;
      cb();
    };

    btnRoot.appendChild(btnNext);
    return;
  }
  // --- LvUPスキル入替：捨てるスキルを4ボタンで選ぶ ---
  if (state.pendingSkillChoice) {
    const { playerIndex, newSkillId } = state.pendingSkillChoice;
    const p = state.players[playerIndex];

    const ids = [...p.skillsEquipped, newSkillId]; // 3つ＋新で4つ
    ids.forEach(id => {
      const s = DATA.skillsById[id];
      const name = s?.name ?? id;
      const isNew = (id === newSkillId);

      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = isNew ? `【新】${name} を捨てる` : `${name} を捨てる`;
      b.dataset.tip = skillTooltip(p, id); // 既存のツールチップを流用
      b.onclick = () => chooseSkillToDiscard(id);

      btnRoot.appendChild(b);
    });
    return;
  }

    // 成長ダイスがあるなら、ここで振り分けを優先する
  const p = currentPlayer();
  if (!state.battle && (p.growthDice || 0) > 0) {
    const mk = (label, kind) => {
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = label;
      b.onclick = () => applyGrowth(kind);
      return b;
    };

    btnRoot.appendChild(mk("HP +1d6", "HP"));
    btnRoot.appendChild(mk("MP +1d6", "MP"));
    btnRoot.appendChild(mk("ATK ダイス+1", "ATK"));
    btnRoot.appendChild(mk("DEF ダイス+1", "DEF"));
    return;
  }


  // 通常時の操作
  const btnMove = document.createElement("button");
  btnMove.className = "btn primary";
  btnMove.textContent = "移動（1d6）";
  btnMove.onclick = moveRoll;

  const btnEquip = document.createElement("button");
  btnEquip.className = "btn";
  btnEquip.textContent = "装備";
  btnEquip.onclick = openEquipManager;

  btnRoot.appendChild(btnMove);
  btnRoot.appendChild(btnEquip);
 }

 function renderBattlePanel() {
  const root = $("battlePanel");
  const p = currentPlayer();
  const b = state.battle;

  if (!b) { root.innerHTML = ""; return; }

  const enemy = b.enemy;

  // スキル候補
  const skillOpts = p.skillsEquipped.map(id => {
    const s = DATA.skillsById[id];
    const mp = getSkillMpCost(s, p);
    const ct = getSkillCt(s, p);
    const cur = p.skillCT[id] ?? 0;
    const usable = (cur === 0 && p.mp >= mp);
    return { id, s, mp, ct, cur, usable };
  });

  // アイテム候補
  const itemOpts = p.items.map(id => {
    const it = DATA.itemsById[id];
    return { id, it };
  });

  root.innerHTML = `
    <div class="panelTitle">戦闘</div>
    <div id="battleInfo" class="infoBox">${escapeHtml(state.ui.battleInfo || "")}</div>

    <div class="kv"><div>敵</div><div>${enemy.name}</div></div>
    <div class="kv"><div>敵HP</div><div>${enemy.hp}/${enemy.hpMax}</div></div>
    <div class="kv"><div>弱点</div><div>${enemy.weakness==="magic"?"魔法":"物理"}</div></div>
    <div class="kv"><div>ターン</div><div>${b.turnNow}/${b.turnLimit}</div></div>

    <div class="btnRow">
      <button class="btn primary" id="btnAtk">通常攻撃</button>
      <button class="btn" id="btnEscape">逃走</button>
    </div>

    <div class="hr"></div>

    <div><b>スキル（押すだけ）</b></div>
<div id="skillBtns" class="btnWrap"></div>


    <div class="hr"></div>

    <div><b>アイテム（押すだけ / ターン消費なし）</b></div>
<div id="itemBtns" class="btnWrap"></div>


    <div class="small note">※結果はここに残ります（次へを押すまで手番は切り替わりません）</div>
  `;

  // --- スキルをボタンで並べる（押すだけ発動） ---
const skillBtns = $("skillBtns");
if (skillBtns) {
  if (skillOpts.length === 0) {
    skillBtns.innerHTML = `<div class="small note">（なし）</div>`;
  } else {
    skillBtns.innerHTML = skillOpts.map(o => {
      const label = `${o.s.name}（MP${o.mp} / CT${o.cur}）`;
      const tip = `${o.s.name}\n${getSkillDesc(o.s)}\n必要MP:${o.mp}\nCT:${o.cur}/${o.ct}`;
      const dim = (o.cur > 0 || p.mp < o.mp) ? "dim" : "";
      const disabled = b.locked ? "disabled" : "";
      return `
        <button class="btn ${dim}" data-skill="${escapeAttr(o.id)}" ${disabled}
          data-tip="${escapeAttr(tip)}">
          ${escapeHtml(label)}
        </button>
      `;
    }).join("");

    // クリックで即発動
    skillBtns.querySelectorAll("[data-skill]").forEach(btn => {
      btn.onclick = () => useSkillInBattle(btn.dataset.skill);
    });
  }
}
  // ボタン有効/無効
  $("btnAtk").disabled = b.locked;
  $("btnEscape").disabled = b.locked;

  $("btnAtk").onclick = doNormalAttack;
  $("btnEscape").onclick = escapeAttempt;
  // --- アイテムをボタンで並べる（押すだけ / ターン消費なし） ---
const itemBtns = $("itemBtns");
if (itemBtns) {
  if (itemOpts.length === 0) {
    itemBtns.innerHTML = `<div class="small note">（なし）</div>`;
  } else {
    itemBtns.innerHTML = itemOpts.map(o => {
      const tip = `${o.it.name}\n${getItemDesc(o.it)}`;
      const disabled = (b.locked || b.freeItemUsedThisTurn) ? "disabled" : "";
      const dim = b.freeItemUsedThisTurn ? "dim" : "";
      return `
        <button class="btn ${dim}" data-item="${escapeAttr(o.id)}" ${disabled}
          data-tip="${escapeAttr(tip)}">
          ${escapeHtml(o.it.name)}
        </button>
      `;
    }).join("");

    itemBtns.querySelectorAll("[data-item]").forEach(btn => {
      btn.onclick = () => useItemInBattle(btn.dataset.item, { freeAction: true });
    });
  }
}
}

function renderLog() {
  if (!state) return;
  $("log").textContent = state.log.join("\n");
  const el = $("log");
  el.scrollTop = el.scrollHeight;
}

function renderAll() {
  renderStatusLine();
  renderBoard();
  renderPlayerInfo();
  renderActions();
  renderBattlePanel();
  renderLog();
}

// ---------- boot ----------
async function boot() {
  DATA = await loadAllData();
  BOSS_POS = DATA.board.tiles.findIndex(t => t === "BOSS");
if (BOSS_POS < 0) console.warn("BOSS が board.json に見つかりません");

  setupTooltip();
  initEquipDnD();

function openOptions() {
  const m = $("optionsModal");
  if (!m) return;

  // slider 初期値
  const speed = $("optSpeed");
  const speedVal = $("optSpeedVal");
  const tile = $("optTile");
  const tileVal = $("optTileVal");

  speed.value = String(RESULT_DELAY_MS);
  speedVal.textContent = `${RESULT_DELAY_MS}ms`;

  const curTile = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--tileSize")) || 74;
  tile.value = String(curTile);
  tileVal.textContent = `${curTile}px`;

  // 変更反映
  speed.oninput = () => {
    RESULT_DELAY_MS = Number(speed.value);
    speedVal.textContent = `${RESULT_DELAY_MS}ms`;
  };

  tile.oninput = () => {
    const v = Number(tile.value);
    document.documentElement.style.setProperty("--tileSize", `${v}px`);
    tileVal.textContent = `${v}px`;
  };

  m.classList.remove("hidden");
}
function closeOptions() {
  const m = $("optionsModal");
  if (!m) return;
  m.classList.add("hidden");
}

const homeBtn = $("btnHomeTop");
if (homeBtn) homeBtn.onclick = goHome;

const optBtn = $("btnOptionsTop");
if (optBtn) optBtn.onclick = openOptions;

const closeBtn = $("btnOptClose");
if (closeBtn) closeBtn.onclick = closeOptions;

const modal = $("optionsModal");
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target && e.target.id === "optionsModal") closeOptions();
  });
} else {
  console.warn("optionsModal が見つかりません。index.html が読み替わっていない/キャッシュの可能性があります。");
}
  // --- ここから追加：DATA読み込み後にUIを初期化 ---
  const pc = $("playersCount");
  if (pc) pc.addEventListener("change", buildJobSelectors);
  else console.warn("playersCount が index.html にありません");

  const btnStart = $("btnStart");
  if (btnStart) btnStart.addEventListener("click", startGame);
  else console.warn("btnStart が見つかりません");

  buildJobSelectors();
  // --- 追加ここまで ---

}
window.addEventListener("DOMContentLoaded", () => {
  boot().catch(err => {
    console.error(err);
    alert("起動エラー: " + err.message);
  });
});

function updateVersionLabel(){
  const el = document.getElementById("versionLabel");
  if (el) el.textContent = `ver ${APP_VERSION}`;
}

window.addEventListener("DOMContentLoaded", () => {
  updateVersionLabel();
});
