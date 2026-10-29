// GET /api/state?group=CODE  => { members:[...] }  (trié rang puis points)
// POST /api/state { group, id, profile } => { ok:true }   (liste blanche stricte)
import { allowMethods, readBody, sendJson, handleError, queryParam, redis, clean, BadRequest } from "./_lib.js";

const GROUP_RE = /^[A-Z0-9]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MEMBERS = 50;
const hashKey = (group) => "am:g:" + group;

function int(x, lo, hi, dflt) {
  const n = Number(x);
  if (x === null || x === "" || typeof x === "boolean" || !Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function cleanName(s) {
  const n = clean(typeof s === "string" ? s : "", 200).replace(/[<>"'`&\\]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(n).slice(0, 30).join("").trim() || "?";
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
    updatedAt,
  };
}

async function getGroup(req, res) {
  const group = queryParam(req, "group");
  if (typeof group !== "string" || !GROUP_RE.test(group)) throw new BadRequest("bad_group");
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
  return sendJson(res, 200, { members });
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
    if (req.method === "GET") return await getGroup(req, res);
    return await postMember(req, res);
  } catch (err) {
    return handleError(res, err);
  }
}
