import { test } from "node:test";
import assert from "node:assert/strict";

await import("../content.js");
const C = globalThis.AM_CONTENT;

const PILLARS = ["corps", "focus", "viepro", "savoir", "lien", "ame"];
const VP_TYPES = ["business", "ecole", "travail"];
const MODES = ["morning", "boost", "bilan", "avis", "regression", "chat"];
const STEPS = ["welcome", "who", "pain", "dissonance", "intention", "viepro", "diagnostic", "objectives", "tasks", "group", "oath"];

const D = { type: "daily" };
const E2 = { type: "every_n_days", n: 2 };
const W = (n) => ({ type: "per_week", n });

// Parcours SPEC §3.7 : [freq, difficulty, minutes]
const PATH = {
  corps: [[E2, 2, 10], [W(3), 4, 60], [D, 3, 5]],
  focus: [[D, 2, 30], [D, 3, 10], [D, 4, 120]],
  savoir: [[D, 2, 15], [D, 3, 20], [W(1), 3, 30]],
  lien: [[E2, 1, 10], [W(2), 3, 60], [W(1), 3, 60]],
  ame: [[D, 2, 5], [D, 2, 5], [D, 3, 20]],
  "viepro:business": [[D, 2, 15], [D, 3, 60], [D, 4, 60]],
  "viepro:ecole": [[D, 2, 30], [D, 3, 45], [D, 4, 120]],
  "viepro:travail": [[D, 1, 5], [D, 3, 60], [D, 3, 30]],
};
const PATH_MINRANK = { 1: 0, 2: 1, 3: 6 };

function validFreq(f) {
  if (!f || typeof f !== "object") return false;
  if (f.type === "daily") return Object.keys(f).length === 1;
  if (f.type === "every_n_days") return Number.isInteger(f.n) && f.n >= 2 && f.n <= 7;
  if (f.type === "per_week") return Number.isInteger(f.n) && f.n >= 1 && f.n <= 7;
  return false;
}
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

test("AM_CONTENT est posé sur globalThis", () => {
  assert.ok(C && typeof C === "object");
});

test("piliers, rangs, types vie pro, émotions", () => {
  assert.deepEqual(C.pillars.map((p) => p.id), PILLARS);
  for (const p of C.pillars) {
    assert.ok(nonEmpty(p.emoji) && nonEmpty(p.name.fr) && nonEmpty(p.name.en));
  }
  assert.equal(C.ranks.length, 5);
  assert.deepEqual(C.ranks.map((r) => r.letter), ["D", "C", "B", "A", "S"]);
  for (const r of C.ranks) {
    assert.match(r.color, /^#[0-9a-f]{6}$/i);
    assert.ok(nonEmpty(r.name.fr) && nonEmpty(r.name.en) && nonEmpty(r.meaning.fr) && nonEmpty(r.meaning.en));
  }
  assert.deepEqual(C.vieProTypes.map((v) => v.id), VP_TYPES);
  assert.equal(C.emotions.length, 7);
  for (const e of C.emotions) assert.ok(nonEmpty(e.id) && nonEmpty(e.fr) && nonEmpty(e.en));
});

test("diagnostic : 24 questions, 4 par pilier, 6 options fr/en", () => {
  assert.equal(C.diagnostic.length, 24);
  const ids = new Set(C.diagnostic.map((q) => q.id));
  assert.equal(ids.size, 24);
  for (const p of PILLARS) {
    assert.equal(C.diagnostic.filter((q) => q.pillar === p).length, 4, p);
  }
  for (const q of C.diagnostic) {
    assert.ok(nonEmpty(q.q.fr) && nonEmpty(q.q.en), q.id);
    assert.equal(q.options.fr.length, 6, q.id);
    assert.equal(q.options.en.length, 6, q.id);
    for (const o of [...q.options.fr, ...q.options.en]) assert.ok(nonEmpty(o), q.id);
    assert.doesNotMatch(q.q.fr, /te sens-tu|discipliné/i, q.id);
  }
});

test("ui : mêmes clés fr/en, textes non vides, placeholders identiques", () => {
  const fr = Object.keys(C.ui.fr).sort();
  const en = Object.keys(C.ui.en).sort();
  assert.deepEqual(fr, en);
  assert.ok(fr.length >= 100, `seulement ${fr.length} clés`);
  const ph = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");
  for (const k of fr) {
    assert.ok(nonEmpty(C.ui.fr[k]) && nonEmpty(C.ui.en[k]), k);
    assert.equal(ph(C.ui.fr[k]), ph(C.ui.en[k]), `placeholders ${k}`);
  }
  for (const k of ["tab_today", "tab_progress", "tab_notes", "tab_mentor", "tab_group", "group_privacy"]) {
    assert.ok(k in C.ui.fr, k);
  }
});

test("onboarding : 11 étapes, mêmes clés fr/en", () => {
  assert.deepEqual(Object.keys(C.onboarding.fr), STEPS);
  assert.deepEqual(Object.keys(C.onboarding.en), STEPS);
  for (const s of STEPS) {
    const f = C.onboarding.fr[s], e = C.onboarding.en[s];
    assert.ok(nonEmpty(f.title) && nonEmpty(e.title), s);
    assert.ok(nonEmpty(f.subtitle) && nonEmpty(e.subtitle), s);
    assert.deepEqual(Object.keys(f).sort(), Object.keys(e).sort(), s);
    if (f.fields) assert.deepEqual(Object.keys(f.fields).sort(), Object.keys(e.fields).sort(), s);
    if (f.examples) assert.equal(f.examples.length, e.examples.length, s);
  }
  for (const k of ["name", "age", "occupation", "wake", "sleep", "timeSinks", "abandoned"]) {
    assert.ok(k in C.onboarding.fr.who.fields, k);
  }
});

test("bibliothèque de tâches : taille, ids, champs valides", () => {
  const L = C.taskLibrary;
  assert.ok(L.length >= 90, `seulement ${L.length}`);
  assert.equal(new Set(L.map((t) => t.id)).size, L.length, "ids uniques");
  for (const t of L) {
    assert.ok(PILLARS.includes(t.pillar), t.id);
    if (t.pillar === "viepro") assert.ok(VP_TYPES.includes(t.vieProType), t.id);
    else assert.equal(t.vieProType, null, t.id);
    assert.ok(Number.isInteger(t.minRank) && t.minRank >= 0 && t.minRank <= 12, t.id);
    assert.ok(validFreq(t.freq), `freq ${t.id}`);
    assert.ok(Number.isInteger(t.difficulty) && t.difficulty >= 1 && t.difficulty <= 5, t.id);
    assert.ok(Number.isInteger(t.minutes) && t.minutes >= 1 && t.minutes <= 240, t.id);
    assert.ok(nonEmpty(t.title.fr) && nonEmpty(t.title.en), t.id);
    assert.ok(nonEmpty(t.why.fr) && nonEmpty(t.why.en), t.id);
    assert.ok(t.why.fr.length <= 140 && t.why.en.length <= 140, `why trop long ${t.id}`);
    assert.doesNotMatch(t.title.fr + " " + t.title.en, /bilan|review of the soul|soul review/i, t.id);
    if ("pathStep" in t) assert.ok([1, 2, 3].includes(t.pathStep), t.id);
  }
  for (const p of PILLARS) {
    assert.ok(L.filter((t) => t.pillar === p && t.minRank === 0).length >= 3, `minRank 0 ${p}`);
  }
  for (const v of VP_TYPES) {
    assert.ok(L.filter((t) => t.vieProType === v).length >= 6, `type ${v}`);
  }
});

test("tâches imposées : 100 pompes, sport 3x/semaine, lire 10 pages", () => {
  const L = C.taskLibrary;
  const pompes = L.filter((t) => /100 pompes/i.test(t.title.fr));
  assert.ok(pompes.some((t) => t.minRank === 0 && t.freq.type === "every_n_days" && t.freq.n === 2 && t.difficulty === 2 && t.minutes === 10));
  const sport = L.filter((t) => t.pillar === "corps" && t.freq.type === "per_week" && t.freq.n === 3 && t.difficulty === 4 && t.minutes === 60);
  assert.ok(sport.some((t) => t.minRank === 3 && !t.pathStep), "sport minRank 3");
  assert.ok(sport.some((t) => t.minRank === 1 && t.pathStep === 2), "sport parcours");
  assert.ok(L.some((t) => /lire 10 pages/i.test(t.title.fr) && t.freq.type === "daily" && t.minRank === 0));
});

test("parcours SPEC §3.7 : une tâche par pilier × étape (× type viepro)", () => {
  const L = C.taskLibrary;
  for (const [key, steps] of Object.entries(PATH)) {
    const [pillar, vp] = key.split(":");
    steps.forEach(([freq, diff, min], i) => {
      const step = i + 1;
      const found = L.filter((t) => t.pillar === pillar && t.pathStep === step && (vp ? t.vieProType === vp : t.vieProType === null));
      assert.equal(found.length, 1, `${key}/${step}`);
      const t = found[0];
      assert.deepEqual(t.freq, freq, `freq ${key}/${step}`);
      assert.equal(t.difficulty, diff, `diff ${key}/${step}`);
      assert.equal(t.minutes, min, `min ${key}/${step}`);
      assert.equal(t.minRank, PATH_MINRANK[step], `minRank ${key}/${step}`);
    });
  }
  // aucune autre tâche de parcours
  assert.equal(L.filter((t) => t.pathStep).length, 24);
});

test("mentor de secours, boosts, serment", () => {
  for (const lang of ["fr", "en"]) {
    for (const m of MODES) {
      const arr = C.coachFallback[lang][m];
      assert.ok(Array.isArray(arr) && arr.length >= 8, `${lang}.${m}`);
      for (const s of arr) assert.ok(nonEmpty(s), `${lang}.${m}`);
    }
    assert.ok(C.boosts[lang].length >= 30, `boosts ${lang}`);
    assert.ok(C.boostsAllDone[lang].length >= 10, `boostsAllDone ${lang}`);
    for (const s of [...C.boosts[lang], ...C.boostsAllDone[lang]]) assert.ok(nonEmpty(s));
    assert.ok(nonEmpty(C.oath[lang]));
    const lines = C.oath[lang].split("\n").filter((l) => l.trim());
    assert.ok(lines.length >= 3 && lines.length <= 5, `oath ${lang} lignes`);
  }
  assert.ok(C.coachFallback.fr.chat.some((s) => /confiance/i.test(s)), "chat fr invite à parler à quelqu'un");
  assert.ok(C.coachFallback.en.chat.some((s) => /trust/i.test(s)), "chat en invite à parler à quelqu'un");
});
