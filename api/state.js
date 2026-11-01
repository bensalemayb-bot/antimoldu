// GET /api/state?group=CODE&me=ID  => { members:[...] }  (trié rang puis points)
//   Les identifiants ne sortent jamais : chaque membre a un repère anonyme "pub" et "me" = true pour l'appelant.
//   L'identifiant (UUID aléatoire, connu seulement de son téléphone) sert donc de clé d'écriture.
// POST /api/state { group, id, profile } => { ok:true }   (liste blanche stricte)
import { createHash } from "node:crypto";
import { allowMethods, readBody, sendJson, handleError, queryParam, redis, clean, BadRequest, rateLimit, PILLARS } from "./_lib.js";

export const GROUP_RE = /^[A-Z0-9]{6}$/;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MEMBERS = 50;
export const hashKey = (group) => "am:g:" + group;

function int(x, lo, hi, dflt) {
  const n = Number(x);
  if (x === null || x === "" || typeof x === "boolean" || !Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function cleanName(s) {
  const n = clean(typeof s === "string" ? s : "", 200).replace(/[<>"'`&\\]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(n).slice(0, 30).join("").trim() || "?";
}

const MAX_DONE = 20;

// Tâches faites aujourd'hui : titre borné + pilier connu, rien d'autre.
function cleanDone(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    if (out.length >= MAX_DONE) break;
    if (!d || typeof d !== "object") continue;
    const title = Array.from(clean(typeof d.title === "string" ? d.title : "", 200).replace(/[<>]/g, "")).slice(0, 60).join("").trim();
    if (!title) continue;
    out.push({ title, pillar: PILLARS.includes(d.pillar) ? d.pillar : null });
  }
  return out;
}

// Seuls ces champs sont stockés / renvoyés.
export function sanitizeMember(id, p, updatedAt) {
  const src = p && typeof p === "object" ? p : {};
  return {
    id,
    name: cleanName(src.name),
    rankIndex: int(src.rankIndex, 0, 12, 0),
    points: int(src.points, 0, Number.MAX_SAFE_INTEGER, 0),
    discipline: src.discipline === null || src.discipline === undefined ? null : int(src.discipline, 0, 100, null),
    streak: int(src.streak, 0, 100000, 0),
    todayDone: int(src.todayDone, 0, 50, 0),
    todayDue: int(src.todayDue, 0, 50, 0),
    doneToday: cleanDone(src.doneToday),
    weekDone: int(src.weekDone, 0, 1000, 0),
    updatedAt,
  };
}

export const pubId = (group, id) => createHash("sha256").update(group + ":" + id).digest("hex").slice(0, 12);

// Version publique d'un membre : sans identifiant.
function publicMember(group, m, meId) {
  const { id, ...rest } = m;
  return { pub: pubId(group, id), me: id === meId, ...rest };
}

async function getGroup(req, res) {
  const group = queryParam(req, "group");
  if (typeof group !== "string" || !GROUP_RE.test(group)) throw new BadRequest("bad_group");
  const me = queryParam(req, "me");
  const flat = await redis(["HGETALL", hashKey(group)]);
  const members = [];
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const id = String(flat[i]);
      if (!ID_RE.test(id)) continue;
      let parsed;
      try { parsed = JSON.parse(flat[i + 1]); } catch { continue; }
      if (!parsed || typeof parsed !== "object") continue;
      members.push(sanitizeMember(id, parsed, typeof parsed.updatedAt === "string" ? parsed.updatedAt.slice(0, 40) : null));
    }
  }
  members.sort((a, b) => b.rankIndex - a.rankIndex || b.points - a.points);
  return sendJson(res, 200, { members: members.map((m) => publicMember(group, m, typeof me === "string" ? me : null)) });
}

async function postMember(req, res) {
  const body = await readBody(req);
  const group = body.group;
  if (typeof group !== "string" || !GROUP_RE.test(group)) throw new BadRequest("bad_group");
  const id = body.id;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new BadRequest("bad_id");
  const key = hashKey(group);
  const exists = Number(await redis(["HEXISTS", key, id])) === 1;
  if (!exists) {
    const count = Number(await redis(["HLEN", key]));
    if (count >= MAX_MEMBERS) throw new BadRequest("group_full");
  }
  const member = sanitizeMember(id, body.profile, new Date().toISOString());
  await redis(["HSET", key, id, JSON.stringify(member)]);
  return sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    await rateLimit(req, "state", 300);
    if (req.method === "GET") return await getGroup(req, res);
    return await postMember(req, res);
  } catch (err) {
    return handleError(res, err);
  }
}
