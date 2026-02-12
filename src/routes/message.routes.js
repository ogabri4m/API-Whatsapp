/**
 * Rotas de envio de mensagens.
 *
 * Todas as mensagens passam pela fila com timing humanizado.
 * O sistema anti-ban seleciona automaticamente a melhor instancia
 * e aplica delays realistas.
 */
const { Router } = require('express');
const queueService = require('../services/queue.service');
const antibanService = require('../services/antiban.service');
const logger = require('../utils/logger');

const router = Router();

/**
 * POST /api/messages/send
 * Envia uma mensagem de texto via fila.
 *
 * Body: {
 *   number: "5511999999999",
 *   text: "Mensagem aqui",
 *   instanceName?: "instancia-especifica"  // opcional, auto-seleciona se omitido
 * }
 */
router.post('/send', async (req, res) => {
  try {
    const { number, text, instanceName } = req.body;

    if (!number || !text) {
      return res.status(400).json({ error: 'Campos "number" e "text" obrigatorios' });
    }

    // Verifica se alguma instancia pode enviar
    if (!instanceName) {
      const best = antibanService.selectBestInstance();
      if (!best) {
        return res.status(503).json({
          error: 'Nenhuma instancia disponivel',
          details: antibanService.getStatus(),
        });
      }
    }

    const result = await queueService.enqueue({ number, text, instanceName });
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Erro ao enfileirar mensagem: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/messages/send-batch
 * Envia lote de mensagens com delays humanizados automaticos.
 *
 * Body: {
 *   messages: [
 *     { number: "5511999999999", text: "Ola!" },
 *     { number: "5511888888888", text: "Ola!" }
 *   ],
 *   instanceName?: "instancia-especifica"
 * }
 */
router.post('/send-batch', async (req, res) => {
  try {
    const { messages, instanceName } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Campo "messages" deve ser um array nao vazio' });
    }

    // Valida todas as mensagens
    for (const msg of messages) {
      if (!msg.number || !msg.text) {
        return res.status(400).json({
          error: 'Cada mensagem deve ter "number" e "text"',
        });
      }
    }

    // Adiciona instanceName se especificado
    const enrichedMessages = messages.map((msg) => ({
      ...msg,
      instanceName: msg.instanceName || instanceName,
    }));

    const jobs = await queueService.enqueueBatch(enrichedMessages);

    res.json({
      success: true,
      totalQueued: jobs.length,
      jobs,
    });
  } catch (err) {
    logger.error(`Erro ao enfileirar lote: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/messages/send-media
 * Envia midia (imagem, video, audio, documento).
 *
 * Body: {
 *   number: "5511999999999",
 *   mediaType: "image",        // image, video, audio, document
 *   mediaUrl: "https://...",
 *   caption?: "Legenda",
 *   instanceName?: "instancia"
 * }
 */
router.post('/send-media', async (req, res) => {
  try {
    const { number, mediaType, mediaUrl, caption, instanceName } = req.body;

    if (!number || !mediaType || !mediaUrl) {
      return res.status(400).json({
        error: 'Campos "number", "mediaType" e "mediaUrl" obrigatorios',
      });
    }

    const result = await queueService.enqueue({
      number,
      mediaType,
      mediaUrl,
      caption,
      instanceName,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Erro ao enfileirar midia: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/messages/queue/stats
 * Retorna estatisticas da fila de mensagens.
 */
router.get('/queue/stats', async (req, res) => {
  try {
    const stats = await queueService.getQueueStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/messages/queue/pause
 * Pausa o processamento da fila.
 */
router.post('/queue/pause', async (req, res) => {
  try {
    await queueService.pauseQueue();
    res.json({ success: true, message: 'Fila pausada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/messages/queue/resume
 * Retoma o processamento da fila.
 */
router.post('/queue/resume', async (req, res) => {
  try {
    await queueService.resumeQueue();
    res.json({ success: true, message: 'Fila retomada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/messages/queue/clean
 * Limpa jobs completados e falhados da fila.
 */
router.post('/queue/clean', async (req, res) => {
  try {
    await queueService.cleanQueue();
    res.json({ success: true, message: 'Fila limpa' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
