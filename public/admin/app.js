/* HostOne AI 管理画面 (依存なし SPA) */
const $app = document.getElementById('app');
const CH = { beds24: 'Beds24/OTA', line: 'LINE', slack: 'Slack', voice: '電話', web: 'Web' };
const STATUS = { open: '対応中', needs_human: '要対応', closed: '完了' };
const PROPERTY_FIELDS = [
  ['name', '物件名 *'], ['beds24_property_id', 'Beds24 物件ID (propertyId)'], ['address', '住所'],
  ['checkin_time', 'チェックイン時刻'], ['checkout_time', 'チェックアウト時刻'], ['wifi_ssid', 'Wi-Fi SSID'],
  ['wifi_password', 'Wi-Fi パスワード'], ['emergency_contact', '緊急連絡先'],
  ['access_info', 'アクセス・入室方法（鍵/暗証番号など）', true], ['house_rules', 'ハウスルール', true],
  ['faq', 'よくある質問と回答', true],
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, opts = {}) {
  const res = await fetch('/admin/api' + path, {
    ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const fmt = (t) => (t ? new Date(t.replace(' ', 'T') + 'Z').toLocaleString('ja-JP') : '');

let pollTimer = null;
async function route() {
  clearInterval(pollTimer);
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page === 'c' ? 'inbox' : page)));
  try {
    if (page === 'inbox' || page === 'c') await inbox(page === 'c' ? Number(id) : null);
    else if (page === 'properties') await properties(id);
    else if (page === 'settings') await settings();
    else if (page === 'test') await testAi();
    else await dashboard();
  } catch (e) {
    $app.innerHTML = `<div class="card ng">エラー: ${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
route();

async function dashboard() {
  const o = await api('/overview');
  const s = o.stats;
  const tile = (n, l) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const yes = (b) => (b ? '<span class="ok">接続済み</span>' : '<span class="ng">未設定</span>');
  $app.innerHTML = `
  <div class="stats">${tile(s.needs_human, '要対応の会話')}${tile(s.drafts, '承認待ちの下書き')}${tile(s.guest_messages_today, '本日の受信')}${tile(s.ai_replies_today, '本日のAI自動返信')}${tile(s.conversations, '会話総数')}</div>
  <div class="card"><h3>連携状況</h3><table>
    <tr><td>AI (Claude / ${esc(o.model)})</td><td>${yes(o.integrations.ai)}</td></tr>
    <tr><td>Beds24</td><td>${yes(o.integrations.beds24)}</td></tr>
    <tr><td>LINE</td><td>${yes(o.integrations.line)}</td><td><code>${esc(o.webhooks.line)}</code></td></tr>
    <tr><td>Slack</td><td>${yes(o.integrations.slack)}</td><td><code>${esc(o.webhooks.slack)}</code></td></tr>
    <tr><td>電話 (Twilio)</td><td>${yes(o.integrations.voice)}</td><td><code>${esc(o.webhooks.voice)}</code></td></tr>
    <tr><td>Beds24 予約Webhook (任意)</td><td></td><td><code>${esc(o.webhooks.beds24)}</code></td></tr>
    <tr><td>Webチャット埋め込み</td><td></td><td><code>${esc(o.webhooks.widget)}</code></td></tr>
  </table><p class="muted">接続情報はサーバーの .env で設定します。</p></div>`;
}

async function inbox(selectedId) {
  const filter = sessionStorage.getItem('ho_filter') || '';
  const list = await api('/conversations' + (filter ? `?status=${filter}` : ''));
  $app.innerHTML = `<div class="split">
    <div class="card" style="padding:0">
      <div class="row" style="padding:10px">
        <select id="flt"><option value="">すべて</option><option value="needs_human">要対応</option><option value="open">対応中</option><option value="closed">完了</option></select>
      </div>
      <div class="list">${list.map((c) => `
        <a href="#/c/${c.id}" class="${c.id === selectedId ? 'on' : ''}">
          <div class="row"><b>${esc(c.guest_name || '(名前なし)')}</b>
            <span class="badge">${CH[c.channel] || c.channel}</span>
            <span class="badge ${c.status === 'needs_human' ? 'warn' : ''}">${STATUS[c.status] || c.status}</span>
            ${c.draft_count ? `<span class="badge warn">下書き${c.draft_count}</span>` : ''}</div>
          <div class="muted">${esc(c.property_name || '')} ${fmt(c.last_message_at)}</div>
          <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last_body || '')}</div>
        </a>`).join('') || '<p class="muted" style="padding:12px">会話はまだありません</p>'}</div>
    </div>
    <div id="detail">${selectedId ? '' : '<div class="card muted">左の一覧から会話を選択してください</div>'}</div>
  </div>`;
  const flt = document.getElementById('flt');
  flt.value = filter;
  flt.onchange = () => { sessionStorage.setItem('ho_filter', flt.value); route(); };
  if (selectedId) {
    await conversation(selectedId);
    pollTimer = setInterval(() => conversation(selectedId, true), 10000);
  }
}

async function conversation(id, quiet) {
  const box = document.getElementById('detail');
  if (!box) return;
  if (quiet && (document.activeElement?.tagName === 'TEXTAREA')) return; // 入力中は再描画しない
  const [{ conversation: c, property, messages }, props] = await Promise.all([api('/conversations/' + id), api('/properties')]);
  let booking = '';
  try { const b = c.booking_info ? JSON.parse(c.booking_info) : null; if (b) booking = `予約 #${esc(b.bookingId)} / ${esc(b.arrival)}〜${esc(b.departure)} / 大人${esc(b.numAdult ?? '-')}名 / ${esc(b.channel || '')}`; } catch {}
  box.innerHTML = `<div class="card">
    <div class="row" style="justify-content:space-between">
      <div><b style="font-size:16px">${esc(c.guest_name || '(名前なし)')}</b> <span class="badge">${CH[c.channel]}</span>
        <div class="muted">${booking}</div></div>
      <div class="row">
        <select id="prop" style="width:auto"><option value="">物件未設定</option>${props.map((p) => `<option value="${p.id}" ${p.id === c.property_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <select id="st" style="width:auto">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label class="row" style="margin:0;font-weight:400"><input type="checkbox" id="aion" style="width:auto" ${c.ai_enabled ? 'checked' : ''}> AI自動応答</label>
      </div>
    </div>
    <div class="msgs" id="msgs">${messages.filter((m) => m.status !== 'discarded').map(renderMsg).join('')}</div>
    <label>スタッフとして返信</label>
    <textarea id="reply" placeholder="ゲストに送信するメッセージ"></textarea>
    <div class="row" style="margin-top:8px"><button id="send">送信</button>${property ? '' : '<span class="muted">※物件を設定するとAIが物件情報を使って回答します</span>'}</div>
  </div>`;
  const msgs = document.getElementById('msgs'); msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('prop').onchange = (e) => api('/conversations/' + id, { method: 'PATCH', body: { property_id: Number(e.target.value) || null } });
  document.getElementById('st').onchange = (e) => api('/conversations/' + id, { method: 'PATCH', body: { status: e.target.value } }).then(route);
  document.getElementById('aion').onchange = (e) => api('/conversations/' + id, { method: 'PATCH', body: { ai_enabled: e.target.checked } });
  document.getElementById('send').onclick = async () => {
    const text = document.getElementById('reply').value.trim();
    if (!text) return;
    try { await api(`/conversations/${id}/send`, { method: 'POST', body: { text } }); conversation(id); } catch (e) { alert('送信失敗: ' + e.message); }
  };
  box.querySelectorAll('[data-approve]').forEach((b) => b.onclick = async () => {
    const mid = b.dataset.approve;
    const text = document.getElementById('d' + mid).value;
    try { await api(`/messages/${mid}/approve`, { method: 'POST', body: { text } }); conversation(id); } catch (e) { alert('送信失敗: ' + e.message); }
  });
  box.querySelectorAll('[data-discard]').forEach((b) => b.onclick = async () => {
    await api(`/messages/${b.dataset.discard}/discard`, { method: 'POST' }); conversation(id);
  });
}

function renderMsg(m) {
  let meta = {};
  try { meta = JSON.parse(m.meta || '{}'); } catch {}
  const who = { guest: 'ゲスト', ai: 'AI', staff: 'スタッフ' }[m.sender];
  const info = m.sender === 'ai' && meta.category ? ` · ${meta.category} · 確信度 ${Number(meta.confidence).toFixed(2)}${meta.reason ? ' · ' + esc(meta.reason) : ''}` : '';
  if (m.status === 'draft') {
    return `<div class="m out draft"><b>AI下書き（承認待ち）</b>
      <textarea id="d${m.id}">${esc(m.body)}</textarea>
      <div class="row" style="margin-top:6px"><button data-approve="${m.id}">承認して送信</button><button class="sub" data-discard="${m.id}">破棄</button></div>
      <div class="meta">${fmt(m.created_at)}${info}</div></div>`;
  }
  return `<div class="m ${m.direction} ${m.status}">${esc(m.body)}<div class="meta">${who} · ${fmt(m.created_at)}${m.status === 'failed' ? ' · <span class="ng">送信失敗</span>' : ''}${info}</div></div>`;
}

async function properties(id) {
  const list = await api('/properties');
  if (id) {
    const p = id === 'new' ? {} : list.find((x) => String(x.id) === id) || {};
    $app.innerHTML = `<div class="card"><h3>${id === 'new' ? '物件を追加' : '物件を編集'}</h3>
      <form id="pf"><div class="grid2">${PROPERTY_FIELDS.filter((f) => !f[2]).map(([k, l]) => `<div><label>${l}</label><input name="${k}" value="${esc(p[k])}"></div>`).join('')}</div>
      ${PROPERTY_FIELDS.filter((f) => f[2]).map(([k, l]) => `<label>${l}</label><textarea name="${k}" rows="6">${esc(p[k])}</textarea>`).join('')}
      <div class="row" style="margin-top:12px"><button>保存</button><a href="#/properties" class="muted">キャンセル</a>
      ${id !== 'new' ? '<button type="button" class="sub" id="del">削除</button>' : ''}</div></form></div>`;
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        if (id === 'new') await api('/properties', { method: 'POST', body });
        else await api('/properties/' + id, { method: 'PUT', body });
        location.hash = '#/properties';
      } catch (err) { alert(err.message); }
    };
    const del = document.getElementById('del');
    if (del) del.onclick = async () => { if (confirm('この物件を削除しますか？')) { await api('/properties/' + id, { method: 'DELETE' }); location.hash = '#/properties'; } };
    return;
  }
  $app.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h3>物件</h3><a href="#/properties/new"><button>物件を追加</button></a></div>
    <table><tr><th>ID</th><th>物件名</th><th>Beds24 ID</th><th>住所</th><th></th></tr>
    ${list.map((p) => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(p.beds24_property_id)}</td><td>${esc(p.address)}</td><td><a href="#/properties/${p.id}">編集</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">物件が登録されていません</td></tr>'}
    </table><p class="muted">Beds24 物件ID を登録すると、Beds24 経由のメッセージが自動で物件に紐づきます。</p></div>`;
}

async function settings() {
  const s = await api('/settings');
  $app.innerHTML = `<div class="card"><h3>AI応答設定</h3><form id="sf">
    <label>返信モード</label><select name="reply_mode">
      <option value="auto" ${s.reply_mode === 'auto' ? 'selected' : ''}>自動送信（確信度が高く、スタッフ対応不要なもののみ）</option>
      <option value="approval" ${s.reply_mode === 'approval' ? 'selected' : ''}>承認制（全てスタッフが確認してから送信）</option></select>
    <label>自動送信の確信度しきい値 (0〜1)</label><input name="confidence_threshold" type="number" step="0.05" min="0" max="1" value="${esc(s.confidence_threshold)}">
    <label>事業者名（AIが名乗る名前）</label><input name="business_name" value="${esc(s.business_name)}">
    <label>AIの人柄・口調</label><input name="ai_persona" value="${esc(s.ai_persona)}">
    <label>必ずスタッフ対応にするキーワード（カンマ区切り）</label><textarea name="escalation_keywords">${esc(s.escalation_keywords)}</textarea>
    <div style="margin-top:12px"><button>保存</button> <span id="saved" class="ok"></span></div></form></div>`;
  document.getElementById('sf').onsubmit = async (e) => {
    e.preventDefault();
    await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    document.getElementById('saved').textContent = '保存しました';
  };
}

async function testAi() {
  const props = await api('/properties');
  $app.innerHTML = `<div class="card"><h3>AI応答テスト（送信はされません）</h3>
    <label>物件</label><select id="tp"><option value="">なし</option>${props.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <label>チャネル</label><select id="tc"><option value="web">チャット</option><option value="voice">電話</option></select>
    <label>ゲストのメッセージ</label><textarea id="tt">What is the Wi-Fi password? And can I check in early at 1pm?</textarea>
    <div style="margin-top:8px"><button id="run">AIに回答させる</button></div><div id="out"></div></div>`;
  document.getElementById('run').onclick = async () => {
    const out = document.getElementById('out');
    out.innerHTML = '<p class="muted">生成中…</p>';
    try {
      const r = await api('/test-ai', { method: 'POST', body: { propertyId: document.getElementById('tp').value, channel: document.getElementById('tc').value, text: document.getElementById('tt').value } });
      out.innerHTML = `<div class="m out" style="max-width:100%">${esc(r.reply)}<div class="meta">${esc(r.category)} · 言語 ${esc(r.language)} · 確信度 ${Number(r.confidence).toFixed(2)} · ${r.needs_human ? '<span class="ng">スタッフ対応</span>' : '<span class="ok">自動送信可</span>'} · ${esc(r.reason)}</div></div>`;
    } catch (e) { out.innerHTML = `<p class="ng">${esc(e.message)}</p>`; }
  };
}
