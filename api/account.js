// POST /api/account — comptes (pseudo + mot de passe) et sauvegarde en ligne de l'état de l'app.
//   { action:"register", username, password, state? } => { token, username, updatedAt }
//   { action:"login", username, password }            => { token, username, state, updatedAt }
//   { action:"load", token }                          => { username, state, updatedAt }
//   { action:"save", token, state }                   => { ok:true, updatedAt }
//   { action:"logout", token }                        => { ok:true }
// Mots de passe : scrypt + sel aléatoire, jamais stockés en clair. Sessions : seul le hash du jeton est stocké.
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { allowMethods, readBody, sendJson, handleError, redis, BadRequest, rateLimit } from "./_lib.js";

export const USER_RE = /^[a-z0-9_.-]{3,20}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;
const MAX_STATE = 300 * 1024;
const SESSION_TTL = 180 * 24 * 3600;
const ACTIONS = ["register", "login", "load", "save", "logout"];

const userKey = (u) => "am:u:" + u;
const dataKey = (u) => "am:ud:" + u;
const sessionKey = (token) => "am:s:" + createHash("sha256").update(token).digest("hex");

class Unauthorized extends Error {
  constructor(code) { super(code); this.code = code; }
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function username(v) {
  const u = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!USER_RE.test(u)) throw new BadRequest("bad_username");
  return u;
}

function password(v) {
  if (typeof v !== "string" || v.length < MIN_PASSWORD || v.length > MAX_PASSWORD) throw new BadRequest("bad_password");
  return v;
}

function stateJson(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest("bad_state");
  const s = JSON.stringify(v);
  if (s.length > MAX_STATE) throw new BadRequest("state_too_large");
  return s;
}

async function newSession(u) {
  const token = randomBytes(32).toString("base64url");
  await redis(["SET", sessionKey(token), u, "EX", SESSION_TTL]);
  return token;
}

async function sessionUser(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw new Unauthorized("bad_session");
  const key = sessionKey(token);
  const u = await redis(["GET", key]);
  if (typeof u !== "string" || !USER_RE.test(u)) throw new Unauthorized("bad_session");
  await redis(["EXPIRE", key, SESSION_TTL]);
  return u;
}

async function saveState(u, json) {
  const updatedAt = new Date().toISOString();
  await redis(["SET", dataKey(u), JSON.stringify({ updatedAt, state: json })]);
  return updatedAt;
}

async function readState(u) {
  const raw = await redis(["GET", dataKey(u)]);
  if (typeof raw !== "string") return { state: null, updatedAt: null };
  try {
    const d = JSON.parse(raw);
    return { state: JSON.parse(d.state), updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null };
  } catch {
    return { state: null, updatedAt: null };
  }
}

async function register(body) {
  const u = username(body.username);
  const pw = password(body.password);
  const json = body.state === undefined || body.state === null ? null : stateJson(body.state);
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt);
  const record = JSON.stringify({ salt: salt.toString("hex"), hash: hash.toString("hex"), createdAt: new Date().toISOString() });
  const ok = await redis(["SET", userKey(u), record, "NX"]);
  if (ok !== "OK") throw new BadRequest("username_taken");
  const updatedAt = json ? await saveState(u, json) : null;
  return { token: await newSession(u), username: u, updatedAt };
}

async function login(body) {
  const u = username(body.username);
  const pw = typeof body.password === "string" ? body.password.slice(0, MAX_PASSWORD) : "";
  const raw = await redis(["GET", userKey(u)]);
  let rec = null;
  try { rec = typeof raw === "string" ? JSON.parse(raw) : null; } catch { rec = null; }
  // Même coût de calcul que le compte existe ou non.
  const salt = rec && typeof rec.salt === "string" ? Buffer.from(rec.salt, "hex") : randomBytes(16);
  const hash = await scryptAsync(pw, salt);
  const expected = rec && typeof rec.hash === "string" ? Buffer.from(rec.hash, "hex") : null;
  if (!expected || expected.length !== hash.length || !timingSafeEqual(expected, hash)) throw new Unauthorized("bad_credentials");
  const data = await readState(u);
  return { token: await newSession(u), username: u, state: data.state, updatedAt: data.updatedAt };
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ["POST"])) return;
    const body = await readBody(req);
    const action = body.action;
    if (!ACTIONS.includes(action)) throw new BadRequest("bad_action");
    if (action === "register" || action === "login") {
      await rateLimit(req, "auth", 30);
      return sendJson(res, 200, action === "register" ? await register(body) : await login(body));
    }
    await rateLimit(req, "sync", 600);
    if (action === "logout") {
      if (typeof body.token === "string" && body.token.length <= 100) await redis(["DEL", sessionKey(body.token)]);
      return sendJson(res, 200, { ok: true });
    }
    const u = await sessionUser(body.token);
    if (action === "save") return sendJson(res, 200, { ok: true, updatedAt: await saveState(u, stateJson(body.state)) });
    const data = await readState(u);
    return sendJson(res, 200, { username: u, state: data.state, updatedAt: data.updatedAt });
  } catch (err) {
    if (err instanceof Unauthorized) return sendJson(res, 401, { error: err.code });
    return handleError(res, err);
  }
}
