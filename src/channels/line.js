// LINE Messaging API 連携
import crypto from 'node:crypto';
import { config } from '../config.js';

export const isLineEnabled = () => Boolean(config.line.channelSecret && config.line.accessToken);

export function verifySignature(rawBody, signature) {
  if (!config.line.channelSecret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', config.line.channelSecret).update(rawBody).digest('base64');
  return safeEqual(expected, signature);
}

async function call(path, body) {
  const res = await fetch(`https://api.line.me/v2/bot${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.line.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE ${path} 失敗: ${res.status} ${await res.text()}`);
  return res.json().catch(() => ({}));
}

const toMessages = (text) => chunk(text, 4900).slice(0, 5).map((t) => ({ type: 'text', text: t }));

export const reply = (replyToken, text) => call('/message/reply', { replyToken, messages: toMessages(text) });
export const push = (userId, text) => call('/message/push', { to: userId, messages: toMessages(text) });

export async function getProfile(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { authorization: `Bearer ${config.line.accessToken}` },
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function chunk(s, n) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [''];
}
function safeEqual(a, b) {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
