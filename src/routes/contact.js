// LP のお問い合わせフォーム受付
import express from 'express';
import { config } from '../config.js';
import { isMailEnabled, sendContactMail } from '../services/mail.js';

export const router = express.Router();

const rate = new Map(); // 簡易レート制限: IP毎 10分 3件
function limited(key) {
  const now = Date.now();
  const arr = (rate.get(key) || []).filter((t) => now - t < 600_000);
  arr.push(now);
  rate.set(key, arr);
  return arr.length > 3;
}

const s = (v, max) => String(v ?? '').trim().slice(0, max);
const fallback = () => `お手数ですが ${config.contact.to} へ直接ご連絡ください。`;

router.post('/api/contact', async (req, res) => {
  // bot 対策。人間には見えない項目で、埋まっていたら黙って成功を返す（判定させない）
  if (s(req.body?.website, 100)) return res.json({ ok: true });

  const form = {
    company: s(req.body?.company, 100),
    name: s(req.body?.name, 80),
    email: s(req.body?.email, 200),
    phone: s(req.body?.phone, 40),
    message: s(req.body?.message, 4000),
  };

  if (!form.name || !form.email || !form.message) {
    return res.status(400).json({ error: 'お名前・メールアドレス・ご相談内容は必須です。' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    return res.status(400).json({ error: 'メールアドレスの形式をご確認ください。' });
  }
  if (limited(req.ip)) {
    return res.status(429).json({ error: '送信が続いています。しばらく経ってからお試しください。' });
  }
  if (!isMailEnabled()) {
    // 送信できないまま黙って捨てると問い合わせが消えるので、ログに残して利用者にも伝える
    console.error('[contact] SMTP未設定のため送信できませんでした:', form.email);
    return res.status(503).json({ error: `現在フォームからの送信を受け付けられません。${fallback()}` });
  }

  try {
    await sendContactMail(form);
    res.json({ ok: true });
  } catch (e) {
    console.error('[contact] 送信エラー', e.message);
    res.status(502).json({ error: `送信に失敗しました。${fallback()}` });
  }
});
