/**
 * Servico Anti-Ban - Orquestrador principal de protecao.
 *
 * Gerencia:
 * - Warm-up de novas instancias (volume gradual)
 * - Limites diarios por instancia
 * - Horarios de envio permitidos
 * - Selecao inteligente de instancia para distribuir carga
 * - Rotacao de proxy quando necessario
 */
const config = require('../config');
const logger = require('../utils/logger');
const proxyService = require('./proxy.service');
const fingerprintService = require('./fingerprint.service');
const evolutionService = require('./evolution.service');

// Estado de cada instancia gerenciada
const instanceStates = new Map();

/**
 * Registra uma nova instancia no sistema anti-ban.
 */
function registerInstance(instanceName) {
  instanceStates.set(instanceName, {
    createdAt: new Date(),
    messagesSentToday: 0,
    totalMessagesSent: 0,
    lastMessageAt: null,
    lastResetDate: new Date().toDateString(),
    status: 'active',
    errors: 0,
  });

  logger.info(`Instancia registrada no anti-ban: ${instanceName}`);
}

/**
 * Remove instancia do sistema anti-ban.
 */
function unregisterInstance(instanceName) {
  instanceStates.delete(instanceName);
  proxyService.removeProxy(instanceName);
  fingerprintService.removeFingerprint(instanceName);
}

/**
 * Verifica se uma instancia esta em periodo de warm-up.
 */
function isInWarmup(instanceName) {
  const state = instanceStates.get(instanceName);
  if (!state) return false;

  const hoursAlive = (Date.now() - state.createdAt.getTime()) / (1000 * 60 * 60);
  return hoursAlive < config.antiban.warmupHours;
}

/**
 * Retorna o limite diario de uma instancia (menor durante warm-up).
 */
function getDailyLimit(instanceName) {
  if (isInWarmup(instanceName)) {
    const state = instanceStates.get(instanceName);
    const hoursAlive = (Date.now() - state.createdAt.getTime()) / (1000 * 60 * 60);
    // Escala linear durante warm-up
    const progress = hoursAlive / config.antiban.warmupHours;
    const minLimit = config.antiban.warmupDailyLimit;
    const maxLimit = config.antiban.dailyLimit;
    return Math.floor(minLimit + progress * (maxLimit - minLimit));
  }
  return config.antiban.dailyLimit;
}

/**
 * Reseta contadores diarios se necessario.
 */
function resetDailyCounters(instanceName) {
  const state = instanceStates.get(instanceName);
  if (!state) return;

  const today = new Date().toDateString();
  if (state.lastResetDate !== today) {
    state.messagesSentToday = 0;
    state.lastResetDate = today;
  }
}

/**
 * Verifica se estamos dentro do horario de envio permitido.
 */
function isWithinSendingHours() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= config.antiban.sendHourStart && hour < config.antiban.sendHourEnd;
}

/**
 * Verifica se uma instancia pode enviar mensagem agora.
 */
function canSend(instanceName) {
  const state = instanceStates.get(instanceName);
  if (!state) return { allowed: false, reason: 'Instancia nao registrada' };
  if (state.status !== 'active') return { allowed: false, reason: `Instancia ${state.status}` };

  resetDailyCounters(instanceName);

  if (!isWithinSendingHours()) {
    return {
      allowed: false,
      reason: `Fora do horario de envio (${config.antiban.sendHourStart}h-${config.antiban.sendHourEnd}h)`,
    };
  }

  const limit = getDailyLimit(instanceName);
  if (state.messagesSentToday >= limit) {
    return {
      allowed: false,
      reason: `Limite diario atingido (${state.messagesSentToday}/${limit})`,
    };
  }

  return { allowed: true };
}

/**
 * Registra que uma mensagem foi enviada por uma instancia.
 */
function recordMessageSent(instanceName) {
  const state = instanceStates.get(instanceName);
  if (!state) return;

  resetDailyCounters(instanceName);
  state.messagesSentToday++;
  state.totalMessagesSent++;
  state.lastMessageAt = new Date();
}

/**
 * Registra um erro em uma instancia.
 * Se muitos erros, marca como pausada.
 */
function recordError(instanceName) {
  const state = instanceStates.get(instanceName);
  if (!state) return;

  state.errors++;

  if (state.errors >= 5) {
    state.status = 'paused';
    logger.warn(`Instancia ${instanceName} pausada por excesso de erros (${state.errors})`);
  }
}

/**
 * Seleciona a melhor instancia para enviar uma mensagem.
 * Criterios:
 * 1. Deve poder enviar (canSend)
 * 2. Prefere instancias com menos mensagens enviadas hoje
 * 3. Prefere instancias que nao enviaram recentemente (intervalo)
 */
function selectBestInstance() {
  let bestInstance = null;
  let bestScore = -Infinity;

  for (const [name, state] of instanceStates) {
    const check = canSend(name);
    if (!check.allowed) continue;

    const limit = getDailyLimit(name);
    const usageRatio = 1 - (state.messagesSentToday / limit);

    // Bonus para instancias que nao enviaram recentemente
    const timeSinceLastMsg = state.lastMessageAt
      ? (Date.now() - state.lastMessageAt.getTime()) / 1000
      : 999;
    const recentBonus = Math.min(timeSinceLastMsg / 60, 1); // normaliza a 1 min

    const score = usageRatio * 0.6 + recentBonus * 0.4;

    if (score > bestScore) {
      bestScore = score;
      bestInstance = name;
    }
  }

  return bestInstance;
}

/**
 * Retorna status de todas as instancias gerenciadas.
 */
function getStatus() {
  const result = {};
  for (const [name, state] of instanceStates) {
    resetDailyCounters(name);
    const limit = getDailyLimit(name);
    result[name] = {
      status: state.status,
      isWarmup: isInWarmup(name),
      messagesSentToday: state.messagesSentToday,
      dailyLimit: limit,
      totalMessagesSent: state.totalMessagesSent,
      lastMessageAt: state.lastMessageAt,
      errors: state.errors,
      proxy: proxyService.getProxy(name) ? 'configured' : 'none',
      fingerprint: fingerprintService.getFingerprint(name)?.id || 'none',
    };
  }
  return result;
}

/**
 * Reativa uma instancia pausada.
 */
function reactivateInstance(instanceName) {
  const state = instanceStates.get(instanceName);
  if (!state) return false;

  state.status = 'active';
  state.errors = 0;
  logger.info(`Instancia reativada: ${instanceName}`);
  return true;
}

/**
 * Rotaciona proxy de uma instancia e aplica via Evolution API.
 */
async function rotateInstanceProxy(instanceName) {
  const newProxy = proxyService.rotateProxy(instanceName);
  if (newProxy.enabled) {
    await evolutionService.setProxy(instanceName, newProxy);
  }
  return newProxy;
}

module.exports = {
  registerInstance,
  unregisterInstance,
  isInWarmup,
  getDailyLimit,
  isWithinSendingHours,
  canSend,
  recordMessageSent,
  recordError,
  selectBestInstance,
  getStatus,
  reactivateInstance,
  rotateInstanceProxy,
};
