/**
 * Servico de geracao de fingerprints de navegador aleatorios.
 *
 * Cada instancia WhatsApp recebe um fingerprint unico que simula
 * um navegador real em um dispositivo real.
 *
 * O WhatsApp Web (Baileys) envia informacoes de browser ao conectar.
 * Este servico gera combinacoes realistas de browser/OS/versao.
 */
const logger = require('../utils/logger');

// Navegadores e versoes realistas
const BROWSERS = [
  { name: 'Chrome', versions: ['120.0.6099', '121.0.6167', '122.0.6261', '123.0.6312', '124.0.6367', '125.0.6422'] },
  { name: 'Edge', versions: ['120.0.2210', '121.0.2277', '122.0.2365', '123.0.2420', '124.0.2478'] },
  { name: 'Safari', versions: ['17.2', '17.3', '17.4', '17.5'] },
  { name: 'Firefox', versions: ['122.0', '123.0', '124.0', '125.0'] },
];

// Sistemas operacionais
const OS_LIST = [
  { name: 'Windows', versions: ['10.0', '11.0'] },
  { name: 'macOS', versions: ['13.0', '13.6', '14.0', '14.2', '14.4'] },
  { name: 'Linux', versions: ['x86_64'] },
];

// User-Agent templates
const UA_TEMPLATES = {
  'Chrome-Windows': (bv, ov) =>
    `Mozilla/5.0 (Windows NT ${ov}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${bv} Safari/537.36`,
  'Chrome-macOS': (bv, ov) =>
    `Mozilla/5.0 (Macintosh; Intel Mac OS X ${ov.replace(/\./g, '_')}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${bv} Safari/537.36`,
  'Chrome-Linux': (bv) =>
    `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${bv} Safari/537.36`,
  'Edge-Windows': (bv, ov) =>
    `Mozilla/5.0 (Windows NT ${ov}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${bv} Safari/537.36 Edg/${bv}`,
  'Safari-macOS': (bv, ov) =>
    `Mozilla/5.0 (Macintosh; Intel Mac OS X ${ov.replace(/\./g, '_')}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${bv} Safari/605.1.15`,
  'Firefox-Windows': (bv, ov) =>
    `Mozilla/5.0 (Windows NT ${ov}; Win64; x64; rv:${bv}) Gecko/20100101 Firefox/${bv}`,
  'Firefox-Linux': (bv) =>
    `Mozilla/5.0 (X11; Linux x86_64; rv:${bv}) Gecko/20100101 Firefox/${bv}`,
};

// Resolucoes de tela comuns no Brasil
const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
];

// Idiomas
const LANGUAGES = [
  'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'pt-BR,pt;q=0.9,en;q=0.8',
  'pt-BR,en-US;q=0.9,en;q=0.8',
  'pt-BR,pt;q=0.8,en-US;q=0.6',
];

// Timezones brasileiras
const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Manaus',
  'America/Recife',
  'America/Bahia',
  'America/Cuiaba',
];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Gera um fingerprint completo de navegador.
 * Retorna objeto com todas as propriedades necessarias.
 */
function generateFingerprint() {
  const browser = randomElement(BROWSERS);
  const browserVersion = randomElement(browser.versions);
  const os = randomElement(OS_LIST);
  const osVersion = randomElement(os.versions);
  const screen = randomElement(SCREEN_RESOLUTIONS);

  // Constroi User-Agent
  const uaKey = `${browser.name}-${os.name}`;
  const uaFn = UA_TEMPLATES[uaKey];
  let userAgent;
  if (uaFn) {
    userAgent = uaFn(browserVersion, osVersion);
  } else {
    // Fallback para Chrome Windows
    userAgent = UA_TEMPLATES['Chrome-Windows'](browserVersion, '10.0');
  }

  // Browser identifier para Baileys [browser, os, browserVersion]
  // Baileys espera: ['Nome', 'NomeOS', 'VersaoBrowser']
  const baileysBrowser = [
    browser.name === 'Edge' ? 'Microsoft Edge' : browser.name,
    os.name,
    browserVersion,
  ];

  return {
    id: `fp_${Date.now()}_${randomInt(1000, 9999)}`,
    browser: browser.name,
    browserVersion,
    os: os.name,
    osVersion,
    userAgent,
    baileysBrowser,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: randomElement([24, 32]),
      pixelRatio: randomElement([1, 1.25, 1.5, 2]),
    },
    language: randomElement(LANGUAGES),
    timezone: randomElement(TIMEZONES),
    hardwareConcurrency: randomElement([2, 4, 6, 8, 12, 16]),
    deviceMemory: randomElement([2, 4, 8, 16]),
    platform: os.name === 'Windows' ? 'Win32' : os.name === 'macOS' ? 'MacIntel' : 'Linux x86_64',
    webglVendor: randomElement([
      'Google Inc. (NVIDIA)',
      'Google Inc. (Intel)',
      'Google Inc. (AMD)',
      'Intel Inc.',
    ]),
    webglRenderer: randomElement([
      'ANGLE (NVIDIA GeForce GTX 1060)',
      'ANGLE (Intel HD Graphics 630)',
      'ANGLE (AMD Radeon RX 580)',
      'ANGLE (NVIDIA GeForce RTX 3060)',
      'ANGLE (Intel UHD Graphics 620)',
    ]),
  };
}

// Cache de fingerprints por instancia
const instanceFingerprints = new Map();

/**
 * Gera e armazena fingerprint para uma instancia.
 */
function assignFingerprint(instanceName) {
  const fp = generateFingerprint();
  instanceFingerprints.set(instanceName, fp);

  logger.info(`Fingerprint atribuido a instancia ${instanceName}`, {
    browser: fp.browser,
    os: fp.os,
    id: fp.id,
  });

  return fp;
}

/**
 * Retorna fingerprint de uma instancia.
 */
function getFingerprint(instanceName) {
  return instanceFingerprints.get(instanceName) || null;
}

/**
 * Remove fingerprint de uma instancia.
 */
function removeFingerprint(instanceName) {
  instanceFingerprints.delete(instanceName);
}

/**
 * Lista todos os fingerprints atribuidos.
 */
function listFingerprints() {
  const result = {};
  for (const [name, fp] of instanceFingerprints) {
    result[name] = {
      id: fp.id,
      browser: `${fp.browser} ${fp.browserVersion}`,
      os: `${fp.os} ${fp.osVersion}`,
      screen: `${fp.screen.width}x${fp.screen.height}`,
      timezone: fp.timezone,
    };
  }
  return result;
}

module.exports = {
  generateFingerprint,
  assignFingerprint,
  getFingerprint,
  removeFingerprint,
  listFingerprints,
};
