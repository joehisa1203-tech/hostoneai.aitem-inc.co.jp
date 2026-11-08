import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db.js';
import { router as adminRouter, basicAuth } from './routes/admin.js';
import { router as chatRouter } from './routes/chat.js';
import { router as voiceRouter } from './routes/voice.js';
import { router as webhookRouter, onBeds24GuestMessage, setBeds24PollTrigger } from './routes/webhooks.js';
import * as beds24 from './channels/beds24.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const keepRaw = (req, res, buf) => { req.rawBody = buf; };
  app.use(express.json({ limit: '1mb', verify: keepRaw }));
  app.use(express.urlencoded({ extended: false, verify: keepRaw }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use(webhookRouter);
  app.use(voiceRouter);
  app.use(chatRouter);
  app.use(adminRouter);
  app.use('/admin', basicAuth, express.static(path.join(publicDir, 'admin')));
  app.use(express.static(publicDir, { extensions: ['html'] }));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen(config.port, () => console.log(`HostOne AI listening on :${config.port} (${config.baseUrl})`));
  const poller = beds24.startPolling((m) => onBeds24GuestMessage(m, beds24));
  if (poller) setBeds24PollTrigger(poller.tick);
}
