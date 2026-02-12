/**
 * WhatsApp Anti-Ban Middleware
 *
 * Servidor principal que orquestra:
 * - Evolution API (motor WhatsApp)
 * - Proxy residencial brasileiro rotativo
 * - Fingerprint de navegador randomizado por instancia
 * - Fila de mensagens com timing humanizado
 * - Sistema anti-ban com warm-up e limites
 * - Integracao N8N via webhooks
 *
 * Arquitetura:
 *   N8N → Middleware (porta 3100) → Evolution API (porta 8080) → WhatsApp
 *                ↓
 *         Proxy Residencial BR
 *         Fingerprint Aleatorio
 *         Delays Humanizados
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');

// Rotas
const instanceRoutes = require('./routes/instance.routes');
const messageRoutes = require('./routes/message.routes');
const webhookRoutes = require('./routes/webhook.routes');

// Servicos
const queueService = require('./services/queue.service');
const antibanService = require('./services/antiban.service');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Dashboard frontend (arquivos estaticos)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check (sem auth)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'whatsapp-anti-ban-middleware',
    timestamp: new Date().toISOString(),
  });
});

// Configuracao do sistema - SEM AUTH (dashboard precisa acessar)
app.get('/api/config', (req, res) => {
  res.json({
    evolution: {
      url: config.evolution.url,
      apiKey: config.evolution.apiKey,
      managerUrl: config.evolution.url.replace('://evolution-api:', '://localhost:').replace(':8080', ':8080/manager'),
    },
    middleware: {
      port: config.server.port,
    },
    antiban: {
      delayMin: config.antiban.delayMin,
      delayMax: config.antiban.delayMax,
      batchSize: config.antiban.batchSize,
      warmupHours: config.antiban.warmupHours,
      warmupDailyLimit: config.antiban.warmupDailyLimit,
      dailyLimit: config.antiban.dailyLimit,
      sendHourStart: config.antiban.sendHourStart,
      sendHourEnd: config.antiban.sendHourEnd,
    },
  });
});

// Dashboard - status geral do sistema - SEM AUTH
app.get('/api/dashboard', async (req, res) => {
  try {
    const queueStats = await queueService.getQueueStats();
    const antibanStatus = antibanService.getStatus();
    const withinHours = antibanService.isWithinSendingHours();

    res.json({
      system: {
        withinSendingHours: withinHours,
        sendingWindow: `${config.antiban.sendHourStart}h - ${config.antiban.sendHourEnd}h`,
      },
      instances: antibanStatus,
      queue: queueStats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhooks (recebe do Evolution API)
app.use('/webhook', webhookRoutes);

// Rotas da API
app.use('/api/instances', instanceRoutes);
app.use('/api/messages', messageRoutes);

// Inicia servidor
app.listen(config.server.port, () => {
  logger.info(`Anti-Ban Middleware rodando na porta ${config.server.port}`);
  logger.info(`Evolution API: ${config.evolution.url}`);
  logger.info(`Proxy provider: ${config.proxy.provider}`);
  logger.info(`Horario de envio: ${config.antiban.sendHourStart}h - ${config.antiban.sendHourEnd}h`);
  logger.info(`Warm-up: ${config.antiban.warmupHours}h | Limite diario: ${config.antiban.dailyLimit}`);

  // Inicia worker da fila de mensagens
  queueService.startWorker();
  logger.info('Worker de mensagens iniciado');
});
