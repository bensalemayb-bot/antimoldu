/* L'Anti-Moldu — logique métier (fonctions pures). Script classique : pose globalThis.AM_LOGIC. */
(function () {
  "use strict";

  var PILLARS = ["corps", "focus", "viepro", "savoir", "lien", "ame"];
  var RANK_LABELS = ["D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+", "S"];
  var THRESHOLDS = [
    { letter: "D", points: 0, discipline: 0, days: 0 },
    { letter: "C", points: 1400, discipline: 60, days: 14 },
    { letter: "B", points: 4500, discipline: 70, days: 35 },
    { letter: "A", points: 9000, discipline: 80, days: 60 },
    { letter: "S", points: 16000, discipline: 90, days: 90 }
  ];
  var EASY_MISS_MULTIPLIER = 1.4;
  var MAX_EVAL_DAYS = 120;
  var DAY_MS = 86400000;

  // ---------- dates (calculs internes en numéro de jour UTC) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toNum(s) {
    var p = String(s).split("-");
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS);
  }
  function fromNum(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function todayStr(date) {
    var d = date instanceof Date ? date : new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function addDays(d, n) { return fromNum(toNum(d) + n); }
  function daysBetween(a, b) { return toNum(b) - toNum(a); }
  function dayIndexNum(n) { return (((n + 3) % 7) + 7) % 7; } // 1970-01-01 = jeudi (3)
  function dayIndex(d) { return dayIndexNum(toNum(d)); }
  function isoWeekStart(d) { var n = toNum(d); return fromNum(n - dayIndexNum(n)); }

  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

  // ---------- valeur ----------
  function taskValue(difficulty, minutes) {
    var d = clamp(Math.round(Number(difficulty) || 1), 1, 5);
    var m = clamp(Number(minutes) || 1, 1, 240);
    var points = clamp(Math.round(d * 7 + m / 5), 5, 60);
    var penalty = points <= 20 ? Math.round(points * EASY_MISS_MULTIPLIER)
      : points >= 35 ? Math.round(points * 0.7) : points;
    return { points: points, penalty: penalty };
  }

  // ---------- échéances ----------
  function freqType(task) { return (task && task.freq && task.freq.type) || "daily"; }
  function freqN(task) { var n = Math.round(Number(task.freq && task.freq.n)); return n >= 1 ? n : 1; }
  // période active [debut, fin) en numéros de jour ; null si jamais active
  function activeRange(task) {
    if (!task || !task.createdAt) return null;
    var start = toNum(task.createdAt);
    var end = Infinity;
    if (task.deactivatedAt) end = toNum(task.deactivatedAt);
    else if (task.active === false) return null;
    return end > start ? [start, end] : null;
  }
  function isActiveNum(range, n) { return !!range && n >= range[0] && n < range[1]; }
  function isDueNum(task, range, n) {
    if (!isActiveNum(range, n)) return false;
    var t = freqType(task);
    if (t === "every_n_days") return (n - range[0]) % freqN(task) === 0;
    return true; // daily, per_week
  }
  function isDue(task, date) { return isDueNum(task, activeRange(task), toNum(date)); }

  function isDone(log, ds, id) { var day = log && log[ds]; return !!day && day[id] === "done"; }
  function wear(range, n) {
    var age = n - range[0];
    return age < 30 ? 1 : age < 60 ? 0.75 : 0.5;
  }
  function nEffNum(task, range, weekStartNum) {
    var active = 0;
    for (var i = 0; i < 7; i++) if (isActiveNum(range, weekStartNum + i)) active++;
    return active ? Math.ceil(freqN(task) * active / 7) : 0;
  }
  // jours « done » (actifs) de la semaine, jusqu'à lastNum inclus, en ordre chronologique
  function weekDoneDays(state, task, range, ws, lastNum) {
    var out = [];
    var stop = Math.min(ws + 6, lastNum);
    for (var n = ws; n <= stop; n++) {
      if (isActiveNum(range, n) && isDone(state.log, fromNum(n), task.id)) out.push(n);
    }
    return out;
  }

  function weekProgress(state, task, date) {
    var range = activeRange(task);
    var ws = toNum(isoWeekStart(date));
    return {
      done: weekDoneDays(state, task, range, ws, ws + 6).length,
      target: nEffNum(task, range, ws)
    };
  }

  function tasksOf(state) { return (state && Array.isArray(state.tasks)) ? state.tasks : []; }
  function num(x, def) { x = Number(x); return isFinite(x) ? x : def; }

  // ---------- points ----------
  function rawPoints(state, uptoNum) {
    var total = num(state.seedPoints, 0);
    var tasks = tasksOf(state);
    var regular = [], weekly = [], minStart = Infinity;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], r = activeRange(t);
      if (!r) continue;
      if (freqType(t) === "per_week") weekly.push([t, r]);
      else { regular.push([t, r]); if (r[0] < minStart) minStart = r[0]; }
    }
    // daily / every_n_days : un passage par jour
    for (var n = minStart; n <= uptoNum && regular.length; n++) {
      var ds = null;
      for (var j = 0; j < regular.length; j++) {
        var task = regular[j][0], range = regular[j][1];
        if (!isDueNum(task, range, n)) continue;
        if (ds === null) ds = fromNum(n);
        if (isDone(state.log, ds, task.id)) total += num(task.points, 0) * wear(range, n);
        else total -= num(task.penalty, 0);
      }
    }
    // per_week
    for (var k = 0; k < weekly.length; k++) {
      var wt = weekly[k][0], wr = weekly[k][1];
      var first = wr[0] - dayIndexNum(wr[0]);
      for (var ws = first; ws <= uptoNum && ws < wr[1]; ws += 7) {
        var target = nEffNum(wt, wr, ws);
        var done = weekDoneDays(state, wt, wr, ws, uptoNum);
        var counted = Math.min(done.length, target);
        for (var c = 0; c < counted; c++) total += num(wt.points, 0) * wear(wr, done[c]);
        if (ws + 6 <= uptoNum) total -= Math.max(0, target - counted) * num(wt.penalty, 0);
      }
    }
    return total;
  }
  function computePoints(state, uptoDate) {
    return Math.max(0, Math.round(rawPoints(state, toNum(uptoDate))));
  }
  function livePoints(state, today) {
    var tn = toNum(today), ds = fromNum(tn), extra = 0;
    var tasks = tasksOf(state);
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], r = activeRange(t);
      if (!isDueNum(t, r, tn) || !isDone(state.log, ds, t.id)) continue;
      if (freqType(t) === "per_week") {
        var ws = tn - dayIndexNum(tn);
        var before = weekDoneDays(state, t, r, ws, tn - 1).length;
        if (before >= nEffNum(t, r, ws)) continue;
      }
      extra += num(t.points, 0) * wear(r, tn);
    }
    return computePoints(state, fromNum(tn - 1)) + Math.round(extra);
  }

  // ---------- discipline ----------
  function startNum(state) { return state && state.startDate ? toNum(state.startDate) : -Infinity; }
  function dueDoneWindow(state, list, fromN, toN) {
    var due = 0, done = 0;
    for (var i = 0; i < list.length; i++) {
      var t = list[i], r = activeRange(t);
      if (!r) continue;
      if (freqType(t) === "per_week") {
        // semaines closes dont le dimanche est dans [fromN, toN]
        var firstSun = fromN + (6 - dayIndexNum(fromN));
        for (var sun = firstSun; sun <= toN; sun += 7) {
          var ws = sun - 6, target = nEffNum(t, r, ws);
          if (!target) continue;
          due += target;
          done += Math.min(weekDoneDays(state, t, r, ws, sun).length, target);
        }
      } else {
        for (var n = Math.max(fromN, r[0]); n <= toN && n < r[1]; n++) {
          if (!isDueNum(t, r, n)) continue;
          due++;
          if (isDone(state.log, fromNum(n), t.id)) done++;
        }
      }
    }
    return { due: due, done: done };
  }
  function computeDiscipline(state, endDate) {
    var end = toNum(endDate);
    var from = Math.max(end - 13, startNum(state));
    if (from > end) return null;
    var r = dueDoneWindow(state, tasksOf(state), from, end);
    return r.due ? Math.round(100 * r.done / r.due) : null;
  }

  // ---------- série ----------
  function computeStreak(state, today) {
    var tasks = tasksOf(state).filter(function (t) { return freqType(t) !== "per_week"; });
    var ranges = tasks.map(activeRange);
    var stop = startNum(state);
    if (stop === -Infinity) {
      stop = Infinity;
      ranges.forEach(function (r) { if (r && r[0] < stop) stop = r[0]; });
      if (stop === Infinity) return 0;
    }
    var streak = 0;
    for (var n = toNum(today) - 1; n >= stop; n--) {
      var ds = fromNum(n), due = 0, done = 0;
      for (var i = 0; i < tasks.length; i++) {
        if (!isDueNum(tasks[i], ranges[i], n)) continue;
        due++;
        if (isDone(state.log, ds, tasks[i].id)) done++;
      }
      if (!due) continue;
      if (done / due >= 0.8) streak++;
      else break;
    }
    return streak;
  }

  // ---------- rangs ----------
  function daysSinceStart(state, date) { return daysBetween(state.startDate, date) + 1; }

  function computeTargetIndex(points, discipline, days) {
    var p = num(points, 0), d = discipline == null ? 0 : num(discipline, 0), j = num(days, 0);
    var R = 0;
    for (var i = 1; i < THRESHOLDS.length; i++) {
      var T = THRESHOLDS[i];
      if (p >= T.points && d >= T.discipline && j >= T.days) R = i; else break;
    }
    if (R === THRESHOLDS.length - 1) return 12;
    var cur = THRESHOLDS[R], nxt = THRESHOLDS[R + 1];
    var pp = clamp((p - cur.points) / (nxt.points - cur.points), 0, 1);
    var dp = clamp(d / nxt.discipline, 0, 1);
    var tp = clamp((j - cur.days) / (nxt.days - cur.days), 0, 1);
    var prog = Math.min(pp, dp, tp);
    var sub = prog < 1 / 3 ? 0 : prog < 2 / 3 ? 1 : 2;
    return R * 3 + sub;
  }

  function rankInfo(index) {
    var i = clamp(Math.round(num(index, 0)), 0, 12);
    var label = RANK_LABELS[i];
    return { label: label, letter: label.charAt(0), sub: label.slice(1), mainIndex: i === 12 ? 4 : Math.floor(i / 3) };
  }
  function nextThreshold(index) {
    var m = rankInfo(index).mainIndex;
    if (m >= 4) return null;
    var T = THRESHOLDS[m + 1];
    return { letter: T.letter, points: T.points, discipline: T.discipline, days: T.days };
  }

  function slotsFor(index) { return 6 + num(index, 0); }
  function isSlot(t) { return t && t.active !== false && !t.system; }
  function countSlotTasks(state) { return tasksOf(state).filter(isSlot).length; }
  function pillarCounts(tasks) {
    var c = {};
    PILLARS.forEach(function (p) { c[p] = 0; });
    tasks.forEach(function (t) { if (isSlot(t) && c[t.pillar] !== undefined) c[t.pillar]++; });
    return c;
  }
  function nextUnlockPillar(state) {
    var c = pillarCounts(tasksOf(state)), best = PILLARS[0];
    PILLARS.forEach(function (p) { if (c[p] < c[best]) best = p; });
    return best;
  }

  function startIndexFromDiagnostic(diagnostic) {
    var perPillar = {}, total = 0;
    PILLARS.forEach(function (p) {
      var arr = (diagnostic && Array.isArray(diagnostic[p])) ? diagnostic[p] : [];
      var s = 0;
      for (var i = 0; i < 4; i++) s += clamp(Math.round(num(arr[i], 0)), 0, 5);
      perPillar[p] = s;
      total += s;
    });
    var index = total < 48 ? 0 : total < 72 ? 1 : 2;
    return { index: index, seedPoints: [0, 420, 840][index], percent: Math.round(total / 120 * 100), perPillar: perPillar };
  }

  function evaluateRank(state, today) {
    var yesterday = addDays(today, -1);
    var rank = state.rank || { index: num(state.startIndex, 0), lastEvalDate: null };
    var last = rank.lastEvalDate || (state.startDate ? addDays(state.startDate, -1) : yesterday);
    var fromN = toNum(last) + 1, toN = toNum(yesterday);
    if (state.startDate) fromN = Math.max(fromN, toNum(state.startDate));
    var events = [];
    if (fromN > toN) return { state: state, events: events };
    if (toN - fromN + 1 > MAX_EVAL_DAYS) fromN = toN - MAX_EVAL_DAYS + 1;
    var idx = clamp(Math.round(num(rank.index, 0)), 0, 12);
    var startIndex = num(state.startIndex, 0);
    for (var n = fromN; n <= toN; n++) {
      var ds = fromNum(n);
      var days = daysSinceStart(state, ds);
      var target = computeTargetIndex(computePoints(state, ds), computeDiscipline(state, ds), days);
      if (target > idx) {
        events.push({ type: "up", date: ds, from: idx, to: idx + 1 });
        idx++;
      } else if (target < idx && days > 7 && !(days < 14 && idx - 1 < startIndex)) {
        events.push({ type: "down", date: ds, from: idx, to: idx - 1 });
        idx--;
      }
    }
    var next = Object.assign({}, state, {
      rank: Object.assign({}, rank, { index: idx, lastEvalDate: yesterday }),
      rankHistory: (Array.isArray(state.rankHistory) ? state.rankHistory : []).concat(events.map(function (e) { return Object.assign({}, e); }))
    });
    for (var k = events.length - 1; k >= 0; k--) {
      if (events[k].type === "down") {
        next.pendingRegression = { date: events[k].date, from: events[k].from, to: events[k].to };
        break;
      }
    }
    return { state: next, events: events };
  }

  function applyDownEvents(state, events, today) {
    var hasDown = (events || []).some(function (e) { return e && e.type === "down"; });
    if (!hasDown) return state;
    var tasks = tasksOf(state).slice();
    var slots = slotsFor(state.rank ? state.rank.index : 0);
    while (tasks.filter(isSlot).length > slots) {
      var counts = pillarCounts(tasks), pick = -1;
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (!isSlot(t) || !(counts[t.pillar] >= 2)) continue;
        if (pick < 0 || String(t.createdAt) >= String(tasks[pick].createdAt)) pick = i;
      }
      if (pick < 0) break;
      tasks[pick] = Object.assign({}, tasks[pick], { active: false, deactivatedAt: today });
    }
    return Object.assign({}, state, { tasks: tasks });
  }

  // ---------- stats coach ----------
  function taskStats(state, task, endDate, windowDays) {
    var w = num(windowDays, 14) || 14, end = toNum(endDate);
    var from = Math.max(end - w + 1, startNum(state));
    if (from > end) return { due: 0, done: 0 };
    return dueDoneWindow(state, [task], from, end);
  }

  function missedPattern(state, endDate) {
    var end = toNum(endDate), from = Math.max(end - 27, startNum(state));
    var byWeekday = [0, 0, 0, 0, 0, 0, 0], byPillar = {};
    var tasks = tasksOf(state).filter(function (t) { return freqType(t) !== "per_week"; });
    var ranges = tasks.map(activeRange);
    for (var n = from; n <= end; n++) {
      var ds = fromNum(n);
      for (var i = 0; i < tasks.length; i++) {
        if (!isDueNum(tasks[i], ranges[i], n) || isDone(state.log, ds, tasks[i].id)) continue;
        byWeekday[dayIndexNum(n)]++;
        byPillar[tasks[i].pillar] = (byPillar[tasks[i].pillar] || 0) + 1;
      }
    }
    var worstWeekday = null, worstPillar = null;
    for (var d = 0; d < 7; d++) if (byWeekday[d] > 0 && (worstWeekday === null || byWeekday[d] > byWeekday[worstWeekday])) worstWeekday = d;
    PILLARS.forEach(function (p) { if (byPillar[p] > 0 && (worstPillar === null || byPillar[p] > byPillar[worstPillar])) worstPillar = p; });
    return { byWeekday: byWeekday, worstWeekday: worstWeekday, worstPillar: worstPillar };
  }

  function todayProgress(state, today) {
    var done = 0, due = 0;
    tasksOf(state).forEach(function (t) {
      if (t.system || freqType(t) === "per_week" || !isDue(t, today)) return;
      due++;
      if (isDone(state.log, today, t.id)) done++;
    });
    return { done: done, due: due };
  }

  // ---------- journal ----------
  function canMark(date, today) { return date === today || date === addDays(today, -1); }
  function toggleDone(state, taskId, date, today) {
    if (!canMark(date, today)) return state;
    var log = Object.assign({}, state.log || {});
    var day = Object.assign({}, log[date] || {});
    if (day[taskId] === "done") delete day[taskId]; else day[taskId] = "done";
    if (Object.keys(day).length) log[date] = day; else delete log[date];
    return Object.assign({}, state, { log: log });
  }

  function newId(prefix) {
    var r = "";
    try {
      if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
        r = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      }
    } catch (e) { r = ""; }
    if (!r) r = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 12);
    return String(prefix || "id") + "_" + r;
  }

  globalThis.AM_LOGIC = {
    PILLARS: PILLARS, RANK_LABELS: RANK_LABELS, THRESHOLDS: THRESHOLDS, EASY_MISS_MULTIPLIER: EASY_MISS_MULTIPLIER,
    todayStr: todayStr, addDays: addDays, daysBetween: daysBetween, dayIndex: dayIndex, isoWeekStart: isoWeekStart,
    taskValue: taskValue,
    isDue: isDue, weekProgress: weekProgress,
    computePoints: computePoints, livePoints: livePoints,
    computeDiscipline: computeDiscipline,
    computeStreak: computeStreak,
    daysSinceStart: daysSinceStart,
    computeTargetIndex: computeTargetIndex,
    rankInfo: rankInfo,
    nextThreshold: nextThreshold,
    slotsFor: slotsFor, countSlotTasks: countSlotTasks,
    nextUnlockPillar: nextUnlockPillar,
    startIndexFromDiagnostic: startIndexFromDiagnostic,
    evaluateRank: evaluateRank,
    applyDownEvents: applyDownEvents,
    taskStats: taskStats, missedPattern: missedPattern,
    todayProgress: todayProgress,
    canMark: canMark, toggleDone: toggleDone,
    newId: newId
  };
})();
