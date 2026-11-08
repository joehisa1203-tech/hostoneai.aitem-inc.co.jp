// Webチャットウィジェット用 公開API
import express from 'express';
import crypto from 'node:crypto';
import { db, getProperty, upsertConversation } from '../db.js';
import { handleGuestMessage } from '../services/inbox.js';

export const router = express.Router();

const rate = new Map(); // 簡易レート制限: セッション毎 1分 10件
function limited(key) {
  const now = Date.now();
  const arr = (rate.get(key) || []).filter((t) => now - t < 60_000);
  arr.push(now); rate.set(key, arr);
  return arr.length > 10;
}

router.post('/api/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  let sessionId = String(req.body?.sessionId || '');
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) sessionId = crypto.randomUUID();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (limited(sessionId) || limited(req.ip)) return res.status(429).json({ error: 'too many requests' });

  const property = getProperty(Number(req.body?.propertyId));
  const conversation = upsertConversation({
    channel: 'web', externalId: sessionId, propertyId: property?.id || null, guestName: String(req.body?.name || '').slice(0, 80),
  });
  try {
    const result = await handleGuestMessage({ conversation, text, deliverNow: false });
    const pending = result.action !== 'sent';
    res.json({
      sessionId,
      reply: pending ? 'お問い合わせありがとうございます。担当者が確認してこちらに返信いたします。このままお待ちください。' : result.reply,
      pending,
      // 承認待ちの下書きは承認後にポーリングで届くよう、その直前のIDを返す
      lastId: pending ? Math.max(0, (result.message?.id || 1) - 1) : result.message?.id || 0,
    });
  } catch (e) {
    console.error('[web] エラー', e);
    res.status(500).json({ error: 'internal error' });
  }
});

// スタッフ返信などの新着取得(ポーリング)
router.get('/api/chat/:sessionId', (req, res) => {
  const after = Number(req.query.after || 0);
  const rows = db.prepare(`SELECT m.id, m.sender, m.body, m.created_at FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.channel = 'web' AND c.external_id = ? AND m.direction = 'out' AND m.status = 'sent' AND m.id > ?
    ORDER BY m.id`).all(req.params.sessionId, after);
  res.json({ messages: rows });
});
