// Beds24 API v2 連携
// ドキュメント: https://beds24.com/api/v2/  (Swagger)
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';

let cachedToken = null;
let tokenExpiresAt = 0;

export const isBeds24Enabled = () => Boolean(config.beds24.refreshToken);

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const res = await fetch(`${config.beds24.baseUrl}/authentication/token`, {
    headers: { refreshToken: config.beds24.refreshToken, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Beds24 トークン取得失敗: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  return cachedToken;
}

async function api(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${config.beds24.baseUrl}${path}`, {
    method,
    headers: { token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Beds24 ${method} ${path} 失敗: ${res.status} ${text.slice(0, 300)}`);
  return data;
}

/** 直近のメッセージを取得(maxAge: 日数) */
export async function fetchRecentMessages(maxAgeDays = 2) {
  const data = await api(`/bookings/messages?maxAge=${maxAgeDays}`);
  return Array.isArray(data?.data) ? data.data : [];
}

export async function getBooking(bookingId) {
  const data = await api(`/bookings?id=${encodeURIComponent(bookingId)}`);
  return Array.isArray(data?.data) ? data.data[0] : null;
}

/** ゲストへメッセージ送信(Beds24 経由で Airbnb / Booking.com 等の各OTAに配信) */
export async function sendMessage(bookingId, message) {
  return api('/bookings/messages', { method: 'POST', body: [{ bookingId: Number(bookingId), message }] });
}

export async function markRead(messageId) {
  try {
    await api('/bookings/messages', { method: 'POST', body: [{ id: Number(messageId), read: true }] });
  } catch (e) {
    console.warn('[beds24] 既読化失敗', e.message);
  }
}

export function summarizeBooking(b) {
  if (!b) return null;
  return {
    bookingId: b.id,
    propertyId: b.propertyId,
    roomId: b.roomId,
    guestName: [b.firstName, b.lastName].filter(Boolean).join(' '),
    arrival: b.arrival,
    departure: b.departure,
    numAdult: b.numAdult,
    numChild: b.numChild,
    channel: b.channel || b.referer,
    status: b.status,
    arrivalTime: b.arrivalTime,
    guestComments: b.comments,
  };
}

/** 新着ゲストメッセージを定期取得してハンドラに渡す */
export function startPolling(onGuestMessage) {
  if (!isBeds24Enabled()) {
    console.log('[beds24] BEDS24_REFRESH_TOKEN 未設定のためポーリング無効');
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const lastId = Number(getSetting('beds24_last_message_id') || 0);
      const messages = (await fetchRecentMessages(2))
        .filter((m) => m.source === 'guest' && Number(m.id) > lastId)
        .sort((a, b) => Number(a.id) - Number(b.id));
      for (const m of messages) {
        try {
          await onGuestMessage(m);
          setSetting('beds24_last_message_id', m.id);
        } catch (e) {
          console.error('[beds24] メッセージ処理エラー', m.id, e);
          break; // 次回再試行
        }
      }
      setSetting('beds24_last_poll', new Date().toISOString());
    } catch (e) {
      console.error('[beds24] ポーリングエラー', e.message);
    } finally {
      running = false;
    }
  };
  tick();
  return { timer: setInterval(tick, config.beds24.pollSeconds * 1000), tick };
}
