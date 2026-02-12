/**
 * Gera delays humanizados usando distribuicao gaussiana.
 * Evita padroes previsiveis que o WhatsApp detecta.
 */

/**
 * Gera um numero aleatorio com distribuicao gaussiana (Box-Muller).
 * Retorna valor entre min e max, concentrado no meio.
 */
function gaussianRandom(min, max) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  // Normaliza para 0-1
  num = (num + 3) / 6;
  num = Math.max(0, Math.min(1, num));

  return Math.floor(min + num * (max - min));
}

/**
 * Delay entre mensagens individuais.
 * Simula o tempo que um humano leva para copiar/colar e enviar.
 */
function messageDelay(min = 3000, max = 12000) {
  return gaussianRandom(min, max);
}

/**
 * Delay entre lotes de mensagens.
 * Simula pausas naturais (ir ao banheiro, tomar cafe, etc).
 */
function batchDelay(min = 30000, max = 120000) {
  return gaussianRandom(min, max);
}

/**
 * Delay de "digitacao" antes de enviar.
 * Simula o tempo de composicao da mensagem.
 */
function typingDelay() {
  return gaussianRandom(800, 3500);
}

/**
 * Adiciona variacao aleatoria a uma string de mensagem.
 * Insere espacos invisíveis ou variações mínimas para evitar deteccao de mensagem identica.
 */
function addMessageVariation(text) {
  const variations = [
    () => text,
    () => text + ' ',
    () => ' ' + text,
    () => text.replace(/\./g, (m, i) => (Math.random() > 0.7 ? '..' : m)),
  ];

  const fn = variations[Math.floor(Math.random() * variations.length)];
  return fn();
}

/**
 * Promise de sleep com delay humanizado.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  gaussianRandom,
  messageDelay,
  batchDelay,
  typingDelay,
  addMessageVariation,
  sleep,
};
