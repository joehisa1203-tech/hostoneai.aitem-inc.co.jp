import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import {
  allSettings, deleteProperty, getConversation, getMessage, getProperty, listConversations, listMessages,
  listProperties, saveProperty, setSetting, stats, updateConversation, updateMessage,
} from '../db.js';
import { sendStaffMessage } from '../services/inbox.js';
import { generateReply } from '../services/ai.js';
import { isBeds24Enabled } from '../channels/beds24.js';
import { isLineEnabled } from '../channels/line.js';
import { isSlackEnabled } from '../channels/slack.js';

export const router = express.Router();

export function basicAuth(req, res, next) {
  const [type, value] = (req.get('authorization') || '').split(' ');
  if (type === 'Basic' && value && config.admin.password) {
    const [user, ...rest] = Buffer.from(value, 'base64').toString().split(':');
    const pass = rest.join(':');
    if (safeEq(user, config.admin.user) && safeEq(pass, config.admin.password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="HostOne AI Admin", charset="UTF-8"').status(401).send('認証が必要です');
}
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

router.use('/admin/api', basicAuth);

router.get('/admin/api/overview', (req, res) => {
  res.json({
    stats: stats(),
    integrations: {
      ai: Boolean(process.env.ANTHROPIC_API_KEY), beds24: isBeds24Enabled(), line: isLineEnabled(),
      slack: isSlackEnabled(), voice: Boolean(config.twilio.authToken),
    },
    model: config.ai.model,
    webhooks: {
      line: `${config.baseUrl}/webhooks/line`,
      slack: `${config.baseUrl}/webhooks/slack/events`,
      voice: `${config.baseUrl}/voice/incoming?property=物件ID`,
      beds24: `${config.baseUrl}/webhooks/beds24?key=管理パスワード`,
      widget: `<script src="${config.baseUrl}/widget.js" data-property="物件ID" defer></script>`,
    },
  });
});

router.get('/admin/api/conversations', (req, res) => {
  res.json(listConversations({ status: req.query.status, channel: req.query.channel }));
});

router.get('/admin/api/conversations/:id', (req, res) => {
  const c = getConversation(Number(req.params.id));
  if (!c) return res.sendStatus(404);
  res.json({ conversation: c, property: getProperty(c.property_id), messages: listMessages(c.id) });
});

router.patch('/admin/api/conversations/:id', (req, res) => {
  const { status, ai_enabled, property_id } = req.body || {};
  res.json(updateConversation(Number(req.params.id), {
    status, property_id, ai_enabled: ai_enabled === undefined ? undefined : (ai_enabled ? 1 : 0),
  }));
});

router.post('/admin/api/conversations/:id/send', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const msg = await sendStaffMessage({ conversationId: Number(req.params.id), text });
    res.json(msg);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/admin/api/messages/:id/approve', async (req, res) => {
  const draft = getMessage(Number(req.params.id));
  if (!draft || draft.status !== 'draft') return res.status(404).json({ error: '下書きが見つかりません' });
  const text = String(req.body?.text || draft.body).trim();
  try {
    const msg = await sendStaffMessage({ conversationId: draft.conversation_id, text, draftId: draft.id });
    res.json(msg);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/admin/api/messages/:id/discard', (req, res) => {
  res.json(updateMessage(Number(req.params.id), { status: 'discarded' }));
});

router.get('/admin/api/properties', (req, res) => res.json(listProperties()));
router.post('/admin/api/properties', (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: '物件名は必須です' });
  res.json(saveProperty(req.body));
});
router.put('/admin/api/properties/:id', (req, res) => res.json(saveProperty(req.body || {}, Number(req.params.id))));
router.delete('/admin/api/properties/:id', (req, res) => { deleteProperty(Number(req.params.id)); res.sendStatus(204); });

const EDITABLE = ['reply_mode', 'confidence_threshold', 'business_name', 'ai_persona', 'escalation_keywords'];
router.get('/admin/api/settings', (req, res) => {
  const s = allSettings();
  res.json(Object.fromEntries(EDITABLE.map((k) => [k, s[k]])));
});
router.put('/admin/api/settings', (req, res) => {
  for (const k of EDITABLE) if (req.body?.[k] !== undefined) setSetting(k, req.body[k]);
  res.json(allSettings());
});

// AI 応答テスト(送信はしない)
router.post('/admin/api/test-ai', async (req, res) => {
  const property = getProperty(Number(req.body?.propertyId));
  try {
    const result = await generateReply({
      property, conversation: null, channel: req.body?.channel || 'web',
      history: [{ direction: 'in', sender: 'guest', body: String(req.body?.text || ''), status: 'sent' }],
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
