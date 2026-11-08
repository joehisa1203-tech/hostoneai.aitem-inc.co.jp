import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DATABASE_PATH = `./data/test-${process.pid}.db`;
process.env.ADMIN_PASSWORD = 'pw';
process.env.LINE_CHANNEL_SECRET = 'line-secret';
process.env.SLACK_SIGNING_SECRET = 'slack-secret';

const { toApiMessages, buildSystemPrompt } = await import('../src/services/ai.js');
const line = await import('../src/channels/line.js');
const slack = await import('../src/channels/slack.js');
const db = await import('../src/db.js');
const { createApp } = await import('../src/server.js');

test('toApiMessages merges roles, skips drafts, starts with user', () => {
  const out = toApiMessages([
    { direction: 'out', sender: 'ai', body: 'welcome', status: 'sent' },
    { direction: 'in', sender: 'guest', body: 'a', status: 'sent' },
    { direction: 'in', sender: 'guest', body: 'b', status: 'sent' },
    { direction: 'out', sender: 'ai', body: 'draft', status: 'draft' },
    { direction: 'out', sender: 'staff', body: 'hi', status: 'sent' },
  ]);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant']);
  assert.equal(out[0].content, 'a\n\nb');
  assert.match(out[1].content, /スタッフ/);
});

test('signature verification', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = crypto.createHmac('sha256', 'line-secret').update(body).digest('base64');
  assert.ok(line.verifySignature(body, sig));
  assert.ok(!line.verifySignature(body, 'bad'));
  const ts = Math.floor(Date.now() / 1000);
  const s = 'v0=' + crypto.createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
  assert.ok(slack.verifySignature(body, ts, s));
});

test('db conversation + dedupe', () => {
  const p = db.saveProperty({ name: 'テスト荘', beds24_property_id: '123', wifi_password: 'pass' });
  const c = db.upsertConversation({ channel: 'beds24', externalId: '999', propertyId: p.id });
  assert.ok(db.addMessage({ conversationId: c.id, direction: 'in', sender: 'guest', body: 'hi', externalId: 'm1' }));
  assert.equal(db.addMessage({ conversationId: c.id, direction: 'in', sender: 'guest', body: 'hi', externalId: 'm1' }), null);
  assert.match(buildSystemPrompt({ property: p, conversation: c, channel: 'voice' }), /テスト荘/);
});

test('http: health, admin auth, webhook signature', async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/admin/api/overview')).status, 401);
    const auth = 'Basic ' + Buffer.from('admin:pw').toString('base64');
    const r = await fetch(base + '/admin/api/overview', { headers: { authorization: auth } });
    assert.equal(r.status, 200);
    assert.equal((await fetch(base + '/admin/', { headers: { authorization: auth } })).status, 200);
    assert.equal((await fetch(base + '/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(base + '/')).status, 200);
  } finally {
    server.close();
  }
});

test.after(async () => {
  db.db.close();
  for (const s of ['', '-wal', '-shm']) { try { (await import('node:fs')).rmSync(process.env.DATABASE_PATH + s); } catch {} }
});
