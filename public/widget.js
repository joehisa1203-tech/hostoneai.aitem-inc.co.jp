/* HostOne AI Webチャットウィジェット
 * 埋め込み: <script src="https://hostoneai.aitem-inc.co.jp/widget.js" data-property="1" defer></script>
 */
(function () {
  var script = document.currentScript;
  var base = script ? new URL(script.src).origin : '';
  var propertyId = script ? script.getAttribute('data-property') : null;
  var KEY = 'hostone_chat_session';
  var sessionId = null, lastId = 0, timer = null, seen = {};
  try { sessionId = localStorage.getItem(KEY); } catch (e) {}

  var css = '.ho-btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;background:#0f766e;color:#fff;border:0;font-size:26px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:99998}' +
    '.ho-box{position:fixed;right:20px;bottom:92px;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100vh - 120px));background:#fff;color:#14213d;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:99999;font-family:system-ui,"Hiragino Sans",sans-serif}' +
    '.ho-box.open{display:flex}.ho-head{background:#0f766e;color:#fff;padding:14px 16px;font-weight:700}.ho-head small{display:block;font-weight:400;opacity:.85}' +
    '.ho-log{flex:1;overflow:auto;padding:14px;background:#f5f7fa}.ho-m{max-width:82%;padding:9px 12px;border-radius:12px;margin:6px 0;white-space:pre-wrap;font-size:14px;line-height:1.6}' +
    '.ho-g{margin-left:auto;background:#0f766e;color:#fff}.ho-a{background:#fff;border:1px solid #e3e7ee}' +
    '.ho-f{display:flex;border-top:1px solid #e3e7ee}.ho-f textarea{flex:1;border:0;padding:12px;font:inherit;resize:none;outline:none;height:52px}.ho-f button{border:0;background:#0f766e;color:#fff;padding:0 18px;font-weight:700;cursor:pointer}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement('button'); btn.className = 'ho-btn'; btn.setAttribute('aria-label', 'チャットを開く'); btn.textContent = '💬';
  var box = document.createElement('div'); box.className = 'ho-box';
  box.innerHTML = '<div class="ho-head">AIコンシェルジュ<small>24時間・多言語対応 / 24/7 multilingual</small></div><div class="ho-log"></div>' +
    '<form class="ho-f"><textarea placeholder="メッセージを入力 / Type a message" aria-label="メッセージ"></textarea><button type="submit">送信</button></form>';
  document.body.appendChild(btn); document.body.appendChild(box);
  var log = box.querySelector('.ho-log'), form = box.querySelector('form'), input = box.querySelector('textarea');

  function add(text, who) {
    var d = document.createElement('div'); d.className = 'ho-m ' + (who === 'guest' ? 'ho-g' : 'ho-a'); d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  btn.onclick = function () {
    box.classList.toggle('open');
    if (box.classList.contains('open') && !log.childNodes.length) add('こんにちは！ご予約・チェックイン・周辺情報など、お気軽にご質問ください。\nHello! How can I help you?', 'ai');
  };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = function (e) {
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = ''; add(text, 'guest');
    var typing = document.createElement('div'); typing.className = 'ho-m ho-a'; typing.textContent = '…'; log.appendChild(typing);
    fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, propertyId: propertyId, text: text }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove();
        if (d.error) return add('送信できませんでした。時間をおいてお試しください。', 'ai');
        sessionId = d.sessionId; try { localStorage.setItem(KEY, sessionId); } catch (e) {}
        if (!d.pending) seen[d.lastId] = true;
        add(d.reply, 'ai'); lastId = Math.max(lastId, d.lastId || 0); poll();
      })
      .catch(function () { typing.remove(); add('通信エラーが発生しました。', 'ai'); });
  };
  function poll() {
    clearInterval(timer);
    timer = setInterval(function () {
      if (!sessionId) return;
      fetch(base + '/api/chat/' + sessionId + '?after=' + lastId).then(function (r) { return r.json(); }).then(function (d) {
        (d.messages || []).forEach(function (m) { lastId = Math.max(lastId, m.id); if (!seen[m.id]) { seen[m.id] = true; add(m.body, 'ai'); } });
      }).catch(function () {});
    }, 8000);
  }
})();
