// Slack 連携: スタッフ通知/承認 + ゲスト窓口(Slack Connect 等)
import crypto from 'node:crypto';
import { config } from '../config.js';

export const isSlackEnabled = () => Boolean(config.slack.botToken || config.slack.webhookUrl);

export function verifySignature(rawBody, timestamp, signature) {
  if (!config.slack.signingSecret || !rawBody || !timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expected = 'v0=' + crypto.createHmac('sha256', config.slack.signingSecret).update(base).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function postMessage({ channel, text, threadTs, blocks }) {
  if (config.slack.botToken) {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.slack.botToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text, thread_ts: threadTs || undefined, blocks, unfurl_links: false }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack chat.postMessage 失敗: ${data.error}`);
    return data; // { ts, channel }
  }
  if (config.slack.webhookUrl) {
    await fetch(config.slack.webhookUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, blocks }),
    });
    return {};
  }
  return {};
}

/** スタッフ通知チャンネルへの通知。会話ごとにスレッドを作り、以降はスレッドに追記 */
export async function notifyStaff({ conversation, text }) {
  if (!isSlackEnabled()) return null;
  try {
    const res = await postMessage({
      channel: config.slack.notifyChannel,
      text,
      threadTs: conversation?.slack_thread_ts || undefined,
    });
    return res.ts && !conversation?.slack_thread_ts ? res.ts : null;
  } catch (e) {
    console.error('[slack] 通知失敗', e.message);
    return null;
  }
}
