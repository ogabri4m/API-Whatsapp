require('dotenv').config();

module.exports = {
  evolution: {
    url: process.env.EVOLUTION_API_URL || 'http://evolution-api:8080',
    apiKey: process.env.EVOLUTION_API_KEY || '',
  },

  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  server: {
    port: parseInt(process.env.MIDDLEWARE_PORT || '3100', 10),
    apiKey: process.env.MIDDLEWARE_API_KEY || '',
  },

  proxy: {
    provider: process.env.PROXY_PROVIDER || 'custom',
    smartproxy: {
      user: process.env.PROXY_SMARTPROXY_USER || '',
      pass: process.env.PROXY_SMARTPROXY_PASS || '',
    },
    brightdata: {
      user: process.env.PROXY_BRIGHTDATA_USER || '',
      pass: process.env.PROXY_BRIGHTDATA_PASS || '',
      zone: process.env.PROXY_BRIGHTDATA_ZONE || '',
    },
    custom: {
      host: process.env.PROXY_CUSTOM_HOST || '',
      port: process.env.PROXY_CUSTOM_PORT || '',
      user: process.env.PROXY_CUSTOM_USER || '',
      pass: process.env.PROXY_CUSTOM_PASS || '',
      protocol: process.env.PROXY_CUSTOM_PROTOCOL || 'http',
    },
  },

  antiban: {
    delayMin: parseInt(process.env.ANTIBAN_DELAY_MIN || '3000', 10),
    delayMax: parseInt(process.env.ANTIBAN_DELAY_MAX || '12000', 10),
    batchDelayMin: parseInt(process.env.ANTIBAN_BATCH_DELAY_MIN || '30000', 10),
    batchDelayMax: parseInt(process.env.ANTIBAN_BATCH_DELAY_MAX || '120000', 10),
    batchSize: parseInt(process.env.ANTIBAN_BATCH_SIZE || '10', 10),
    warmupHours: parseInt(process.env.ANTIBAN_WARMUP_HOURS || '48', 10),
    warmupDailyLimit: parseInt(process.env.ANTIBAN_WARMUP_DAILY_LIMIT || '20', 10),
    dailyLimit: parseInt(process.env.ANTIBAN_DAILY_LIMIT || '200', 10),
    sendHourStart: parseInt(process.env.ANTIBAN_SEND_HOUR_START || '8', 10),
    sendHourEnd: parseInt(process.env.ANTIBAN_SEND_HOUR_END || '21', 10),
  },

  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || '',
    webhookSecret: process.env.N8N_WEBHOOK_SECRET || '',
  },
};
