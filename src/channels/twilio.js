// 電話 (Twilio Voice) 連携
import crypto from 'node:crypto';
import { config } from '../config.js';

/** X-Twilio-Signature 検証 */
export function verifySignature(url, params, signature) {
  if (!config.twilio.authToken) return true; // 未設定時は検証スキップ(開発用)
  if (!signature) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', config.twilio.authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const VOICES = { ja: 'ja-JP', en: 'en-US', zh: 'cmn-CN', ko: 'ko-KR' };
export const langCode = (lang) => VOICES[(lang || 'ja').slice(0, 2)] || 'ja-JP';

export function gatherTwiml({ say, lang = 'ja' }) {
  const l = langCode(lang);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="${l}" speechTimeout="auto" action="${config.baseUrl}/voice/gather" method="POST">
    <Say language="${l}">${escapeXml(say)}</Say>
  </Gather>
  <Say language="${l}">${lang.startsWith('ja') ? 'お声が確認できませんでしたので、お電話を終了します。' : 'We could not hear you. Goodbye.'}</Say>
  <Hangup/>
</Response>`;
}

export function transferTwiml({ say, lang = 'ja' }) {
  const l = langCode(lang);
  if (!config.twilio.hostPhone) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="${l}">${escapeXml(say)}</Say><Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="${l}">${escapeXml(say)}</Say>
  <Dial timeout="25">${escapeXml(config.twilio.hostPhone)}</Dial>
  <Say language="${l}">担当者につながりませんでした。折り返しご連絡いたします。</Say>
</Response>`;
}
