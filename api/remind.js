// GET /api/remind — appelé chaque soir par le cron Vercel (voir vercel.json).
// Rappelle à chacun ses tâches pas encore faites. Protégé par CRON_SECRET (en-tête Authorization: Bearer ...).
// Les deux projets Vercel partagent la base : un verrou par personne et par jour évite le double rappel.
import { sendJson, handleError, redis } from "./_lib.js";
import { getPushRecord, sendPush, pushConfigured, PUSH_ALL } from "./_push.js";
import { ID_RE } from "./state.js";

function localDate(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

const TEXT = {
  fr: {
    title: "L'Anti-Moldu",
    left: (k) => k === 1 ? "Il te reste 1 tâche aujourd'hui. Pas d'excuse, fais-la." : `Il te reste ${k} tâches aujourd'hui. Pas d'excuse, bouge-toi.`,
    none: "Tu n'as encore rien coché aujourd'hui. Ouvre l'app et fais tes tâches.",
  },
  en: {
    title: "L'Anti-Moldu",
    left: (k) => k === 1 ? "1 task left today. No excuses, do it." : `${k} tasks left today. No excuses, move.`,
    none: "Nothing checked off today yet. Open the app and do your tasks.",
  },
};

// Message du rappel, ou null s'il n'y a rien à rappeler.
export function reminderText(rec, today) {
  const L = TEXT[rec.lang === "en" ? "en" : "fr"];
  const p = rec.progress;
  if (p && p.date === today) {
    if (p.due <= 0 || p.done >= p.due) return null;
    return { title: L.title, body: L.left(p.due - p.done) };
  }
  return { title: L.title, body: L.none };
}

export default async function handler(req, res) {
  try {
    const secret = (process.env.CRON_SECRET || "").trim();
    if (!secret || req.headers.authorization !== "Bearer " + secret) return sendJson(res, 401, { error: "unauthorized" });
    if (!pushConfigured()) return sendJson(res, 200, { sent: 0 });
    const ids = await redis(["SMEMBERS", PUSH_ALL]);
    let sent = 0;
    await Promise.allSettled((Array.isArray(ids) ? ids.map(String) : []).filter((id) => ID_RE.test(id)).map(async (id) => {
      const rec = await getPushRecord(id);
      if (!rec) { await redis(["SREM", PUSH_ALL, id]); return; }
      if (rec.remind === false) return;
      const today = localDate(rec.tz);
      const msg = reminderText(rec, today);
      if (!msg) return;
      if ((await redis(["SET", "am:push:r:" + id + ":" + today, "1", "NX", "EX", 172800])) !== "OK") return;
      if (await sendPush(id, rec, { ...msg, tag: "remind", url: "/?tab=today" })) sent++;
    }));
    return sendJson(res, 200, { sent });
  } catch (err) {
    return handleError(res, err);
  }
}
