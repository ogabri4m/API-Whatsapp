/**
 * Cliente HTTP para a Evolution API.
 *
 * Encapsula todas as chamadas REST para o Evolution API,
 * incluindo criacao de instancias, envio de mensagens,
 * configuracao de proxy e webhooks.
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const api = axios.create({
  baseURL: config.evolution.url,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    apikey: config.evolution.apiKey,
  },
});

// Log de requests para debug
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status || 'NETWORK_ERROR';
    const url = err.config?.url || 'unknown';
    logger.error(`Evolution API erro: ${status} ${url}`, {
      data: err.response?.data,
    });
    throw err;
  }
);

/**
 * Cria uma nova instancia WhatsApp no Evolution API.
 * @param {string} instanceName - Nome unico da instancia
 * @param {object} options - Opcoes adicionais (webhook, fingerprint)
 */
async function createInstance(instanceName, options = {}) {
  // Payload minimo para Evolution API v2.2.3
  const payload = {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
  };

  const { data } = await api.post('/instance/create', payload);
  logger.info(`Instancia criada: ${instanceName} - resposta: ${JSON.stringify(data).substring(0, 500)}`);
  return data;
}

/**
 * Reinicia uma instancia para forcar reconexao.
 */
async function restartInstance(instanceName) {
  try {
    const { data } = await api.post(`/instance/restart/${instanceName}`, {});
    logger.info(`Instancia reiniciada: ${instanceName}`);
    return data;
  } catch (err) {
    logger.warn(`Restart falhou para ${instanceName}: ${err.message}`);
    return null;
  }
}

/**
 * Configura proxy para uma instancia.
 * @param {string} instanceName
 * @param {object} proxyConfig - { enabled, host, port, protocol, username, password }
 */
async function setProxy(instanceName, proxyConfig) {
  if (!proxyConfig.enabled) {
    logger.warn(`Proxy desabilitado para ${instanceName}`);
    return null;
  }

  const { data } = await api.post(`/proxy/set/${instanceName}`, {
    enabled: proxyConfig.enabled,
    host: proxyConfig.host,
    port: proxyConfig.port,
    protocol: proxyConfig.protocol,
    username: proxyConfig.username,
    password: proxyConfig.password,
  });

  logger.info(`Proxy configurado para ${instanceName}: ${proxyConfig.host}:${proxyConfig.port}`);
  return data;
}

/**
 * Busca QR Code para conectar uma instancia.
 */
async function getQrCode(instanceName) {
  // Apenas chama GET /instance/connect para iniciar conexao
  // O QR Code real vem via webhook (qrcode.updated) e fica no store
  try {
    const res = await api.get(`/instance/connect/${instanceName}`);
    const data = res.data;
    logger.info(`QR connect ${instanceName}: ${JSON.stringify(data).substring(0, 500)}`);

    // Se veio QR Code direto na resposta
    const qr = data.qrcode || data;
    if (qr.base64 || qr.code || qr.pairingCode) {
      return {
        base64: qr.base64 || null,
        pairingCode: qr.pairingCode || null,
        code: qr.code || null,
        instance: data.instance || null,
      };
    }
  } catch (err) {
    logger.warn(`QR connect falhou ${instanceName}: ${err.response?.status}`);
  }

  // QR nao disponivel na resposta REST (normal na v2.2.3)
  // O QR Code sera entregue via webhook qrcode.updated
  return { base64: null, pairingCode: null, code: null, instance: null };
}

/**
 * Verifica status de conexao de uma instancia.
 */
async function getConnectionState(instanceName) {
  const { data } = await api.get(`/instance/connectionState/${instanceName}`);
  return data;
}

/**
 * Lista todas as instancias.
 */
async function listInstances() {
  const { data } = await api.get('/instance/fetchInstances');
  // Normaliza formato - v2.x pode retornar array ou objeto
  if (Array.isArray(data)) return data;
  if (data?.instances) return data.instances;
  return [];
}

/**
 * Deleta uma instancia.
 */
async function deleteInstance(instanceName) {
  try {
    const { data } = await api.delete(`/instance/delete/${instanceName}`);
    logger.info(`Instancia deletada: ${instanceName}`);
    return data;
  } catch (err) {
    // Se instancia nao existe na Evolution API, ignora
    if (err.response?.status === 404) {
      logger.warn(`Instancia ${instanceName} nao encontrada na Evolution API (ja removida)`);
      return { deleted: true };
    }
    throw err;
  }
}

/**
 * Desconecta (logout) uma instancia.
 */
async function logoutInstance(instanceName) {
  const { data } = await api.delete(`/instance/logout/${instanceName}`);
  logger.info(`Instancia desconectada: ${instanceName}`);
  return data;
}

/**
 * Envia mensagem de texto.
 * @param {string} instanceName
 * @param {string} number - Numero com DDI (ex: 5511999999999)
 * @param {string} text - Texto da mensagem
 */
async function sendText(instanceName, number, text) {
  const { data } = await api.post(`/message/sendText/${instanceName}`, {
    number,
    text,
  });
  return data;
}

/**
 * Simula digitacao (composing) antes de enviar.
 * Mostra "digitando..." no WhatsApp do destinatario.
 */
async function sendPresence(instanceName, number, type = 'composing') {
  try {
    const { data } = await api.post(`/chat/sendPresence/${instanceName}`, {
      number,
      presence: type,
    });
    return data;
  } catch (err) {
    // Nao falha se presenca nao funcionar
    logger.warn(`Presenca falhou para ${instanceName}: ${err.message}`);
    return null;
  }
}

/**
 * Envia mensagem de midia (imagem, video, audio, documento).
 */
async function sendMedia(instanceName, number, mediaType, mediaUrl, caption = '') {
  const { data } = await api.post(`/message/sendMedia/${instanceName}`, {
    number,
    mediatype: mediaType,
    media: mediaUrl,
    caption,
  });
  return data;
}

/**
 * Configura webhook para uma instancia.
 */
async function setWebhook(instanceName, webhookUrl, events = []) {
  const { data } = await api.post(`/webhook/set/${instanceName}`, {
    enabled: true,
    url: webhookUrl,
    webhookByEvents: true,
    events: events.length > 0 ? events : [
      'messages.upsert',
      'messages.update',
      'connection.update',
      'qrcode.updated',
    ],
  });

  logger.info(`Webhook configurado para ${instanceName}: ${webhookUrl}`);
  return data;
}

/**
 * Busca info da instancia.
 */
async function fetchInstance(instanceName) {
  const { data } = await api.get(`/instance/fetchInstances`, {
    params: { instanceName },
  });
  return data;
}

module.exports = {
  createInstance,
  restartInstance,
  setProxy,
  getQrCode,
  getConnectionState,
  listInstances,
  deleteInstance,
  logoutInstance,
  sendText,
  sendPresence,
  sendMedia,
  setWebhook,
  fetchInstance,
};
