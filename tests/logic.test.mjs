import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(here, "..", "logic.js")).href);
const L = globalThis.AM_LOGIC;

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const START = "2026-01-05"; // lundi

function mkTask(id, pillar, freq, d, m, createdAt = START, extra = {}) {
  const v = L.taskValue(d, m);
  return {
    id, pillar, title: id, freq, difficulty: d, minutes: m,
    points: v.points, penalty: v.penalty, createdAt,
    active: true, deactivatedAt: null, source: "custom", why: "", ...extra,
  };
}

function mkState(over = {}) {
  return {
    version: 1, startDate: START, startIndex: 0, seedPoints: 0,
    tasks: [], log: {}, rank: { index: 0, lastEvalDate: L.addDays(START, -1) },
    rankHistory: [], pendingRegression: null, ...over,
  };
}

function markDone(log, date, id) {
  log[date] = log[date] || {};
  log[date][id] = "done";
}

// ---------- API ----------
test("exposes exactly the SPEC 7.3 members", () => {
  const expected = [
    "PILLARS", "RANK_LABELS", "THRESHOLDS", "EASY_MISS_MULTIPLIER",
    "todayStr", "addDays", "daysBetween", "dayIndex", "isoWeekStart",
    "taskValue", "isDue", "weekProgress", "computePoints", "livePoints",
    "computeDiscipline", "computeStreak", "daysSinceStart", "computeTargetIndex",
    "rankInfo", "nextThreshold", "slotsFor", "countSlotTasks", "nextUnlockPillar",
    "startIndexFromDiagnostic", "evaluateRank", "applyDownEvents", "taskStats",
    "missedPattern", "todayProgress", "canMark", "toggleDone", "newId",
  ].sort();
  assert.deepEqual(Object.keys(L).sort(), expected);
  assert.deepEqual(L.PILLARS, ["corps", "focus", "viepro", "savoir", "lien", "ame"]);
  assert.equal(L.RANK_LABELS.length, 13);
  assert.equal(L.RANK_LABELS[12], "S");
  assert.equal(L.EASY_MISS_MULTIPLIER, 1.4);
});

// ---------- taskValue ----------
test("taskValue examples", () => {
  assert.deepEqual(L.taskValue(2, 10), { points: 16, penalty: 22 });
  assert.deepEqual(L.taskValue(4, 60), { points: 40, penalty: 28 });
  assert.deepEqual(L.taskValue(1, 15), { points: 10, penalty: 14 });
  assert.deepEqual(L.taskValue(4, 180), { points: 60, penalty: 42 });
  assert.deepEqual(L.taskValue(9, 9999), L.taskValue(5, 240));
});

// ---------- dates ----------
test("dates: DST end of October + weekdays", () => {
  assert.equal(L.addDays("2026-10-24", 2), "2026-10-26");
  assert.equal(L.daysBetween("2026-10-24", "2026-10-26"), 2);
  assert.equal(L.addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(L.daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(L.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(L.dayIndex("2026-10-26"), 0);
  assert.equal(L.dayIndex("2026-11-01"), 6);
  assert.equal(L.isoWeekStart("2026-11-01"), "2026-10-26");
  assert.equal(L.isoWeekStart("2026-10-26"), "2026-10-26");
  assert.equal(L.todayStr(new Date(2026, 9, 25, 23, 30)), "2026-10-25");
  assert.equal(L.todayStr(new Date(2026, 0, 2, 0, 5)), "2026-01-02");
  assert.match(L.todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- isDue ----------
test("isDue daily bounds and every_n_days", () => {
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10, "2026-01-05",
    { deactivatedAt: "2026-01-10", active: false });
  assert.equal(L.isDue(t, "2026-01-04"), false);
  assert.equal(L.isDue(t, "2026-01-05"), true);
  assert.equal(L.isDue(t, "2026-01-09"), true);
  assert.equal(L.isDue(t, "2026-01-10"), false);
  const e = mkTask("e", "corps", { type: "every_n_days", n: 2 }, 2, 10);
  assert.equal(L.isDue(e, START), true);
  assert.equal(L.isDue(e, L.addDays(START, 1)), false);
  assert.equal(L.isDue(e, L.addDays(START, 2)), true);
  const w = mkTask("w", "lien", { type: "per_week", n: 2 }, 3, 60);
  assert.equal(L.isDue(w, L.addDays(START, 3)), true);
  assert.equal(L.isDue(w, L.addDays(START, -1)), false);
});

// ---------- computePoints ----------
test("computePoints: seedPoints and minimum 0", () => {
  assert.equal(L.computePoints(mkState({ seedPoints: 840 }), START), 840);
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10);
  assert.equal(L.computePoints(mkState({ tasks: [t] }), L.addDays(START, 3)), 0);
});

test("computePoints: wear by task age", () => {
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10);
  for (const [age, gain] of [[29, 16], [30, 12], [59, 12], [60, 8]]) {
    const day = L.addDays(START, age);
    const without = mkState({ seedPoints: 100000, tasks: [t] });
    const log = {}; markDone(log, day, "a");
    const withDone = mkState({ seedPoints: 100000, tasks: [t], log });
    assert.equal(L.computePoints(withDone, day) - L.computePoints(without, day), gain + 22, `age ${age} (gain + pénalité évitée)`);
  }
});

test("computePoints: missed closed day penalised; today not penalised in livePoints", () => {
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10);
  assert.equal(L.computePoints(mkState({ seedPoints: 100, tasks: [t] }), START), 78);
  const today = L.addDays(START, 1);
  const s = mkState({ seedPoints: 100, tasks: [t] });
  assert.equal(L.livePoints(s, today), 78); // yesterday missed, today pending: no penalty
  const log = {}; markDone(log, today, "a");
  assert.equal(L.livePoints(mkState({ seedPoints: 100, tasks: [t], log }), today), 94);
});

test("computePoints: done on non-due day ignored", () => {
  const e = mkTask("e", "corps", { type: "every_n_days", n: 2 }, 2, 10);
  const d1 = L.addDays(START, 1);
  assert.equal(L.computePoints(mkState({ seedPoints: 100, tasks: [e] }), d1), 78);
  const log = {}; markDone(log, d1, "e");
  assert.equal(L.computePoints(mkState({ seedPoints: 100, tasks: [e], log }), d1), 78);
});

test("computePoints: per_week closed week, prorata, extra done ignored", () => {
  const w = mkTask("w", "corps", { type: "per_week", n: 3 }, 4, 60); // 40 / 28
  const log = {}; markDone(log, START, "w");
  const s = mkState({ seedPoints: 1000, tasks: [w], log });
  assert.equal(L.computePoints(s, L.addDays(START, 5)), 1040); // samedi: semaine pas close
  assert.equal(L.computePoints(s, L.addDays(START, 6)), 1040 - 56); // dimanche: 2 manqués

  const thu = L.addDays(START, 3);
  const w2 = mkTask("w2", "corps", { type: "per_week", n: 3 }, 4, 60, thu);
  const log2 = {};
  for (let i = 0; i < 3; i++) markDone(log2, L.addDays(thu, i), "w2");
  const s2 = mkState({ seedPoints: 1000, tasks: [w2], log: log2 });
  assert.deepEqual(L.weekProgress(s2, w2, thu), { done: 3, target: 2 });
  assert.equal(L.computePoints(s2, L.addDays(START, 6)), 1080); // n_eff 2, 3e done ignoré
  // livePoints respects n_eff for today's done
  assert.equal(L.livePoints(s2, L.addDays(thu, 2)), 1080);
});

// ---------- computeDiscipline ----------
test("computeDiscipline: 14-day window, startDate, null, per_week", () => {
  assert.equal(L.computeDiscipline(mkState(), START), null);
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10);
  const log = {};
  for (let i = 0; i <= 18; i++) markDone(log, L.addDays(START, i), "a");
  const s = mkState({ tasks: [t], log });
  assert.equal(L.computeDiscipline(s, L.addDays(START, 20)), 86); // 12/14
  const log2 = {}; markDone(log2, START, "a"); markDone(log2, L.addDays(START, 1), "a");
  assert.equal(L.computeDiscipline(mkState({ tasks: [t], log: log2 }), L.addDays(START, 2)), 67);
  assert.equal(L.computeDiscipline(s, L.addDays(START, -1)), null);

  const w = mkTask("w", "lien", { type: "per_week", n: 2 }, 3, 60);
  const log3 = {}; markDone(log3, START, "w");
  const s3 = mkState({ tasks: [w], log: log3 });
  assert.equal(L.computeDiscipline(s3, L.addDays(START, 5)), null);
  assert.equal(L.computeDiscipline(s3, L.addDays(START, 6)), 50);
});

// ---------- computeTargetIndex / rankInfo ----------
test("computeTargetIndex", () => {
  assert.equal(L.computeTargetIndex(0, null, 0), 0);
  assert.equal(L.computeTargetIndex(1400, 60, 14), 3);
  assert.equal(L.computeTargetIndex(16000, 90, 90), 12);
  assert.equal(L.computeTargetIndex(99999, 100, 13), 2);
  assert.equal(L.computeTargetIndex(1400, 59, 14), 2);
  assert.equal(L.computeTargetIndex(4500, 70, 35), 6);
  assert.equal(L.computeTargetIndex(9000, 80, 60), 9);
});

test("rankInfo, nextThreshold, slots", () => {
  assert.deepEqual(L.rankInfo(0), { label: "D-", letter: "D", sub: "-", mainIndex: 0 });
  assert.deepEqual(L.rankInfo(4), { label: "C", letter: "C", sub: "", mainIndex: 1 });
  assert.deepEqual(L.rankInfo(8), { label: "B+", letter: "B", sub: "+", mainIndex: 2 });
  assert.deepEqual(L.rankInfo(12), { label: "S", letter: "S", sub: "", mainIndex: 4 });
  assert.deepEqual(L.nextThreshold(0), { letter: "C", points: 1400, discipline: 60, days: 14 });
  assert.deepEqual(L.nextThreshold(11), { letter: "S", points: 16000, discipline: 90, days: 90 });
  assert.equal(L.nextThreshold(12), null);
  assert.equal(L.slotsFor(0), 6);
  assert.equal(L.slotsFor(12), 18);
});

test("daysSinceStart", () => {
  const s = mkState();
  assert.equal(L.daysSinceStart(s, START), 1);
  assert.equal(L.daysSinceStart(s, L.addDays(START, 13)), 14);
});

// ---------- evaluateRank ----------
function allDoneState(daysDone, over = {}) {
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10);
  const log = {};
  for (let i = 0; i < daysDone; i++) markDone(log, L.addDays(START, i), "a");
  return mkState({ tasks: [t], log, ...over });
}

test("evaluateRank: one step per day, events and history", () => {
  const s = deepFreeze(allDoneState(60, {
    seedPoints: 99999, rank: { index: 0, lastEvalDate: L.addDays(START, 30) },
  }));
  const today = L.addDays(START, 34); // evaluates days 32,33,34
  const { state, events } = L.evaluateRank(s, today);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => [e.type, e.from, e.to]), [["up", 0, 1], ["up", 1, 2], ["up", 2, 3]]);
  assert.equal(events[0].date, L.addDays(START, 31));
  assert.equal(state.rank.index, 3);
  assert.equal(state.rank.lastEvalDate, L.addDays(START, 33));
  assert.equal(state.rankHistory.length, 3);
  assert.equal(s.rank.index, 0); // non muté
  // re-run same day: nothing
  const again = L.evaluateRank(state, today);
  assert.equal(again.events.length, 0);
});

test("evaluateRank: no descent while days <= 7, then down + pendingRegression", () => {
  const s = deepFreeze(allDoneState(0, { rank: { index: 3, lastEvalDate: L.addDays(START, -1) } }));
  const r1 = L.evaluateRank(s, L.addDays(START, 7)); // days 1..7
  assert.equal(r1.events.length, 0);
  assert.equal(r1.state.rank.index, 3);
  const r2 = L.evaluateRank(r1.state, L.addDays(START, 8)); // day 8
  assert.deepEqual(r2.events.map((e) => e.type), ["down"]);
  assert.equal(r2.state.rank.index, 2);
  assert.deepEqual(r2.state.pendingRegression, { date: L.addDays(START, 7), from: 3, to: 2 });
});

test("evaluateRank: never below startIndex before day 14", () => {
  const s = allDoneState(0, { startIndex: 2, rank: { index: 2, lastEvalDate: L.addDays(START, -1) } });
  const r1 = L.evaluateRank(s, L.addDays(START, 13)); // days 1..13
  assert.equal(r1.state.rank.index, 2);
  assert.equal(r1.events.length, 0);
  const r2 = L.evaluateRank(r1.state, L.addDays(START, 14)); // day 14
  assert.equal(r2.state.rank.index, 1);
});

test("evaluateRank: max 120 days processed", () => {
  const s = allDoneState(400, { seedPoints: 99999, rank: { index: 0, lastEvalDate: START } });
  const today = L.addDays(START, 400);
  const { state, events } = L.evaluateRank(s, today);
  assert.equal(state.rank.lastEvalDate, L.addDays(today, -1));
  assert.ok(events.length <= 120);
  assert.equal(events[0].date, L.addDays(today, -120));
  assert.equal(state.rank.index, 12);
});

test("Review Focus #4: 21 days of absence — penalties, one step/day, < 200 ms", () => {
  const tasks = [];
  L.PILLARS.forEach((p, i) => {
    tasks.push(mkTask(p + "1", p, { type: "daily" }, 3, 30));
    tasks.push(mkTask(p + "2", p, i % 2 ? { type: "every_n_days", n: 2 } : { type: "per_week", n: 3 }, 4, 60));
  });
  tasks.push(mkTask("bilan", "ame", { type: "per_week", n: 1 }, 2, 15, START, { system: true }));
  const log = {};
  for (let i = 0; i < 70; i++) {
    const d = L.addDays(START, i);
    for (const t of tasks) if (L.isDue(t, d)) markDone(log, d, t.id);
  }
  const lastActive = L.addDays(START, 69);
  const s = deepFreeze(mkState({ tasks, log, seedPoints: 2000, rank: { index: 8, lastEvalDate: lastActive } }));
  const today = L.addDays(lastActive, 22);
  const t0 = performance.now();
  const r = L.evaluateRank(s, today);
  const applied = L.applyDownEvents(r.state, r.events, today);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `took ${ms} ms`);
  assert.ok(r.events.length <= 21 && r.events.length > 0);
  for (const e of r.events) assert.equal(Math.abs(e.to - e.from), 1);
  assert.ok(L.computePoints(s, L.addDays(today, -1)) < L.computePoints(s, lastActive));
  assert.ok(r.state.pendingRegression);
  assert.ok(L.countSlotTasks(applied) <= Math.max(L.slotsFor(applied.rank.index), 6));
});

// ---------- applyDownEvents ----------
test("applyDownEvents: most recent first, never last of a pillar, never system", () => {
  const d = (n) => L.addDays(START, n);
  const tasks = [
    mkTask("c1", "corps", { type: "daily" }, 2, 10, d(0)),
    mkTask("c2", "corps", { type: "daily" }, 2, 10, d(5)),
    mkTask("c3", "corps", { type: "daily" }, 2, 10, d(9)),
    mkTask("f1", "focus", { type: "daily" }, 2, 10, d(0)),
    mkTask("f2", "focus", { type: "daily" }, 2, 10, d(12)),
    mkTask("v1", "viepro", { type: "daily" }, 2, 10, d(0)),
    mkTask("s1", "savoir", { type: "daily" }, 2, 10, d(0)),
    mkTask("l1", "lien", { type: "daily" }, 2, 10, d(0)),
    mkTask("a1", "ame", { type: "daily" }, 2, 10, d(20)),
    mkTask("bilan", "ame", { type: "per_week", n: 1 }, 2, 15, d(25), { system: true }),
  ];
  const s = deepFreeze(mkState({ tasks, rank: { index: 0, lastEvalDate: d(30) } }));
  const today = d(31);
  const out = L.applyDownEvents(s, [{ type: "down", date: d(30), from: 1, to: 0 }], today);
  const off = out.tasks.filter((t) => !t.active).map((t) => t.id).sort();
  assert.deepEqual(off, ["c2", "c3", "f2"]);
  for (const t of out.tasks.filter((t) => !t.active)) assert.equal(t.deactivatedAt, today);
  assert.ok(out.tasks.find((t) => t.id === "a1").active);
  assert.ok(out.tasks.find((t) => t.id === "bilan").active);
  assert.equal(L.countSlotTasks(out), 6);
  assert.equal(s.tasks[2].active, true);
  // pas de down => inchangé
  const same = L.applyDownEvents(s, [{ type: "up", date: d(30), from: 0, to: 1 }], today);
  assert.equal(same.tasks.filter((t) => !t.active).length, 0);
});

// ---------- startIndexFromDiagnostic ----------
function diagWithTotal(total) {
  const diag = {};
  let left = total;
  for (const p of L.PILLARS) {
    diag[p] = [0, 0, 0, 0].map(() => { const v = Math.min(5, left); left -= v; return v; });
  }
  return diag;
}

test("startIndexFromDiagnostic", () => {
  const cases = [[47, 0, 0], [48, 1, 420], [71, 1, 420], [72, 2, 840], [120, 2, 840]];
  for (const [total, index, seed] of cases) {
    const r = L.startIndexFromDiagnostic(diagWithTotal(total));
    assert.equal(r.index, index, `total ${total}`);
    assert.equal(r.seedPoints, seed);
    assert.equal(r.percent, Math.round((total / 120) * 100));
  }
  const r = L.startIndexFromDiagnostic(diagWithTotal(47));
  assert.equal(r.perPillar.corps, 20);
  assert.equal(r.perPillar.viepro, 7);
  assert.equal(r.perPillar.ame, 0);
});

// ---------- canMark / toggleDone ----------
test("canMark and toggleDone (pure)", () => {
  const today = "2026-10-29";
  assert.equal(L.canMark(today, today), true);
  assert.equal(L.canMark("2026-10-28", today), true);
  assert.equal(L.canMark("2026-10-27", today), false);
  assert.equal(L.canMark("2026-10-30", today), false);
  const s = deepFreeze(mkState({ tasks: [mkTask("a", "corps", { type: "daily" }, 2, 10)] }));
  const s1 = L.toggleDone(s, "a", today, today);
  assert.equal(s1.log[today].a, "done");
  assert.equal(s.log[today], undefined);
  const s2 = L.toggleDone(deepFreeze(s1), "a", today, today);
  assert.equal(s2.log[today]?.a, undefined);
  assert.equal(L.toggleDone(s, "a", "2026-10-20", today), s);
});

// ---------- computeStreak ----------
test("computeStreak: 80% rule and neutral days", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const tasks = ids.map((id) => mkTask(id, "corps", { type: "daily" }, 2, 10));
  const today = L.addDays(START, 5);
  const log = {};
  ids.slice(0, 3).forEach((id) => markDone(log, L.addDays(START, 2), id)); // 60%
  ids.forEach((id) => markDone(log, L.addDays(START, 3), id)); // 100%
  ids.slice(0, 4).forEach((id) => markDone(log, L.addDays(START, 4), id)); // 80%
  assert.equal(L.computeStreak(mkState({ tasks, log }), today), 2);

  const e = mkTask("e", "corps", { type: "every_n_days", n: 2 }, 2, 10);
  const log2 = {};
  [0, 2, 4].forEach((i) => markDone(log2, L.addDays(START, i), "e"));
  assert.equal(L.computeStreak(mkState({ tasks: [e], log: log2 }), today), 3);
  assert.equal(L.computeStreak(mkState({ tasks: [e], log: log2 }), START), 0);
});

// ---------- nextUnlockPillar ----------
test("nextUnlockPillar reproduces the 12 unlocks of SPEC 3.7", () => {
  let tasks = L.PILLARS.map((p) => mkTask(p + "_1", p, { type: "daily" }, 2, 10));
  tasks.push(mkTask("bilan", "ame", { type: "per_week", n: 1 }, 2, 15, START, { system: true }));
  tasks.push(mkTask("old", "corps", { type: "daily" }, 2, 10, START, { active: false, deactivatedAt: START }));
  const seq = [];
  for (let i = 0; i < 12; i++) {
    const p = L.nextUnlockPillar(deepFreeze({ tasks }));
    seq.push(p);
    tasks = [...tasks, mkTask(p + "_" + (i + 2), p, { type: "daily" }, 2, 10)];
  }
  assert.deepEqual(seq, [...L.PILLARS, ...L.PILLARS]);
  assert.equal(L.countSlotTasks({ tasks }), 18);
});

// ---------- todayProgress / stats ----------
test("todayProgress counts daily/every_n_days due today", () => {
  const today = L.addDays(START, 1);
  const tasks = [
    mkTask("a", "corps", { type: "daily" }, 2, 10),
    mkTask("b", "focus", { type: "daily" }, 2, 10),
    mkTask("e", "lien", { type: "every_n_days", n: 2 }, 1, 10), // pas dû J1
    mkTask("w", "savoir", { type: "per_week", n: 1 }, 3, 30),
    mkTask("bilan", "ame", { type: "per_week", n: 1 }, 2, 15, START, { system: true }),
  ];
  const log = {}; markDone(log, today, "a"); markDone(log, today, "w");
  assert.deepEqual(L.todayProgress(mkState({ tasks, log }), today), { done: 1, due: 2 });
});

test("taskStats and missedPattern", () => {
  const t = mkTask("a", "corps", { type: "daily" }, 2, 10);
  const f = mkTask("f", "focus", { type: "daily" }, 2, 10);
  const log = {};
  for (let i = 0; i < 28; i++) {
    const d = L.addDays(START, i);
    if (L.dayIndex(d) !== 5) markDone(log, d, "a"); // rate le samedi
    markDone(log, d, "f");
  }
  const s = mkState({ tasks: [t, f], log });
  const end = L.addDays(START, 27);
  assert.deepEqual(L.taskStats(s, t, end, 14), { due: 14, done: 12 });
  const mp = L.missedPattern(s, end);
  assert.equal(mp.byWeekday.length, 7);
  assert.equal(mp.byWeekday[5], 4);
  assert.equal(mp.worstWeekday, 5);
  assert.equal(mp.worstPillar, "corps");
  const all = {};
  for (let i = 0; i < 28; i++) { markDone(all, L.addDays(START, i), "a"); markDone(all, L.addDays(START, i), "f"); }
  const mp2 = L.missedPattern(mkState({ tasks: [t, f], log: all }), end);
  assert.equal(mp2.worstWeekday, null);
  assert.equal(mp2.worstPillar, null);
});

test("newId", () => {
  const a = L.newId("t"), b = L.newId("t");
  assert.match(a, /^t_[a-z0-9]+$/);
  assert.notEqual(a, b);
});
