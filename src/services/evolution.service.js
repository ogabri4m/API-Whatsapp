/**
 * Cliente HTTP para a Evolution API.
 *
 * Encapsula todas as chamadas REST para o Evolution API,
 * incluindo criacao de instancias, envio de mensagens,
 * configuracao de proxy e webhooks.
 */
const axios = require('axios');
const QRCode = require('qrcode');
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
  const webhookUrl = options.webhookUrl || 'http://anti-ban-middleware:3100/webhook/evolution';

  const payload = {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    webhook: {
      url: webhookUrl,
      webhookByEvents: false,
      events: [
        'qrcode.updated',
        'connection.update',
        'messages.upsert',
        'messages.update',
      ],
    },
  };

  // Numero do WhatsApp (opcional - pode ajudar geracao do QR em v2.2.3)
  if (options.number) {
    payload.number = options.number;
  }

  logger.info(`Criando instancia ${instanceName} - payload: ${JSON.stringify(payload)}`);

  const { data } = await api.post('/instance/create', payload);
  logger.info(`Instancia criada: ${instanceName} - resposta COMPLETA: ${JSON.stringify(data).substring(0, 2000)}`);
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
 * Tenta /instance/connect/ que na v2.2.3 dispara conexao.
 * O QR pode vir na resposta direta OU via webhook (qrcode.updated).
 */
async function getQrCode(instanceName) {
  try {
    // Etapa 1: Chama connect para disparar/manter a conexao
    const connectUrl = `/instance/connect/${instanceName}`;
    logger.info(`Chamando: GET ${config.evolution.url}${connectUrl}`);
    const res = await api.get(connectUrl);
    const data = res.data;
    logger.info(`QR connect RAW ${instanceName}: ${JSON.stringify(data).substring(0, 800)}`);

    // Verifica se ja esta conectado (varios formatos de resposta)
    const state = data.instance?.state || data.instance?.status || data.state || data.status;
    if (state === 'open') {
      return { base64: null, code: null, pairingCode: null, instance: data.instance || data };
    }

    // Extrai QR de qualquer formato (v2.x varia entre versoes)
    let base64 = data.base64 || data.qrcode?.base64 || null;
    let code = data.code || data.qrcode?.code || null;
    let pairingCode = data.pairingCode || data.qrcode?.pairingCode || null;

    // v2.2.3 pode retornar {"count":0} no connect - QR vem via webhook
    // Nesse caso, apenas logamos e retornamos null (webhook handler cuidara)
    if (!base64 && !code && data.count !== undefined) {
      logger.info(`Connect retornou count=${data.count} para ${instanceName} - QR sera entregue via webhook`);
    }

    // Se temos o texto do QR mas nao a imagem, geramos a imagem
    if (!base64 && code) {
      try {
        base64 = await QRCode.toDataURL(code, { width: 300, margin: 2 });
        logger.info(`QR gerado via qrcode lib para ${instanceName}`);
      } catch (qrErr) {
        logger.warn(`Falha ao gerar QR image: ${qrErr.message}`);
      }
    }

    logger.info(`QR connect PARSED ${instanceName}: base64=${base64 ? 'SIM' : 'NAO'}, code=${code ? 'SIM' : 'NAO'}, state=${state || 'N/A'}`);

    return {
      base64,
      code,
      pairingCode,
      instance: data.instance || null,
    };
  } catch (err) {
    logger.warn(`QR connect falhou ${instanceName}: ${err.response?.status} - ${err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : err.message}`);
    return { base64: null, pairingCode: null, code: null, instance: null };
  }
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
  const payload = {
    enabled: true,
    url: webhookUrl,
    webhookByEvents: false,
    events: events.length > 0 ? events : [
      'qrcode.updated',
      'connection.update',
      'messages.upsert',
      'messages.update',
    ],
  };

  logger.info(`Configurando webhook para ${instanceName}: ${JSON.stringify(payload)}`);

  try {
    const { data } = await api.post(`/webhook/set/${instanceName}`, payload);
    logger.info(`Webhook configurado para ${instanceName}: ${webhookUrl}`);
    return data;
  } catch (err) {
    // Tenta formato alternativo (v2.2.3 pode usar estrutura diferente)
    logger.warn(`Webhook set falhou (tentando formato alternativo): ${err.response?.status} - ${JSON.stringify(err.response?.data || {}).substring(0, 300)}`);
    try {
      const { data } = await api.put(`/webhook/set/${instanceName}`, payload);
      logger.info(`Webhook configurado via PUT para ${instanceName}: ${webhookUrl}`);
      return data;
    } catch (err2) {
      logger.warn(`Webhook set alternativo tambem falhou: ${err2.response?.status}`);
      throw err;
    }
  }
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
