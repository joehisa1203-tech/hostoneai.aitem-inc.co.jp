import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { getSetting } from '../db.js';

let client = null;
function getClient() {
  if (!client) client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読み込み
  return client;
}

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'ゲストに送る返信本文。ゲストと同じ言語で書く。' },
    language: { type: 'string', description: 'ゲストの言語コード (ja, en, zh, ko など)' },
    category: {
      type: 'string',
      enum: ['checkin', 'checkout', 'access', 'wifi', 'amenity', 'house_rules', 'booking_change',
        'payment', 'trouble', 'emergency', 'recommendation', 'other'],
    },
    confidence: { type: 'number', description: '提供された物件情報だけで正確に回答できている確信度 0.0〜1.0' },
    needs_human: { type: 'boolean', description: 'スタッフの対応が必要なら true' },
    reason: { type: 'string', description: 'needs_human の理由や、スタッフ向けの短いメモ(日本語)' },
  },
  required: ['reply', 'language', 'category', 'confidence', 'needs_human', 'reason'],
  additionalProperties: false,
};

export function buildSystemPrompt({ property, conversation, channel }) {
  const businessName = getSetting('business_name') || 'HostOne AI';
  const persona = getSetting('ai_persona') || '丁寧な民泊コンシェルジュ';
  const keywords = getSetting('escalation_keywords') || '';
  let booking = '';
  try { booking = conversation?.booking_info ? JSON.stringify(JSON.parse(conversation.booking_info), null, 2) : ''; } catch { /* noop */ }

  const propertyBlock = property ? `
<property>
物件名: ${property.name}
住所: ${property.address}
チェックイン: ${property.checkin_time} 以降
チェックアウト: ${property.checkout_time} まで
Wi-Fi SSID: ${property.wifi_ssid}
Wi-Fi パスワード: ${property.wifi_password}
アクセス・入室方法:
${property.access_info}
ハウスルール:
${property.house_rules}
よくある質問と回答:
${property.faq}
緊急連絡先: ${property.emergency_contact}
</property>` : '\n<property>物件が特定できていません。物件固有の情報は推測せず、予約名や物件名を確認してください。</property>';

  const channelNote = channel === 'voice'
    ? '- これは電話の音声通話です。返信は読み上げられるので、2〜3文の短い話し言葉にし、URL・記号・箇条書きは使わないでください。'
    : '- チャットの返信なので、簡潔に読みやすく。必要なら短い箇条書きを使って構いません。';

  return `あなたは「${businessName}」の民泊ゲスト対応AIです。人柄: ${persona}。
Beds24 で管理されている宿泊施設のゲストから、Airbnb・Booking.com などのOTAメッセージ、LINE、Slack、電話、Webチャットで届く問い合わせに24時間対応します。

対応方針:
- ゲストが書いた言語で返信してください(日本語、英語、中国語、韓国語など)。
- 以下の物件情報と予約情報に書かれている事実だけを根拠に回答し、書かれていないこと(料金、空室、返金可否、設備の有無など)は推測で断言しないでください。分からない場合は「担当者に確認してご連絡します」と伝え、needs_human を true にしてください。
- 予約の変更・キャンセル・返金・追加料金・クレーム・設備故障・鍵や入室トラブル・騒音や近隣苦情・安全に関わること・緊急事態は needs_human を true にしてください。緊急時(火事・急病・事件)はまず 119/110 への連絡を案内してください。
- 次のキーワードに関わる内容もスタッフ対応にしてください: ${keywords}
- Wi-Fi パスワードやドアの暗証番号などは、予約が確認できているゲストにのみ伝えてください。予約情報が無い場合は needs_human を true にしてください。
${channelNote}
- reason はスタッフが読むので日本語で書いてください。
${propertyBlock}
<booking>
${booking || '予約情報なし'}
</booking>`;
}

/**
 * 会話履歴から次の返信を生成する。
 * @returns {Promise<{reply:string, language:string, category:string, confidence:number, needs_human:boolean, reason:string}>}
 */
export async function generateReply({ property, conversation, history, channel }) {
  const system = buildSystemPrompt({ property, conversation, channel });
  const messages = toApiMessages(history);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw new Error('最後のメッセージがゲストからではありません');
  }

  const params = {
    model: config.ai.model,
    max_tokens: 4000,
    system,
    messages,
    output_config: {
      effort: channel === 'voice' ? 'low' : config.ai.effort,
      format: { type: 'json_schema', schema: REPLY_SCHEMA },
    },
  };
  if (config.ai.fallbacks) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let res;
  try {
    res = await getClient().beta.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.APIConnectionError) {
      return escalation('AI API が一時的に利用できません(混雑または接続エラー)');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return escalation('ANTHROPIC_API_KEY が無効です。設定を確認してください');
    }
    throw err;
  }

  if (res.stop_reason === 'refusal') {
    return escalation(`AIが回答を控えました (${res.stop_details?.category ?? 'unknown'})`);
  }
  if (res.stop_reason === 'max_tokens') {
    return escalation('AIの返信が長すぎて途中で終了しました');
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const parsed = JSON.parse(text);
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    return parsed;
  } catch {
    return escalation('AIの応答を解析できませんでした');
  }
}

function escalation(reason) {
  return {
    reply: 'お問い合わせありがとうございます。担当者が確認のうえ、折り返しご連絡いたします。少々お待ちください。\nThank you for your message. Our staff will get back to you shortly.',
    language: 'ja',
    category: 'other',
    confidence: 0,
    needs_human: true,
    reason,
  };
}

/** DBのメッセージ行を Messages API の user/assistant 交互形式に変換 */
export function toApiMessages(history) {
  const out = [];
  for (const m of history) {
    if (m.status !== 'sent') continue;
    const role = m.direction === 'in' ? 'user' : 'assistant';
    const text = m.sender === 'staff' ? `[スタッフが送信] ${m.body}` : m.body;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out.slice(-30);
}
