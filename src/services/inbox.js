// 受信メッセージ処理の中核: 保存 → AI返信生成 → 自動送信 or 承認待ち → Slack通知
import {
  addMessage, getConversation, getProperty, getSetting, listMessages, updateConversation, updateMessage,
} from '../db.js';
import { generateReply } from './ai.js';
import * as beds24 from '../channels/beds24.js';
import * as line from '../channels/line.js';
import * as slack from '../channels/slack.js';
import { config } from '../config.js';

const CHANNEL_LABEL = { beds24: 'Beds24/OTA', line: 'LINE', slack: 'Slack', voice: '電話', web: 'Webチャット' };

/** チャネルに応じてゲストへ送信 */
export async function deliver(conversation, text) {
  switch (conversation.channel) {
    case 'beds24':
      await beds24.sendMessage(conversation.booking_id || conversation.external_id, text);
      break;
    case 'line':
      await line.push(conversation.external_id, text);
      break;
    case 'slack': {
      const [channel, threadTs] = conversation.external_id.split(':');
      await slack.postMessage({ channel, text, threadTs });
      break;
    }
    case 'web':
    case 'voice':
      break; // Webはポーリングで取得、電話はTwiMLで即時応答
    default:
      throw new Error(`未対応チャネル: ${conversation.channel}`);
  }
}

function hitsEscalationKeyword(text) {
  const words = (getSetting('escalation_keywords') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return words.find((w) => text.includes(w)) || null;
}

/**
 * ゲストからのメッセージを処理する。
 * @param {object} p
 * @param {object} p.conversation  upsertConversation の戻り値
 * @param {string} p.text
 * @param {string} [p.externalId]  外部メッセージID(重複防止)
 * @param {boolean} [p.deliverNow] false の場合送信はせず結果だけ返す(電話/Webの同期応答用)
 * @returns {Promise<{action:'sent'|'draft'|'skipped'|'duplicate', reply?:string, ai?:object, message?:object}>}
 */
export async function handleGuestMessage({ conversation, text, externalId = null, deliverNow = true, meta = {} }) {
  const inbound = addMessage({
    conversationId: conversation.id, direction: 'in', sender: 'guest', body: text, externalId, meta,
  });
  if (!inbound) return { action: 'duplicate' };

  conversation = getConversation(conversation.id);
  const label = CHANNEL_LABEL[conversation.channel] || conversation.channel;
  const who = conversation.guest_name || 'ゲスト';
  const property = getProperty(conversation.property_id);
  const link = `${config.baseUrl}/admin/#/c/${conversation.id}`;

  if (!conversation.ai_enabled || conversation.status === 'needs_human') {
    await notify(conversation, `:speech_balloon: *${label}* ${who}${property ? `(${property.name})` : ''}\n> ${quote(text)}\n（AI停止中/スタッフ対応中） ${link}`);
    return { action: 'skipped' };
  }

  const ai = await generateReply({
    property, conversation, history: listMessages(conversation.id, { includeDrafts: false }), channel: conversation.channel,
  });

  const keyword = hitsEscalationKeyword(text);
  if (keyword) { ai.needs_human = true; ai.reason = `${ai.reason}（キーワード「${keyword}」検知）`; }

  const threshold = Number(getSetting('confidence_threshold') || 0.7);
  const mode = getSetting('reply_mode') || 'auto';
  const autoSend = mode === 'auto' && !ai.needs_human && ai.confidence >= threshold;
  const aiMeta = { category: ai.category, confidence: ai.confidence, needs_human: ai.needs_human, reason: ai.reason, language: ai.language };

  if (autoSend) {
    const out = addMessage({ conversationId: conversation.id, direction: 'out', sender: 'ai', body: ai.reply, meta: aiMeta });
    if (deliverNow) {
      try {
        await deliver(conversation, ai.reply);
      } catch (e) {
        updateMessage(out.id, { status: 'failed', meta: JSON.stringify({ ...aiMeta, error: e.message }) });
        await notify(conversation, `:warning: 送信失敗 ${label} ${who}: ${e.message}\n${link}`);
        return { action: 'draft', ai, message: out };
      }
    }
    await notify(conversation, `:robot_face: *${label}* ${who}${property ? `(${property.name})` : ''}\n> ${quote(text)}\n*AI自動返信* (${ai.category}, 確信度 ${ai.confidence.toFixed(2)}):\n${ai.reply}`);
    return { action: 'sent', reply: ai.reply, ai, message: out };
  }

  // 承認待ち(ドラフト)
  const draft = addMessage({ conversationId: conversation.id, direction: 'out', sender: 'ai', body: ai.reply, status: 'draft', meta: aiMeta });
  if (ai.needs_human) updateConversation(conversation.id, { status: 'needs_human' });
  await notify(conversation, `:rotating_light: *要対応* ${label} ${who}${property ? `(${property.name})` : ''}\n> ${quote(text)}\n理由: ${ai.reason}\n*AI下書き:*\n${ai.reply}\n\n管理画面で承認・編集: ${link}\n（このスレッドに返信すると、その内容がゲストに送信されます）`);
  return { action: 'draft', reply: ai.reply, ai, message: draft };
}

/** スタッフが手動送信 or 下書き承認 */
export async function sendStaffMessage({ conversationId, text, draftId = null, sender = 'staff' }) {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error('会話が見つかりません');
  let msg;
  if (draftId) {
    msg = updateMessage(draftId, { body: text, status: 'sent' });
  } else {
    msg = addMessage({ conversationId, direction: 'out', sender, body: text });
  }
  try {
    await deliver(conversation, text);
  } catch (e) {
    updateMessage(msg.id, { status: 'failed' });
    throw e;
  }
  return msg;
}

async function notify(conversation, text) {
  const ts = await slack.notifyStaff({ conversation, text });
  if (ts) updateConversation(conversation.id, { slack_thread_ts: ts });
}

const quote = (t) => String(t).slice(0, 500).replace(/\n/g, '\n> ');
