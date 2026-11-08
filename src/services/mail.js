// お問い合わせメールの送信。
// SMTP は joeai.co.jp（WordPress）と同じ Xserver のものを使う。設定値は docs/status.md 参照。
import nodemailer from 'nodemailer';
import { config } from '../config.js';

const { smtp } = config.contact;

export function isMailEnabled() {
  return Boolean(smtp.host && smtp.user && smtp.pass);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
  }
  return transporter;
}

// 差出人は SMTP 認証したアドレスに固定する。問い合わせ者のアドレスを差出人にすると
// SPF/DMARC で弾かれて届かなくなるため、相手のアドレスは Reply-To に入れる。
export async function sendContactMail(form) {
  if (!isMailEnabled()) throw new Error('SMTP未設定');
  const body = [
    `会社名　: ${form.company || '(未記入)'}`,
    `お名前　: ${form.name}`,
    `メール　: ${form.email}`,
    `電話番号: ${form.phone || '(未記入)'}`,
    '',
    '── ご相談内容 ──',
    form.message,
    '',
    '──',
    `送信元: ${config.baseUrl}`,
    `受信日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  ].join('\n');

  await getTransporter().sendMail({
    from: { address: config.contact.from || smtp.user, name: config.contact.fromName },
    to: config.contact.to,
    replyTo: form.email,
    subject: `【HostOne AI】お問い合わせ: ${form.name} 様`,
    text: body,
  });
}

// 起動時や点検用。SMTP に繋がって認証できるかだけを見る。
export async function verifyMail() {
  if (!isMailEnabled()) return { ok: false, reason: 'SMTP未設定' };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
