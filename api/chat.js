// GET /api/chat?group=CODE&me=ID  => { messages:[{ pub, me, name, text, at }] }  (50 derniers, du plus ancien au plus récent)
// POST /api/chat { group, id, text } => { ok:true }   (réservé aux membres du groupe)
//   Comme pour le classement, les identifiants ne sortent jamais : seul le repère anonyme "pub" est renvoyé.
import { allowMethods, readBody, sendJson, handleError, queryParam, redis, cleanMultiline, BadRequest, rateLimit } from "./_lib.js";
import { GROUP_RE, ID_RE, hashKey, pubId } from "./state.js";
import { notifyGroupChat, pushConfigured } from "./_push.js";

const MAX_TEXT = 500;
const KEEP = 100;
const SHOW = 50;
const TTL_SEC = 30 * 24 * 3600;
export const chatKey = (group) => "am:gc:" + group;

function groupParam(v) {
  if (typeof v !== "string" || !GROUP_RE.test(v)) throw new BadRequest("bad_group");
  return v;
}

async function getChat(req, res) {
  const group = groupParam(queryParam(req, "group"));
  const me = queryParam(req, "me");
  // Lecture réservée aux membres (un exclu ne lit plus la discussion).
  if (typeof me !== "string" || !ID_RE.test(me) || Number(await redis(["HEXISTS", hashKey(group), me])) !== 1) {
    return sendJson(res, 403, { error: "not_member" });
  }
  const raw = await redis(["LRANGE", chatKey(group), -SHOW, -1]);
  const messages = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      let m;
      try { m = JSON.parse(item); } catch { continue; }
      if (!m || typeof m !== "object" || !ID_RE.test(String(m.id)) || typeof m.text !== "string") continue;
      messages.push({
        pub: pubId(group, m.id),
        me: m.id === me,
        name: typeof m.name === "string" ? m.name.slice(0, 30) : "?",
        text: cleanMultiline(m.text, MAX_TEXT),
        at: typeof m.at === "string" ? m.at.slice(0, 40) : null,
      });
    }
  }
  return sendJson(res, 200, { messages });
}

async function postChat(req, res) {
  const body = await readBody(req);
  const group = groupParam(body.group);
  const id = body.id;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new BadRequest("bad_id");
  const text = cleanMultiline(typeof body.text === "string" ? body.text : "", MAX_TEXT);
  if (!text) throw new BadRequest("missing_text");
  // Seul un membre du groupe peut écrire ; le prénom vient de sa fiche, pas du message.
  const stored = await redis(["HGET", hashKey(group), id]);
  if (!stored) throw new BadRequest("not_member");
  let name = "?";
  try { const p = JSON.parse(stored); if (p && typeof p.name === "string") name = p.name; } catch { /* prénom par défaut */ }
  const key = chatKey(group);
  await redis(["RPUSH", key, JSON.stringify({ id, name, text, at: new Date().toISOString() })]);
  await redis(["LTRIM", key, -KEEP, -1]);
  await redis(["EXPIRE", key, TTL_SEC]);
  // Notifications aux autres membres (sans jamais faire échouer l'envoi du message).
  if (pushConfigured()) {
    try {
      const ids = await redis(["HKEYS", hashKey(group)]);
      if (Array.isArray(ids)) await notifyGroupChat(group, ids.map(String), id, name, text);
    } catch { /* message déjà enregistré */ }
  }
  return sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    if (req.method === "GET") {
      await rateLimit(req, "chatr", 900);
      return await getChat(req, res);
    }
    await rateLimit(req, "chatw", 120);
    return await postChat(req, res);
  } catch (err) {
    return handleError(res, err);
  }
}
