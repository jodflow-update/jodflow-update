// ບ່ອນດຽວທີ່ຕັດສິນ port CDP ຂອງ Chrome ບັອດ — worker.js ແລະ hero.js ຕ້ອງໃຊ້ອັນນີ້
// ທັງຄູ່. ເມື່ອກ່ອນ worker ອ່ານ config.json (cdpPort) ແຕ່ hero ອ່ານ env ຄົນລະຊື່
// ແລ້ວຍຶດ 9222 ຕາຍຕົວ — ພໍປ່ຽນ port ແກ້ບັນຫາ port ຊົນ ຊັອດ 12 ກໍພັງຢ່າງດຽວ.
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 9222;

function dataDir() {
  return process.env.JODFLOW_DATA || process.env.FLOWBOT_DATA || path.join(__dirname, '..', 'data');
}

function portFile() {
  return path.join(dataDir(), 'cdp-port.txt');
}

function configPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    return Number(cfg.cdpPort) || 0;
  } catch { return 0; }
}

// ລຳດັບຄວາມສຳຄັນ: env ທີ່ຜູ້ໃຊ້ຕັ້ງ → port ທີ່ຮອບກ່ອນເລືອກໄວ້ → config.json → 9222
// ຕ້ອງຈື່ port ທີ່ເລືອກລົງໄຟລ໌ ເພາະແຕ່ລະຄັ້ງທີ່ແລ່ນ worker ເປັນ process ໃໝ່
// ແລະ hero.js ກໍເປັນອີກ process ໜຶ່ງ — ສອງຝ່າຍຕ້ອງຊີ້ Chrome ໜ່ວຍດຽວກັນ.
function resolveCdpPort() {
  const fromEnv = Number(process.env.JODFLOW_CDP_PORT) || 0;
  if (fromEnv) return fromEnv;
  try {
    const saved = Number(String(fs.readFileSync(portFile(), 'utf8')).trim());
    if (saved) return saved;
  } catch { /* ຍັງບໍ່ເຄີຍບັນທຶກ */ }
  return configPort() || DEFAULT_PORT;
}

function saveCdpPort(port) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(portFile(), String(port));
  } catch { /* ຈື່ບໍ່ໄດ້ກໍຍັງແລ່ນໄດ້ ພຽງແຕ່ຮອບໜ້າຕ້ອງຫາໃໝ່ */ }
}

module.exports = { resolveCdpPort, saveCdpPort, DEFAULT_PORT };
