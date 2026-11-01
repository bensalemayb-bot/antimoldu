// POST /api/group — création et administration d'un groupe.
//   { action:"create", group, id }          => { ok:true }              le créateur devient propriétaire
//   { action:"check", group, id }           => { ok:true } | { movedTo } | { kicked:true }   avant de rejoindre
//   { action:"rename", group, id, newCode } => { ok:true, group }       propriétaire seulement
//   { action:"kick", group, id, pub }       => { ok:true }              propriétaire seulement, exclusion définitive
//   { action:"leave", group, id }           => { ok:true }
// L'identifiant "id" est l'UUID secret du téléphone : il sert de preuve d'identité, comme pour /api/state.
import { allowMethods, readBody, sendJson, handleError, redis, BadRequest, rateLimit } from "./_lib.js";
import { GROUP_RE, ID_RE, hashKey, ownerKey, bannedKey, movedKey, pubId, movedFor, isBanned } from "./state.js";
import { chatKey } from "./chat.js";

const ACTIONS = ["create", "check", "rename", "kick", "leave"];
const MOVED_TTL = 60 * 24 * 3600;

class Forbidden extends Error {
  constructor(code) { super(code); this.code = code; }
}

function code(v, err = "bad_group") {
  if (typeof v !== "string" || !GROUP_RE.test(v)) throw new BadRequest(err);
  return v;
}

const isMember = async (group, id) => Number(await redis(["HEXISTS", hashKey(group), id])) === 1;
const groupExists = async (group) => Number(await redis(["HLEN", hashKey(group)])) > 0 || (await redis(["GET", ownerKey(group)])) !== null;

// Propriétaire du groupe ; un groupe créé avant cette fonctionnalité est repris par le premier membre qui l'administre.
async function requireOwner(group, id) {
  let owner = await redis(["GET", ownerKey(group)]);
  if (owner === null && await isMember(group, id)) {
    await redis(["SET", ownerKey(group), id, "NX"]);
    owner = await redis(["GET", ownerKey(group)]);
  }
  if (owner !== id) throw new Forbidden("not_owner");
}

async function create(group, id) {
  if (await groupExists(group) || (await redis(["GET", movedKey(group)])) !== null) throw new BadRequest("group_exists");
  if ((await redis(["SET", ownerKey(group), id, "NX"])) !== "OK") throw new BadRequest("group_exists");
  return { ok: true };
}

async function check(group, id) {
  if (await isBanned(group, id)) return { kicked: true };
  if (await isMember(group, id)) return { ok: true };
  if (await groupExists(group)) {
    if (Number(await redis(["HLEN", hashKey(group)])) >= 50) throw new BadRequest("group_full");
    return { ok: true };
  }
  const moved = await movedFor(group, id);
  if (moved) return { movedTo: moved };
  throw new BadRequest("group_not_found");
}

async function rename(group, id, newCode) {
  await requireOwner(group, id);
  if (newCode === group) return { ok: true, group };
  if (await groupExists(newCode) || (await redis(["GET", movedKey(newCode)])) !== null) throw new BadRequest("code_taken");
  if ((await redis(["SET", ownerKey(newCode), id, "NX"])) !== "OK") throw new BadRequest("code_taken");
  for (const k of [hashKey, chatKey, bannedKey]) {
    if (Number(await redis(["EXISTS", k(group)])) === 1) await redis(["RENAME", k(group), k(newCode)]);
  }
  await redis(["DEL", ownerKey(group)]);
  // Les membres actuels suivent le nouveau code ; l'ancien code ne permet plus de rejoindre.
  await redis(["SET", movedKey(group), newCode, "EX", MOVED_TTL]);
  return { ok: true, group: newCode };
}

async function kick(group, id, pub) {
  await requireOwner(group, id);
  if (typeof pub !== "string" || !/^[0-9a-f]{12}$/.test(pub)) throw new BadRequest("bad_member");
  const ids = await redis(["HKEYS", hashKey(group)]);
  const target = Array.isArray(ids) ? ids.map(String).find((m) => pubId(group, m) === pub) : undefined;
  if (!target) throw new BadRequest("bad_member");
  if (target === id) throw new BadRequest("cannot_kick_self");
  await redis(["HDEL", hashKey(group), target]);
  await redis(["SADD", bannedKey(group), target]);
  return { ok: true };
}

async function leave(group, id) {
  await redis(["HDEL", hashKey(group), id]);
  // Le propriétaire qui part libère le groupe : le prochain membre qui l'administre le reprend.
  if ((await redis(["GET", ownerKey(group)])) === id) {
    await redis(["DEL", ownerKey(group)]);
    if (Number(await redis(["HLEN", hashKey(group)])) === 0) await redis(["DEL", chatKey(group)]);
  }
  return { ok: true };
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ["POST"])) return;
    await rateLimit(req, "group", 120);
    const body = await readBody(req);
    if (!ACTIONS.includes(body.action)) throw new BadRequest("bad_action");
    const group = code(body.group);
    const id = body.id;
    if (typeof id !== "string" || !ID_RE.test(id)) throw new BadRequest("bad_id");
    switch (body.action) {
      case "create": return sendJson(res, 200, await create(group, id));
      case "check": return sendJson(res, 200, await check(group, id));
      case "rename": return sendJson(res, 200, await rename(group, id, code(body.newCode, "bad_code")));
      case "kick": return sendJson(res, 200, await kick(group, id, body.pub));
      default: return sendJson(res, 200, await leave(group, id));
    }
  } catch (err) {
    if (err instanceof Forbidden) return sendJson(res, 403, { error: err.code });
    return handleError(res, err);
  }
}
