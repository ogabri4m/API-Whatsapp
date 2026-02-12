/**
 * Rotas de gerenciamento de instancias WhatsApp.
 *
 * Cada instancia recebe automaticamente:
 * - Proxy residencial brasileiro unico
 * - Fingerprint de navegador aleatorio
 * - Registro no sistema anti-ban com warm-up
 */
const { Router } = require('express');
const QRCode = require('qrcode');
const evolutionService = require('../services/evolution.service');
const proxyService = require('../services/proxy.service');
const fingerprintService = require('../services/fingerprint.service');
const antibanService = require('../services/antiban.service');
const { getStoredQrCode, storeQrCode } = require('./webhook.routes');
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

    // 2. Cria instancia no Evolution API (payload minimo)
    const instance = await evolutionService.createInstance(instanceName);

    // 3. Atribui proxy residencial
    const proxy = proxyService.assignProxy(instanceName);
    if (proxy.enabled) {
      await evolutionService.setProxy(instanceName, proxy);
    }

    // 4. Registra no sistema anti-ban
    antibanService.registerInstance(instanceName);

    // 5. Configura webhook per-instance (alem do global do docker-compose)
    try {
      await evolutionService.setWebhook(instanceName,
        'http://anti-ban-middleware:3100/webhook/evolution',
        ['qrcode.updated', 'connection.update', 'messages.upsert', 'messages.update']
      );
      logger.info(`Webhook per-instance configurado para ${instanceName}`);
    } catch (webhookErr) {
      logger.warn(`Webhook per-instance falhou para ${instanceName}: ${webhookErr.message}`);
    }

    // Extrai QR Code da resposta do create (Evolution API pode ou nao retornar)
    let qrBase64 = instance.qrcode?.base64 || instance.base64 || null;
    let qrCodeText = instance.qrcode?.code || instance.code || null;
    let qrPairingCode = instance.qrcode?.pairingCode || instance.pairingCode || null;

    logger.info(`Instancia ${instanceName} criada. QR no create response: base64=${qrBase64 ? 'SIM' : 'NAO'}, code=${qrCodeText ? 'SIM' : 'NAO'}`);

    // Se o create nao retornou QR, espera e busca via connect (UMA vez so)
    if (!qrBase64 && !qrCodeText) {
      logger.info(`QR nao veio no create, aguardando 3s e buscando...`);
      await new Promise(r => setTimeout(r, 3000));

      // Verifica se o webhook ja entregou o QR durante a espera
      const stored = getStoredQrCode(instanceName);
      if (stored && (stored.base64 || stored.code)) {
        qrBase64 = stored.base64;
        qrCodeText = stored.code;
        qrPairingCode = stored.pairingCode;
        logger.info(`QR encontrado no webhook store para ${instanceName}`);
      } else {
        // Tenta connect endpoint uma vez
        try {
          const qrData = await evolutionService.getQrCode(instanceName);
          logger.info(`getQrCode result: base64=${qrData.base64 ? 'SIM' : 'NAO'}, code=${qrData.code ? 'SIM' : 'NAO'}`);
          if (qrData.base64 || qrData.code) {
            qrBase64 = qrData.base64;
            qrCodeText = qrData.code;
            qrPairingCode = qrData.pairingCode;
          }
        } catch (err) {
          logger.warn(`getQrCode falhou: ${err.message}`);
        }
      }
    }

    // Salva no store para recuperacao posterior
    if (qrBase64 || qrCodeText) {
      storeQrCode(instanceName, { base64: qrBase64, code: qrCodeText, pairingCode: qrPairingCode });
    }

    logger.info(`Instancia ${instanceName} - QR final: base64=${qrBase64 ? 'SIM' : 'NAO'}, code=${qrCodeText ? 'SIM' : 'NAO'}`);

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
      qrCode: qrBase64,
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
      // v2.2.3 retorna { name, connectionStatus, ... } diretamente
      const name = inst.name || inst.instance?.instanceName || inst.instanceName || 'unknown';
      // v2.2.3 usa connectionStatus (open/close), versoes antigas usam state
      const state = inst.connectionStatus || inst.instance?.status || inst.instance?.state || inst.state || inst.status || 'unknown';
      return {
        name,
        state,
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
    const name = req.params.name;

    // 1. Verifica se temos QR Code armazenado do webhook (mais confiavel)
    const stored = getStoredQrCode(name);
    if (stored && (stored.base64 || stored.code)) {
      let base64 = stored.base64;
      // Se temos code mas nao base64, gera a imagem
      if (!base64 && stored.code) {
        try {
          base64 = await QRCode.toDataURL(stored.code, { width: 300, margin: 2 });
        } catch (e) { /* ignora */ }
      }
      logger.info(`QR Code do webhook store para ${name}: base64=${base64 ? 'SIM' : 'NAO'}`);
      return res.json({
        base64,
        pairingCode: stored.pairingCode || null,
        code: stored.code || null,
      });
    }

    // 2. Tenta buscar direto da Evolution API
    const qrData = await evolutionService.getQrCode(name);

    // Se instancia ja esta conectada
    if (qrData.instance?.state === 'open' || qrData.instance?.status === 'open') {
      return res.json({ connected: true, instance: qrData.instance });
    }

    // Se tem dados do QR
    if (qrData.base64 || qrData.code || qrData.pairingCode) {
      // Armazena para futuras consultas
      storeQrCode(name, { base64: qrData.base64, code: qrData.code, pairingCode: qrData.pairingCode });
      return res.json({
        base64: qrData.base64 || null,
        pairingCode: qrData.pairingCode || null,
        code: qrData.code || null,
      });
    }

    // 3. Espera 1s e verifica webhook store de novo (connect pode ter disparado webhook)
    await new Promise(r => setTimeout(r, 1000));
    const storedAfter = getStoredQrCode(name);
    if (storedAfter && (storedAfter.base64 || storedAfter.code)) {
      let base64 = storedAfter.base64;
      if (!base64 && storedAfter.code) {
        try {
          base64 = await QRCode.toDataURL(storedAfter.code, { width: 300, margin: 2 });
        } catch (e) { /* ignora */ }
      }
      return res.json({
        base64,
        pairingCode: storedAfter.pairingCode || null,
        code: storedAfter.code || null,
      });
    }

    // 4. Nenhum QR disponivel
    res.json({
      base64: null,
      pairingCode: null,
      code: null,
      message: 'QR Code sendo gerado. Aguarde...',
    });
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
