// GET /api/state?group=CODE&me=ID  => { members:[...], isOwner }  (trié rang puis points)
//   ou { kicked:true } si l'appelant a été exclu, { movedTo } si le groupe a changé de code.
//   Les identifiants ne sortent jamais : chaque membre a un repère anonyme "pub" et "me" = true pour l'appelant.
//   L'identifiant (UUID aléatoire, connu seulement de son téléphone) sert donc de clé d'écriture.
// POST /api/state { group, id, profile } => { ok:true }   (liste blanche stricte)
import { createHash } from "node:crypto";
import { allowMethods, readBody, sendJson, handleError, queryParam, redis, clean, BadRequest, rateLimit, PILLARS } from "./_lib.js";

export const GROUP_RE = /^[A-Z0-9]{6}$/;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_MEMBERS = 50;
export const hashKey = (group) => "am:g:" + group;
export const ownerKey = (group) => "am:go:" + group;   // identifiant du créateur
export const bannedKey = (group) => "am:gb:" + group;  // identifiants exclus (ensemble)
export const movedKey = (group) => "am:gr:" + group;   // ancien code -> nouveau code

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

// Tâches faites aujourd'hui : seulement le type (pilier), jamais le titre de la tâche.
function cleanDone(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    if (out.length >= MAX_DONE) break;
    if (!d || typeof d !== "object") continue;
    out.push({ pillar: PILLARS.includes(d.pillar) ? d.pillar : null });
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

// Groupe renommé : on suit les redirections, mais seulement pour qui est membre du nouveau groupe.
export async function movedFor(group, id) {
  let code = group;
  let found = null;
  for (let hop = 0; hop < 5; hop++) {
    const next = await redis(["GET", movedKey(code)]);
    if (typeof next !== "string" || !GROUP_RE.test(next)) break;
    if (Number(await redis(["HEXISTS", hashKey(next), id])) === 1) found = next;
    code = next;
  }
  return found;
}

export async function isBanned(group, id) {
  return Number(await redis(["SISMEMBER", bannedKey(group), id])) === 1;
}

async function getGroup(req, res) {
  const group = queryParam(req, "group");
  if (typeof group !== "string" || !GROUP_RE.test(group)) throw new BadRequest("bad_group");
  let me = queryParam(req, "me");
  if (typeof me !== "string" || !ID_RE.test(me)) me = null;
  if (me && await isBanned(group, me)) return sendJson(res, 200, { kicked: true, members: [] });
  const flat = await redis(["HGETALL", hashKey(group)]);
  if (me && !(Array.isArray(flat) && flat.includes(me))) {
    const moved = await movedFor(group, me);
    if (moved) return sendJson(res, 200, { movedTo: moved, members: [] });
  }
  const owner = await redis(["GET", ownerKey(group)]);
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
  return sendJson(res, 200, {
    members: members.map((m) => ({ ...publicMember(group, m, me), owner: m.id === owner })),
    isOwner: me !== null && me === owner,
  });
}

async function postMember(req, res) {
  const body = await readBody(req);
  const group = body.group;
  if (typeof group !== "string" || !GROUP_RE.test(group)) throw new BadRequest("bad_group");
  const id = body.id;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new BadRequest("bad_id");
  const key = hashKey(group);
  if (await isBanned(group, id)) return sendJson(res, 200, { kicked: true });
  const exists = Number(await redis(["HEXISTS", key, id])) === 1;
  if (!exists) {
    const count = Number(await redis(["HLEN", key]));
    // Un groupe n'existe que s'il a été créé (propriétaire) ou s'il a déjà des membres.
    if (count === 0 && (await redis(["GET", ownerKey(group)])) === null) {
      const moved = await movedFor(group, id);
      if (moved) return sendJson(res, 200, { movedTo: moved });
      throw new BadRequest("group_not_found");
    }
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
