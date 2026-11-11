// GET  /api/push                => { key }   clé publique VAPID (null si les notifs ne sont pas configurées)
// POST /api/push { action:"subscribe", id, sub, lang, tz, chat, remind, progress:{date,due,done} } => { ok:true }
//      (à renvoyer à chaque changement : réglages ou tâches cochées, pour que le rappel du soir soit juste)
// POST /api/push { action:"unsubscribe", id } => { ok:true }
// "id" est l'UUID secret du téléphone, comme pour /api/state.
import { allowMethods, readBody, sendJson, handleError, redis, BadRequest, rateLimit } from "./_lib.js";
import { ID_RE } from "./state.js";
import { cleanSub, pushKey, PUSH_ALL } from "./_push.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TTL_SEC = 90 * 24 * 3600;

function validTz(tz) {
  if (typeof tz !== "string" || tz.length > 60) return "Europe/Zurich";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return "Europe/Zurich"; }
}

const n = (x) => { const v = Math.round(Number(x)); return Number.isFinite(v) ? Math.min(200, Math.max(0, v)) : 0; };

export function cleanRecord(body) {
  const sub = cleanSub(body.sub);
  if (!sub) throw new BadRequest("bad_sub");
  const p = body.progress && typeof body.progress === "object" ? body.progress : {};
  return {
    sub,
    lang: body.lang === "en" ? "en" : "fr",
    tz: validTz(body.tz),
    chat: body.chat !== false,
    remind: body.remind !== false,
    progress: DATE_RE.test(p.date) ? { date: p.date, due: n(p.due), done: n(p.done) } : null,
  };
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    if (req.method === "GET") return sendJson(res, 200, { key: (process.env.VAPID_PUBLIC_KEY || "").trim() || null });
    await rateLimit(req, "push", 300);
    const body = await readBody(req);
    const id = body.id;
    if (typeof id !== "string" || !ID_RE.test(id)) throw new BadRequest("bad_id");
    if (body.action === "unsubscribe") {
      await redis(["DEL", pushKey(id)]);
      await redis(["SREM", PUSH_ALL, id]);
      return sendJson(res, 200, { ok: true });
    }
    if (body.action !== "subscribe") throw new BadRequest("bad_action");
    const rec = cleanRecord(body);
    await redis(["SET", pushKey(id), JSON.stringify(rec), "EX", TTL_SEC]);
    await redis(["SADD", PUSH_ALL, id]);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return handleError(res, err);
  }
}
