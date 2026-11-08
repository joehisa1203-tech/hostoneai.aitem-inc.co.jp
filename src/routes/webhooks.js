import express from 'express';
import * as line from '../channels/line.js';
import * as slack from '../channels/slack.js';
import { config } from '../config.js';
import { findConversationBySlackThread, findPropertyByBeds24, upsertConversation } from '../db.js';
import { handleGuestMessage, sendStaffMessage } from '../services/inbox.js';

export const router = express.Router();

// ---------- LINE ----------
router.post('/webhooks/line', async (req, res) => {
  if (!line.verifySignature(req.rawBody, req.get('x-line-signature'))) return res.status(401).send('invalid signature');
  res.sendStatus(200);
  for (const ev of req.body?.events || []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
    const userId = ev.source?.userId;
    if (!userId) continue;
    try {
      const profile = await line.getProfile(userId);
      const propertyId = Number(req.query.property) || null; // Webhook URL に ?property=ID を付けると物件を固定
      const conversation = upsertConversation({ channel: 'line', externalId: userId, guestName: profile?.displayName || '', propertyId });
      await handleGuestMessage({ conversation, text: ev.message.text, externalId: ev.message.id });
    } catch (e) {
      console.error('[line] 処理エラー', e);
    }
  }
});

// ---------- Slack Events API ----------
router.post('/webhooks/slack/events', async (req, res) => {
  if (!slack.verifySignature(req.rawBody, req.get('x-slack-request-timestamp'), req.get('x-slack-signature'))) {
    return res.status(401).send('invalid signature');
  }
  const body = req.body || {};
  if (body.type === 'url_verification') return res.json({ challenge: body.challenge });
  res.sendStatus(200);
  if (req.get('x-slack-retry-num')) return; // 再送は無視(処理済み)

  const ev = body.event;
  if (!ev || ev.type !== 'message' || ev.subtype || ev.bot_id || !ev.text) return;
  try {
    // 1) 通知スレッドへのスタッフ返信 → ゲストへ送信
    if (ev.channel === config.slack.notifyChannel) {
      if (!ev.thread_ts) return;
      const conv = findConversationBySlackThread(ev.thread_ts);
      if (conv) {
        await sendStaffMessage({ conversationId: conv.id, text: ev.text });
        await slack.postMessage({ channel: ev.channel, threadTs: ev.thread_ts, text: ':white_check_mark: ゲストへ送信しました' });
      }
      return;
    }
    // 2) それ以外のチャンネル(Slack Connect 等)はゲスト窓口として扱う
    const threadTs = ev.thread_ts || ev.ts;
    const conversation = upsertConversation({ channel: 'slack', externalId: `${ev.channel}:${threadTs}` });
    await handleGuestMessage({ conversation, text: ev.text, externalId: ev.client_msg_id || ev.ts });
  } catch (e) {
    console.error('[slack] 処理エラー', e);
  }
});

// ---------- Beds24 予約Webhook(任意) ----------
// Beds24 の予約Webhookに ${PUBLIC_BASE_URL}/webhooks/beds24?key=ADMIN_PASSWORD を設定すると即時ポーリングします
let pollNow = null;
export const setBeds24PollTrigger = (fn) => { pollNow = fn; };
router.post('/webhooks/beds24', (req, res) => {
  if (req.query.key !== config.admin.password) return res.sendStatus(401);
  res.sendStatus(200);
  pollNow?.();
});

export async function onBeds24GuestMessage(m, beds24) {
  let booking = null;
  try { booking = beds24.summarizeBooking(await beds24.getBooking(m.bookingId)); } catch (e) { console.warn('[beds24] 予約取得失敗', e.message); }
  const property = findPropertyByBeds24(booking?.propertyId || m.propertyId);
  const conversation = upsertConversation({
    channel: 'beds24', externalId: m.bookingId, bookingId: m.bookingId,
    propertyId: property?.id || null, guestName: booking?.guestName || '', bookingInfo: booking,
  });
  await handleGuestMessage({ conversation, text: m.message, externalId: m.id, meta: { beds24MessageId: m.id } });
  await beds24.markRead(m.id);
}
