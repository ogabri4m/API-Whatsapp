/**
 * Rotas de gerenciamento de instancias WhatsApp.
 *
 * Cada instancia recebe automaticamente:
 * - Proxy residencial brasileiro unico
 * - Fingerprint de navegador aleatorio
 * - Registro no sistema anti-ban com warm-up
 */
const { Router } = require('express');
const evolutionService = require('../services/evolution.service');
const proxyService = require('../services/proxy.service');
const fingerprintService = require('../services/fingerprint.service');
const antibanService = require('../services/antiban.service');
const logger = require('../utils/logger');

const router = Router();

/**
 * POST /api/instances
 * Cria uma nova instancia com protecao anti-ban completa.
 *
 * Body: { name: "minha-instancia" }
 * Response: { instance, proxy, fingerprint, qrCode }
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Campo "name" obrigatorio' });
    }

    const instanceName = name.replace(/[^a-zA-Z0-9_-]/g, '');

    // 1. Gera fingerprint unico
    const fingerprint = fingerprintService.assignFingerprint(instanceName);

    // 2. Cria instancia no Evolution API
    const instance = await evolutionService.createInstance(instanceName, {
      browserInfo: fingerprint.baileysBrowser,
    });

    // 3. Atribui proxy residencial
    const proxy = proxyService.assignProxy(instanceName);
    if (proxy.enabled) {
      await evolutionService.setProxy(instanceName, proxy);
    }

    // 4. Registra no sistema anti-ban
    antibanService.registerInstance(instanceName);

    // 5. Busca QR Code para conexao
    let qrCode = null;
    try {
      qrCode = await evolutionService.getQrCode(instanceName);
    } catch (err) {
      logger.warn(`QR Code nao disponivel ainda para ${instanceName}`);
    }

    res.status(201).json({
      success: true,
      instance: {
        name: instanceName,
        status: 'created',
        warmup: true,
        dailyLimit: antibanService.getDailyLimit(instanceName),
      },
      proxy: {
        enabled: proxy.enabled,
        provider: proxy.enabled ? 'configured' : 'none',
      },
      fingerprint: {
        id: fingerprint.id,
        browser: `${fingerprint.browser} ${fingerprint.browserVersion}`,
        os: `${fingerprint.os} ${fingerprint.osVersion}`,
        screen: `${fingerprint.screen.width}x${fingerprint.screen.height}`,
      },
      qrCode: qrCode?.base64 || qrCode?.pairingCode || null,
    });
  } catch (err) {
    logger.error(`Erro ao criar instancia: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/instances
 * Lista todas as instancias com status anti-ban.
 */
router.get('/', async (req, res) => {
  try {
    const instances = await evolutionService.listInstances();
    const antibanStatus = antibanService.getStatus();
    const fingerprints = fingerprintService.listFingerprints();
    const proxies = proxyService.listProxies();

    const enriched = (instances || []).map((inst) => {
      // Suporta multiplos formatos da Evolution API v2.x
      const name = inst.instance?.instanceName || inst.instanceName || inst.name || 'unknown';
      return {
        name,
        state: inst.instance?.status || inst.instance?.state || inst.state || inst.status || 'unknown',
        antiban: antibanStatus[name] || null,
        fingerprint: fingerprints[name] || null,
        proxy: proxies[name] || null,
      };
    }).filter(inst => inst.name !== 'unknown');

    res.json({ instances: enriched });
  } catch (err) {
    logger.error(`Erro ao listar instancias: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/instances/:name/qrcode
 * Busca QR Code para conectar instancia.
 */
router.get('/:name/qrcode', async (req, res) => {
  try {
    const qrCode = await evolutionService.getQrCode(req.params.name);
    res.json(qrCode);
  } catch (err) {
    logger.error(`Erro ao buscar QR Code: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/instances/:name/status
 * Verifica status de conexao da instancia.
 */
router.get('/:name/status', async (req, res) => {
  try {
    const state = await evolutionService.getConnectionState(req.params.name);
    const canSend = antibanService.canSend(req.params.name);
    const fp = fingerprintService.getFingerprint(req.params.name);

    res.json({
      connection: state,
      antiban: {
        canSend: canSend.allowed,
        reason: canSend.reason || null,
        isWarmup: antibanService.isInWarmup(req.params.name),
        dailyLimit: antibanService.getDailyLimit(req.params.name),
      },
      fingerprint: fp ? { id: fp.id, browser: fp.browser } : null,
    });
  } catch (err) {
    logger.error(`Erro ao verificar status: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/instances/:name/rotate-proxy
 * Rotaciona o proxy de uma instancia (novo IP).
 */
router.post('/:name/rotate-proxy', async (req, res) => {
  try {
    const newProxy = await antibanService.rotateInstanceProxy(req.params.name);
    res.json({
      success: true,
      proxy: { enabled: newProxy.enabled },
    });
  } catch (err) {
    logger.error(`Erro ao rotacionar proxy: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/instances/:name/reactivate
 * Reativa uma instancia pausada por erros.
 */
router.post('/:name/reactivate', async (req, res) => {
  try {
    const result = antibanService.reactivateInstance(req.params.name);
    if (!result) {
      return res.status(404).json({ error: 'Instancia nao encontrada' });
    }
    res.json({ success: true, message: 'Instancia reativada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/instances/:name
 * Remove instancia completamente.
 */
router.delete('/:name', async (req, res) => {
  try {
    const name = req.params.name;

    // Limpa do middleware mesmo se falhar na Evolution API
    try {
      await evolutionService.deleteInstance(name);
    } catch (err) {
      logger.warn(`Falha ao remover ${name} da Evolution API: ${err.message}`);
    }

    antibanService.unregisterInstance(name);
    fingerprintService.removeFingerprint(name);
    proxyService.removeProxy(name);

    res.json({ success: true, message: `Instancia ${name} removida` });
  } catch (err) {
    logger.error(`Erro ao remover instancia: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
