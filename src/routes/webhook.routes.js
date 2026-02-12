/**
 * Rotas de webhook.
 *
 * Recebe eventos do Evolution API e encaminha para N8N.
 * Tambem expoe endpoint para N8N enviar mensagens.
 */
const { Router } = require('express');
const axios = require('axios');
const config = require('../config');
const queueService = require('../services/queue.service');
const logger = require('../utils/logger');

const router = Router();

/**
 * POST /webhook/evolution
 * Recebe eventos do Evolution API (configurado como webhook global).
 * Encaminha para N8N se configurado.
 */
router.post('/evolution', async (req, res) => {
  try {
    const event = req.body;
    const eventType = event.event || 'unknown';
    const instanceName = event.instance || 'unknown';

    logger.info(`Webhook Evolution: ${eventType} de ${instanceName}`);

    // Encaminha para N8N se configurado
    if (config.n8n.webhookUrl) {
      try {
        const headers = {};
        if (config.n8n.webhookSecret) {
          headers['x-webhook-secret'] = config.n8n.webhookSecret;
        }

        await axios.post(config.n8n.webhookUrl, {
          source: 'evolution-api',
          event: eventType,
          instance: instanceName,
          data: event.data || event,
          timestamp: new Date().toISOString(),
        }, {
          headers,
          timeout: 10000,
        });

        logger.info(`Evento encaminhado para N8N: ${eventType}`);
      } catch (err) {
        logger.warn(`Falha ao encaminhar para N8N: ${err.message}`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error(`Erro no webhook: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /webhook/n8n/send
 * Endpoint para N8N enviar mensagens via middleware.
 * N8N chama este endpoint com os dados da mensagem.
 *
 * Body: {
 *   number: "5511999999999",
 *   text: "Mensagem",
 *   instanceName?: "instancia",
 *   mediaType?: "image",
 *   mediaUrl?: "https://...",
 *   caption?: "Legenda"
 * }
 */
router.post('/n8n/send', async (req, res) => {
  try {
    // Valida secret se configurado
    if (config.n8n.webhookSecret) {
      const secret = req.headers['x-webhook-secret'];
      if (secret !== config.n8n.webhookSecret) {
        return res.status(401).json({ error: 'Secret invalido' });
      }
    }

    const { number, text, instanceName, mediaType, mediaUrl, caption } = req.body;

    if (!number) {
      return res.status(400).json({ error: 'Campo "number" obrigatorio' });
    }
    if (!text && !mediaUrl) {
      return res.status(400).json({ error: 'Campo "text" ou "mediaUrl" obrigatorio' });
    }

    const result = await queueService.enqueue({
      number,
      text,
      instanceName,
      mediaType,
      mediaUrl,
      caption,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Erro no webhook N8N: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /webhook/n8n/send-batch
 * Endpoint para N8N enviar lote de mensagens.
 *
 * Body: {
 *   messages: [
 *     { number: "5511999999999", text: "Ola" },
 *     ...
 *   ],
 *   instanceName?: "instancia"
 * }
 */
router.post('/n8n/send-batch', async (req, res) => {
  try {
    if (config.n8n.webhookSecret) {
      const secret = req.headers['x-webhook-secret'];
      if (secret !== config.n8n.webhookSecret) {
        return res.status(401).json({ error: 'Secret invalido' });
      }
    }

    const { messages, instanceName } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '"messages" deve ser array nao vazio' });
    }

    const enriched = messages.map((msg) => ({
      ...msg,
      instanceName: msg.instanceName || instanceName,
    }));

    const jobs = await queueService.enqueueBatch(enriched);

    res.json({
      success: true,
      totalQueued: jobs.length,
      jobs,
    });
  } catch (err) {
    logger.error(`Erro no webhook N8N batch: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
