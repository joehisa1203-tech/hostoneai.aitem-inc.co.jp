import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  beds24_property_id TEXT,
  address TEXT DEFAULT '',
  checkin_time TEXT DEFAULT '15:00',
  checkout_time TEXT DEFAULT '10:00',
  wifi_ssid TEXT DEFAULT '',
  wifi_password TEXT DEFAULT '',
  access_info TEXT DEFAULT '',
  house_rules TEXT DEFAULT '',
  faq TEXT DEFAULT '',
  emergency_contact TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,              -- beds24 | line | slack | voice | web
  external_id TEXT NOT NULL,          -- bookingId / LINE userId / Slack channel / CallSid / web session
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  guest_name TEXT DEFAULT '',
  booking_id TEXT DEFAULT '',
  booking_info TEXT DEFAULT '',       -- JSON
  status TEXT DEFAULT 'open',         -- open | needs_human | closed
  ai_enabled INTEGER DEFAULT 1,
  slack_thread_ts TEXT DEFAULT '',
  last_message_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel, external_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,            -- in | out
  sender TEXT NOT NULL,               -- guest | ai | staff
  body TEXT NOT NULL,
  status TEXT DEFAULT 'sent',         -- sent | draft | failed | discarded
  external_id TEXT,
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_ext ON messages(conversation_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const DEFAULT_SETTINGS = {
  reply_mode: 'auto',          // auto: 自動送信 / approval: 全てスタッフ承認
  confidence_threshold: '0.7', // これ未満は承認待ちに回す
  business_name: 'HostOne AI',
  ai_persona: '丁寧で温かみのある民泊コンシェルジュ',
  escalation_keywords: '警察,救急,火事,怪我,事故,返金,キャンセル料,クレーム,鍵が開かない',
};
const insertDefault = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(k, v);

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
export function allSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}

// ---------- properties ----------
export const PROPERTY_FIELDS = [
  'name', 'beds24_property_id', 'address', 'checkin_time', 'checkout_time', 'wifi_ssid',
  'wifi_password', 'access_info', 'house_rules', 'faq', 'emergency_contact',
];
export function getProperty(id) {
  return id ? db.prepare('SELECT * FROM properties WHERE id = ?').get(id) : null;
}
export function findPropertyByBeds24(beds24Id) {
  return beds24Id ? db.prepare('SELECT * FROM properties WHERE beds24_property_id = ?').get(String(beds24Id)) : null;
}
export function listProperties() {
  return db.prepare('SELECT * FROM properties ORDER BY id').all();
}
export function saveProperty(data, id) {
  const fields = PROPERTY_FIELDS.filter((f) => data[f] !== undefined);
  if (id) {
    if (!fields.length) return getProperty(id);
    db.prepare(`UPDATE properties SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`)
      .run({ ...pick(data, fields), id });
    return getProperty(id);
  }
  const info = db.prepare(`INSERT INTO properties (${fields.join(',')}) VALUES (${fields.map((f) => '@' + f).join(',')})`)
    .run(pick(data, fields));
  return getProperty(info.lastInsertRowid);
}
export function deleteProperty(id) {
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
}

// ---------- conversations ----------
export function upsertConversation({ channel, externalId, propertyId = null, guestName = '', bookingId = '', bookingInfo = null }) {
  let conv = db.prepare('SELECT * FROM conversations WHERE channel = ? AND external_id = ?').get(channel, String(externalId));
  if (!conv) {
    const info = db.prepare(`INSERT INTO conversations (channel, external_id, property_id, guest_name, booking_id, booking_info)
      VALUES (?, ?, ?, ?, ?, ?)`).run(channel, String(externalId), propertyId, guestName, String(bookingId || ''),
      bookingInfo ? JSON.stringify(bookingInfo) : '');
    conv = getConversation(info.lastInsertRowid);
  } else {
    const updates = {};
    if (propertyId && !conv.property_id) updates.property_id = propertyId;
    if (guestName && !conv.guest_name) updates.guest_name = guestName;
    if (bookingInfo) updates.booking_info = JSON.stringify(bookingInfo);
    if (Object.keys(updates).length) conv = updateConversation(conv.id, updates);
  }
  return conv;
}
export function getConversation(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}
export function findConversationBySlackThread(ts) {
  return db.prepare('SELECT * FROM conversations WHERE slack_thread_ts = ?').get(ts);
}
export function updateConversation(id, data) {
  const allowed = ['property_id', 'guest_name', 'booking_info', 'status', 'ai_enabled', 'slack_thread_ts', 'last_message_at'];
  const fields = allowed.filter((f) => data[f] !== undefined);
  if (fields.length) {
    db.prepare(`UPDATE conversations SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`)
      .run({ ...pick(data, fields), id });
  }
  return getConversation(id);
}
export function listConversations({ status, channel, limit = 100 } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('c.status = @status'); params.status = status; }
  if (channel) { where.push('c.channel = @channel'); params.channel = channel; }
  return db.prepare(`
    SELECT c.*, p.name AS property_name,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.status = 'draft') AS draft_count
    FROM conversations c LEFT JOIN properties p ON p.id = c.property_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.last_message_at DESC LIMIT ${Number(limit) || 100}`).all(params);
}

// ---------- messages ----------
export function addMessage({ conversationId, direction, sender, body, status = 'sent', externalId = null, meta = {} }) {
  try {
    const info = db.prepare(`INSERT INTO messages (conversation_id, direction, sender, body, status, external_id, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(conversationId, direction, sender, body, status,
      externalId == null ? null : String(externalId), JSON.stringify(meta));
    db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(conversationId);
    return getMessage(info.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return null; // 重複(取り込み済み)
    throw e;
  }
}
export function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}
export function updateMessage(id, data) {
  const fields = ['body', 'status', 'meta'].filter((f) => data[f] !== undefined);
  if (fields.length) {
    db.prepare(`UPDATE messages SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`)
      .run({ ...pick(data, fields), id });
  }
  return getMessage(id);
}
export function listMessages(conversationId, { includeDrafts = true } = {}) {
  return db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ${includeDrafts ? '' : "AND status = 'sent'"} ORDER BY id`)
    .all(conversationId);
}
export function stats() {
  const q = (sql) => db.prepare(sql).get().n;
  return {
    conversations: q('SELECT COUNT(*) n FROM conversations'),
    needs_human: q("SELECT COUNT(*) n FROM conversations WHERE status = 'needs_human'"),
    ai_replies_today: q("SELECT COUNT(*) n FROM messages WHERE sender = 'ai' AND status = 'sent' AND date(created_at) = date('now')"),
    guest_messages_today: q("SELECT COUNT(*) n FROM messages WHERE sender = 'guest' AND date(created_at) = date('now')"),
    drafts: q("SELECT COUNT(*) n FROM messages WHERE status = 'draft'"),
  };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
