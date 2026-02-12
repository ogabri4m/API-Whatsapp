/**
 * Servico de rotacao de proxy residencial brasileiro.
 *
 * Suporta providers: SmartProxy, BrightData, Oxylabs, ou proxy custom.
 * Cada instancia WhatsApp recebe um proxy unico para simular
 * usuarios em diferentes localizacoes do Brasil.
 */
const config = require('../config');
const logger = require('../utils/logger');

// Pool de proxies atribuidos a cada instancia
const instanceProxies = new Map();

/**
 * Gera configuracao de proxy baseado no provider configurado.
 * Para providers com IP rotativo, cada chamada gera uma sessao unica
 * que fixa o IP por um periodo (sticky session).
 */
function generateProxyConfig(instanceName) {
  const sessionId = `wa_${instanceName}_${Date.now()}`;

  switch (config.proxy.provider) {
    case 'smartproxy': {
      const { user, pass } = config.proxy.smartproxy;
      return {
        enabled: true,
        host: 'gate.smartproxy.com',
        port: '7000',
        protocol: 'http',
        username: `${user}-country-br-session-${sessionId}`,
        password: pass,
      };
    }

    case 'brightdata': {
      const { user, pass, zone } = config.proxy.brightdata;
      return {
        enabled: true,
        host: 'brd.superproxy.io',
        port: '22225',
        protocol: 'http',
        username: `${user}-zone-${zone}-country-br-session-${sessionId}`,
        password: pass,
      };
    }

    case 'oxylabs': {
      const { user, pass } = config.proxy.smartproxy; // reusa campos
      return {
        enabled: true,
        host: 'pr.oxylabs.io',
        port: '7777',
        protocol: 'http',
        username: `customer-${user}-cc-br-sessid-${sessionId}`,
        password: pass,
      };
    }

    case 'custom':
    default: {
      const { host, port, user, pass, protocol } = config.proxy.custom;
      if (!host) {
        logger.warn('Proxy custom nao configurado - instancia sem proxy');
        return { enabled: false };
      }
      return {
        enabled: true,
        host,
        port,
        protocol: protocol || 'http',
        username: user || '',
        password: pass || '',
      };
    }
  }
}

/**
 * Atribui um proxy a uma instancia e retorna a configuracao.
 */
function assignProxy(instanceName) {
  const proxyConfig = generateProxyConfig(instanceName);
  instanceProxies.set(instanceName, {
    config: proxyConfig,
    assignedAt: new Date(),
    rotationCount: 0,
  });

  logger.info(`Proxy atribuido a instancia ${instanceName}`, {
    provider: config.proxy.provider,
    enabled: proxyConfig.enabled,
  });

  return proxyConfig;
}

/**
 * Rotaciona o proxy de uma instancia (gera nova sessao/IP).
 */
function rotateProxy(instanceName) {
  const existing = instanceProxies.get(instanceName);
  const proxyConfig = generateProxyConfig(instanceName);

  instanceProxies.set(instanceName, {
    config: proxyConfig,
    assignedAt: new Date(),
    rotationCount: existing ? existing.rotationCount + 1 : 0,
  });

  logger.info(`Proxy rotacionado para instancia ${instanceName}`, {
    rotationCount: instanceProxies.get(instanceName).rotationCount,
  });

  return proxyConfig;
}

/**
 * Retorna o proxy atual de uma instancia.
 */
function getProxy(instanceName) {
  return instanceProxies.get(instanceName)?.config || null;
}

/**
 * Remove proxy de uma instancia.
 */
function removeProxy(instanceName) {
  instanceProxies.delete(instanceName);
}

/**
 * Lista todos os proxies atribuidos.
 */
function listProxies() {
  const result = {};
  for (const [name, data] of instanceProxies) {
    result[name] = {
      enabled: data.config.enabled,
      assignedAt: data.assignedAt,
      rotationCount: data.rotationCount,
    };
  }
  return result;
}

module.exports = {
  assignProxy,
  rotateProxy,
  getProxy,
  removeProxy,
  listProxies,
};
