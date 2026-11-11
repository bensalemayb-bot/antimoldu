// Notifications push (Web Push / VAPID). Inactif tant que VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ne sont pas définies.
// Un abonnement par téléphone : am:push:<id> = { sub, lang, tz, chat, remind, progress:{date,due,done} }.
import webpush from "web-push";
import { redis } from "./_lib.js";

export const pushKey = (id) => "am:push:" + id;
export const PUSH_ALL = "am:push:all";

// Seuls les services push des navigateurs connus sont acceptés (pas d'appel vers une adresse arbitraire).
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function cleanSub(sub) {
  if (!sub || typeof sub !== "object" || typeof sub.endpoint !== "string" || sub.endpoint.length > 1000) return null;
  let u;
  try { u = new URL(sub.endpoint); } catch { return null; }
  if (u.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  const k = sub.keys;
  const b64 = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
  if (!k || typeof k.p256dh !== "string" || typeof k.auth !== "string" || !b64.test(k.p256dh) || !b64.test(k.auth)) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export function pushConfigured() {
  return !!((process.env.VAPID_PUBLIC_KEY || "").trim() && (process.env.VAPID_PRIVATE_KEY || "").trim());
}

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails("https://antimoldu.vercel.app", process.env.VAPID_PUBLIC_KEY.trim(), process.env.VAPID_PRIVATE_KEY.trim());
  ready = true;
}

export async function getPushRecord(id) {
  const raw = await redis(["GET", pushKey(id)]);
  if (typeof raw !== "string") return null;
  try { const r = JSON.parse(raw); return r && typeof r === "object" && r.sub ? r : null; } catch { return null; }
}

// Envoie une notification ; un abonnement expiré (404/410) est supprimé. Ne lève jamais.
export async function sendPush(id, rec, payload) {
  if (!pushConfigured() || !rec || !rec.sub) return false;
  try {
    setup();
    await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 6 * 3600, timeout: 8000 });
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
      try { await redis(["DEL", pushKey(id)]); await redis(["SREM", PUSH_ALL, id]); } catch { /* tant pis */ }
    }
    return false;
  }
}

// Nouveau message dans un groupe : prévient les autres membres qui ont activé les notifs du chat.
export async function notifyGroupChat(group, ids, senderId, name, text) {
  if (!pushConfigured()) return;
  const others = ids.filter((m) => m !== senderId);
  const body = Array.from(text.replace(/\s+/g, " ")).slice(0, 140).join("");
  await Promise.allSettled(others.map(async (m) => {
    const rec = await getPushRecord(m);
    if (!rec || rec.chat === false) return;
    await sendPush(m, rec, { title: name + " (groupe)", body, tag: "gchat-" + group, url: "/?tab=group" });
  }));
}
