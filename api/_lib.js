// Helpers serveur : JSON, corps de requête, IA (Gemini + secours Groq), Upstash, taskValue.
// Portable : n'utilise que res.statusCode / res.setHeader / res.end (Vercel ou http brut).

export const EASY_MISS_MULTIPLIER = 1.4;
export const PILLARS = ["corps", "focus", "viepro", "savoir", "lien", "ame"];
export const VIEPRO_TYPES = ["business", "ecole", "travail"];

export class AiError extends Error {}
export class StorageError extends Error {}
export class BadRequest extends Error {
  constructor(code) { super(code); this.code = code; }
}
export class RateLimited extends Error {}

const clampNum = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Même formule que logic.js (SPEC §4.2).
export function taskValue(difficulty, minutes) {
  let d = Number(difficulty);
  let m = Number(minutes);
  if (!Number.isFinite(d)) d = 1;
  if (!Number.isFinite(m)) m = 1;
  d = clampNum(Math.round(d), 1, 5);
  m = clampNum(m, 1, 240);
  const points = clampNum(Math.round(d * 7 + m / 5), 5, 60);
  const penalty = points <= 20 ? Math.round(points * EASY_MISS_MULTIPLIER)
    : points >= 35 ? Math.round(points * 0.7) : points;
  return { points, penalty };
}

// Caractères invisibles / de contrôle (Cc, Cf, séparateurs de ligne/paragraphe).
const CTRL_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

// Chaîne nettoyée : pas de caractères de contrôle, espaces compactés, bornée.
export function clean(str, max = 200) {
  if (typeof str !== "string") return "";
  const s = str
    .replace(CTRL_RE, (c) => (/\s/.test(c) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, max).join("").trim();
}

// Comme clean mais garde les retours à la ligne (réponses IA, messages).
export function cleanMultiline(str, max = 2000) {
  if (typeof str !== "string") return "";
  const s = str
    .replace(/\r\n?/g, "\n")
    .replace(CTRL_RE, (c) => (c === "\n" ? c : /\s/.test(c) ? " " : ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return Array.from(s).slice(0, max).join("").trim();
}

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// Vérifie la méthode ; renvoie false (et répond 405) si refusée.
export function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  sendJson(res, 405, { error: "method_not_allowed" });
  return false;
}

const MAX_BODY = 200 * 1024;

// Corps : déjà parsé (objet), chaîne / Buffer, ou flux à lire.
export async function readBody(req) {
  let raw;
  let pre;
  try { pre = req.body; } catch { throw new BadRequest("bad_json"); }
  if (pre !== undefined && pre !== null) {
    if (typeof pre === "string") raw = pre;
    else if (typeof Buffer !== "undefined" && Buffer.isBuffer(pre)) raw = pre.toString("utf8");
    else if (typeof pre === "object") return pre;
    else throw new BadRequest("bad_json");
  } else if (req && typeof req[Symbol.asyncIterator] === "function" && !req.readableEnded) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += b.length;
      if (size > MAX_BODY) throw new BadRequest("body_too_large");
      chunks.push(b);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  } else {
    raw = "";
  }
  if (raw.length > MAX_BODY) throw new BadRequest("body_too_large");
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not object");
    return v;
  } catch {
    throw new BadRequest("bad_json");
  }
}

// Paramètre de requête (req.query Vercel ou req.url brut).
export function queryParam(req, name) {
  if (req.query && typeof req.query === "object" && req.query[name] !== undefined) {
    const v = req.query[name];
    return Array.isArray(v) ? String(v[0]) : String(v);
  }
  try {
    const u = new URL(req.url || "/", "http://localhost");
    const v = u.searchParams.get(name);
    return v === null ? undefined : v;
  } catch {
    return undefined;
  }
}

// Gère les erreurs connues sans jamais exposer de trace.
export function handleError(res, err) {
  if (err instanceof BadRequest) return sendJson(res, 400, { error: err.code });
  if (err instanceof RateLimited) return sendJson(res, 429, { error: "rate_limited" });
  if (err instanceof AiError) return sendJson(res, 503, { error: "ai_unavailable" });
  if (err instanceof StorageError) return sendJson(res, 503, { error: "storage_unavailable" });
  return sendJson(res, 500, { error: "server_error" });
}

// Extrait du JSON d'un texte (brut, entre ```json, ou noyé dans du texte).
export function parseJsonLoose(text) {
  if (typeof text !== "string") return null;
  const tries = [];
  const t = text.trim();
  tries.push(t);
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const firstObj = t.indexOf("{");
  const lastObj = t.lastIndexOf("}");
  if (firstObj !== -1 && lastObj > firstObj) tries.push(t.slice(firstObj, lastObj + 1));
  const firstArr = t.indexOf("[");
  const lastArr = t.lastIndexOf("]");
  if (firstArr !== -1 && lastArr > firstArr) tries.push(t.slice(firstArr, lastArr + 1));
  for (const s of tries) {
    try {
      const v = JSON.parse(s);
      if (v !== null && typeof v === "object") return v;
    } catch { /* essai suivant */ }
  }
  return null;
}

const AI_TIMEOUT_MS = 20000;
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

// fetch JSON avec timeout ; toute erreur devient AiError (jamais de trace exposée).
async function aiFetch(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new AiError("http_" + r.status);
    return await r.json();
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("request_failed");
  } finally {
    clearTimeout(timer);
  }
}

async function geminiRequest(key, { system, user, temperature, maxOutputTokens, json }) {
  const model = (process.env.GEMINI_MODEL || "").trim() || DEFAULT_GEMINI_MODEL;
  const generationConfig = { temperature, maxOutputTokens };
  if (json) generationConfig.responseMimeType = "application/json";
  if (model.startsWith("gemini-2.5-flash")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const data = await aiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": key },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig,
    },
  );
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("").trim() : "";
  if (!text) throw new AiError("empty");
  return text;
}

// Groq (API compatible OpenAI). Les modèles gpt-oss réfléchissent : marge de tokens en plus.
async function groqRequest(key, { system, user, temperature, maxOutputTokens }) {
  const model = (process.env.GROQ_MODEL || "").trim() || DEFAULT_GROQ_MODEL;
  const body = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature,
    max_completion_tokens: maxOutputTokens,
  };
  if (model.startsWith("openai/gpt-oss")) {
    body.reasoning_effort = "low";
    body.max_completion_tokens = maxOutputTokens + 400;
  }
  const data = await aiFetch("https://api.groq.com/openai/v1/chat/completions", { Authorization: "Bearer " + key }, body);
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  const text = msg && typeof msg.content === "string" ? msg.content.trim() : "";
  if (!text) throw new AiError("empty");
  return text;
}

// Gemini en principal, Groq en secours (si GROQ_API_KEY est défini).
export async function callGemini({ system, user, temperature = 0.8, maxOutputTokens = 500, json = false }) {
  const opts = { system, user, temperature, maxOutputTokens, json };
  const gKey = process.env.GEMINI_API_KEY;
  const qKey = process.env.GROQ_API_KEY;
  if (!gKey && !qKey) throw new AiError("no_key");
  if (gKey) {
    try { return await geminiRequest(gKey, opts); }
    catch (e) { if (!qKey) throw e; }
  }
  return groqRequest(qKey, opts);
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_URL ? process.env.UPSTASH_REDIS_REST_TOKEN : process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function storageConfigured() { return redisConfig() !== null; }

export async function redis(cmdArray) {
  const cfg = redisConfig();
  if (!cfg) throw new StorageError("not_configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
      body: JSON.stringify(cmdArray.map((x) => String(x))),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new StorageError("http_" + r.status);
    const data = await r.json();
    if (!data || data.error) throw new StorageError("redis_error");
    return data.result;
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError("request_failed");
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Limites d'appels (Upstash). Si le stockage est absent ou en panne, on laisse passer. ----------
function clientIp(req) {
  const h = (req && req.headers) || {};
  const xf = Array.isArray(h["x-forwarded-for"]) ? h["x-forwarded-for"][0] : String(h["x-forwarded-for"] || "");
  const ip = xf.split(",")[0].trim() || String(h["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "";
  return ip.replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45) || "unknown";
}

async function bump(key, ttlSec) {
  const n = Number(await redis(["INCR", key]));
  if (n === 1) await redis(["EXPIRE", key, ttlSec]);
  return n;
}

// Par adresse IP, sur une fenêtre fixe.
export async function rateLimit(req, bucket, limit, windowSec = 3600) {
  if (!storageConfigured()) return;
  let n;
  try { n = await bump(`am:rl:${bucket}:${clientIp(req)}:${Math.floor(Date.now() / 1000 / windowSec)}`, windowSec); }
  catch { return; }
  if (n > limit) throw new RateLimited();
}

// Plafond global d'appels Gemini par jour (AI_DAILY_LIMIT, défaut 1000) pour protéger le quota gratuit.
export async function aiDailyQuota() {
  if (!storageConfigured()) return;
  const cap = Number(process.env.AI_DAILY_LIMIT) > 0 ? Number(process.env.AI_DAILY_LIMIT) : 1000;
  let n;
  try { n = await bump("am:ai:" + new Date().toISOString().slice(0, 10), 172800); }
  catch { return; }
  if (n > cap) throw new RateLimited();
}
