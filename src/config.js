import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  dbPath: env.DATABASE_PATH || './data/hostone.db',
  admin: { user: env.ADMIN_USER || 'admin', password: env.ADMIN_PASSWORD || '' },
  ai: {
    model: env.AI_MODEL || 'claude-opus-5-5',
    effort: env.AI_EFFORT || 'low',
    fallbacks: (env.AI_FALLBACKS || 'on') !== 'off',
  },
  beds24: {
    refreshToken: env.BEDS24_REFRESH_TOKEN || '',
    pollSeconds: Number(env.BEDS24_POLL_SECONDS || 60),
    baseUrl: 'https://beds24.com/api/v2',
  },
  line: {
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    accessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
  },
  slack: {
    botToken: env.SLACK_BOT_TOKEN || '',
    signingSecret: env.SLACK_SIGNING_SECRET || '',
    notifyChannel: env.SLACK_NOTIFY_CHANNEL || '',
    webhookUrl: env.SLACK_WEBHOOK_URL || '',
  },
  twilio: {
    authToken: env.TWILIO_AUTH_TOKEN || '',
    hostPhone: env.HOST_PHONE_NUMBER || '',
  },
};
