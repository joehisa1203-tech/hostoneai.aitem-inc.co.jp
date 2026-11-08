import express from 'express';
import { config } from '../config.js';
import * as twilio from '../channels/twilio.js';
import { getProperty, upsertConversation } from '../db.js';
import { handleGuestMessage } from '../services/inbox.js';

export const router = express.Router();

function verified(req) {
  const url = config.baseUrl + req.originalUrl;
  return twilio.verifySignature(url, req.body || {}, req.get('x-twilio-signature'));
}

// Twilio 電話番号の Voice Webhook に ${PUBLIC_BASE_URL}/voice/incoming?property=ID を設定
router.post('/voice/incoming', (req, res) => {
  if (!verified(req)) return res.status(401).send('invalid signature');
  const property = getProperty(Number(req.query.property));
  upsertConversation({ channel: 'voice', externalId: req.body.CallSid, propertyId: property?.id || null, guestName: req.body.From || '' });
  const name = property ? property.name : '宿泊施設';
  res.type('text/xml').send(twilio.gatherTwiml({
    say: `お電話ありがとうございます。${name}のAIコンシェルジュです。ご用件をお話しください。`,
  }));
});

router.post('/voice/gather', async (req, res) => {
  if (!verified(req)) return res.status(401).send('invalid signature');
  const speech = (req.body.SpeechResult || '').trim();
  if (!speech) return res.type('text/xml').send(twilio.gatherTwiml({ say: 'もう一度お話しいただけますか。' }));
  try {
    const conversation = upsertConversation({ channel: 'voice', externalId: req.body.CallSid, guestName: req.body.From || '' });
    const result = await handleGuestMessage({ conversation, text: speech, deliverNow: false });
    const lang = result.ai?.language || 'ja';
    if (result.action === 'sent') {
      return res.type('text/xml').send(twilio.gatherTwiml({ say: `${result.reply} ほかにご用件はございますか。`, lang }));
    }
    return res.type('text/xml').send(twilio.transferTwiml({
      say: lang.startsWith('ja') ? '担当者におつなぎします。少々お待ちください。' : 'Let me connect you to our staff. Please hold.', lang,
    }));
  } catch (e) {
    console.error('[voice] エラー', e);
    return res.type('text/xml').send(twilio.transferTwiml({ say: '担当者におつなぎします。' }));
  }
});
