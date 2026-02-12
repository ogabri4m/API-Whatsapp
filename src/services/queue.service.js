/**
 * Servico de fila de mensagens com timing humanizado.
 *
 * Usa BullMQ (Redis) para enfileirar mensagens e processa-las
 * com delays aleatorios que simulam comportamento humano.
 *
 * Recursos:
 * - Delay gaussiano entre mensagens
 * - Pausa entre lotes (simula descanso humano)
 * - Digitacao (composing) antes de enviar
 * - Variacao no texto da mensagem
 * - Retry com backoff exponencial
 */
const { Queue, Worker } = require('bullmq');
const config = require('../config');
const logger = require('../utils/logger');
const evolutionService = require('./evolution.service');
const antibanService = require('./antiban.service');
const {
  messageDelay,
  batchDelay,
  typingDelay,
  addMessageVariation,
  sleep,
} = require('../utils/human-delay');

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

// Fila principal de mensagens
const messageQueue = new Queue('whatsapp-messages', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

// Contador de mensagens no lote atual
let batchCounter = 0;

/**
 * Adiciona mensagem a fila.
 * @param {object} message - { number, text, instanceName?, mediaType?, mediaUrl?, caption? }
 * @returns {object} Job info
 */
async function enqueue(message) {
  const job = await messageQueue.add('send-message', message, {
    // Delay aleatorio entre mensagens
    delay: messageDelay(config.antiban.delayMin, config.antiban.delayMax),
  });

  logger.info(`Mensagem enfileirada: ${job.id} -> ${message.number}`);
  return { jobId: job.id, status: 'queued' };
}

/**
 * Adiciona lote de mensagens a fila.
 * @param {Array} messages - Array de { number, text, instanceName?, ... }
 * @returns {Array} Job infos
 */
async function enqueueBatch(messages) {
  const jobs = [];
  let cumulativeDelay = 0;

  for (let i = 0; i < messages.length; i++) {
    // Delay incremental humanizado
    cumulativeDelay += messageDelay(config.antiban.delayMin, config.antiban.delayMax);

    // Pausa extra entre lotes
    if (i > 0 && i % config.antiban.batchSize === 0) {
      cumulativeDelay += batchDelay(config.antiban.batchDelayMin, config.antiban.batchDelayMax);
      logger.info(`Pausa de lote inserida na posicao ${i}`);
    }

    const job = await messageQueue.add('send-message', messages[i], {
      delay: cumulativeDelay,
    });

    jobs.push({ jobId: job.id, number: messages[i].number, delay: cumulativeDelay });
  }

  logger.info(`Lote enfileirado: ${jobs.length} mensagens, delay total: ${cumulativeDelay}ms`);
  return jobs;
}

/**
 * Processa uma mensagem da fila.
 */
async function processMessage(job) {
  const { number, text, instanceName, mediaType, mediaUrl, caption } = job.data;

  // Seleciona instancia (especifica ou melhor disponivel)
  const instance = instanceName || antibanService.selectBestInstance();

  if (!instance) {
    throw new Error('Nenhuma instancia disponivel para envio');
  }

  // Verifica se instancia pode enviar
  const check = antibanService.canSend(instance);
  if (!check.allowed) {
    throw new Error(`Instancia ${instance}: ${check.reason}`);
  }

  try {
    // 1. Simula digitacao
    await evolutionService.sendPresence(instance, number, 'composing');
    await sleep(typingDelay());

    // 2. Envia mensagem
    let result;
    if (mediaType && mediaUrl) {
      result = await evolutionService.sendMedia(instance, number, mediaType, mediaUrl, caption || '');
    } else {
      const variedText = addMessageVariation(text);
      result = await evolutionService.sendText(instance, number, variedText);
    }

    // 3. Para de digitar
    await evolutionService.sendPresence(instance, number, 'paused');

    // 4. Registra envio no anti-ban
    antibanService.recordMessageSent(instance);

    logger.info(`Mensagem enviada: ${job.id} via ${instance} -> ${number}`);
    return { success: true, instance, messageId: result?.key?.id };
  } catch (err) {
    antibanService.recordError(instance);
    logger.error(`Erro ao enviar mensagem ${job.id}: ${err.message}`);
    throw err;
  }
}

/**
 * Inicia o worker que processa a fila.
 */
function startWorker() {
  const worker = new Worker('whatsapp-messages', processMessage, {
    connection: redisConnection,
    concurrency: 1, // Uma mensagem por vez (crucial para anti-ban)
    limiter: {
      max: 1,
      duration: 1000,
    },
  });

  worker.on('completed', (job, result) => {
    logger.info(`Job ${job.id} completado: ${result?.instance} -> ${job.data.number}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} falhou: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`Worker erro: ${err.message}`);
  });

  logger.info('Worker de mensagens iniciado');
  return worker;
}

/**
 * Retorna estatisticas da fila.
 */
async function getQueueStats() {
  const [waiting, active, delayed, completed, failed] = await Promise.all([
    messageQueue.getWaitingCount(),
    messageQueue.getActiveCount(),
    messageQueue.getDelayedCount(),
    messageQueue.getCompletedCount(),
    messageQueue.getFailedCount(),
  ]);

  return { waiting, active, delayed, completed, failed };
}

/**
 * Limpa jobs completados/falhados.
 */
async function cleanQueue() {
  await messageQueue.clean(0, 0, 'completed');
  await messageQueue.clean(0, 0, 'failed');
  logger.info('Fila limpa');
}

/**
 * Pausa a fila.
 */
async function pauseQueue() {
  await messageQueue.pause();
  logger.info('Fila pausada');
}

/**
 * Retoma a fila.
 */
async function resumeQueue() {
  await messageQueue.resume();
  logger.info('Fila retomada');
}

module.exports = {
  enqueue,
  enqueueBatch,
  startWorker,
  getQueueStats,
  cleanQueue,
  pauseQueue,
  resumeQueue,
};
