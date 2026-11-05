// JOD FLOW — worker: ຄຸມ Chrome ຂອງບອດຜ່ານ CDP, ຕໍ່ Flow ແລະ AI, ສົ່ງ prompt, ອ່ານຜົນ
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const { copyWithRetry, downloadsDir, findAutomationBrowser, ownedChromeProcess, samePath, terminateProcessTree } = require('./platform.js');

const sel = JSON.parse(fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf8'));
// Do not append `>> visible=true` to a comma-separated selector list.  Playwright
// applies that trailing engine only to the final selector branch, which made a
// real Settings trigger appear absent.  Each caller already verifies visibility
// before clicking or filling the selected element.
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
// ຕ້ອງຄຳນວນບ່ອນເກັບຂໍ້ມູນໃຫ້ຄືກັນກັບ server.js ແບບເປະໆ. ເມື່ອກ່ອນ worker ຕົກມາ
// __dirname ແຕ່ server ຕົກມາ <app>/../data — ຖ້າຕົວເປີດບໍ່ຕັ້ງ env (ເຊັ່ນຕົວເປີດ
// Windows ທີ່ຕັ້ງຊື່ FLOWBOT_DATA ຄົນລະຊື່) ສອງຝ່າຍຈະໃຊ້ຄົນລະໂຟນເດີ ແລ້ວໄຟລ໌ທີ່
// worker ຂຽນ (sb-sheet, storyboard-assets.json) server ຈະຫາບໍ່ພົບ.
const DATA = process.env.JODFLOW_DATA || process.env.FLOWBOT_DATA || path.join(__dirname, '..', 'data');
const profileDir = path.join(DATA, 'chrome-profile');
const { resolveCdpPort, saveCdpPort } = require('./cdp-port.js');
let PORT = resolveCdpPort();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sendEv = (tag, data) => console.log(`@@${tag} ${typeof data === 'string' ? data : JSON.stringify(data)}`);

async function probe(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return 'other';
    const j = await r.json().catch(() => ({}));
    return j && j.webSocketDebuggerUrl ? 'chrome' : 'other';
  } catch (e) { return /abort|timeout/i.test(String(e && e.message || e)) ? 'other' : 'free'; }
}

async function chromeIsUp() { return (await probe(PORT)) === 'chrome'; }

// ຖ້າ port ທີ່ຕັ້ງໄວ້ຖືກແອັບອື່ນຢຶດ (ບໍ່ແມ່ນ Chrome ຂອງບັອດ) ເມື່ອກ່ອນບັອດຈະເປີດ
// Chrome ທີ່ຜູກ port ບໍ່ໄດ້ ແລ້ວລໍ 30 ວິ ຈຶ່ງຂຶ້ນ "Chrome ບໍ່ຕອບສະໜອງ" ເຊິ່ງຊີ້ຜິດທາງ.
// ດຽວນີ້ຫາ port ວ່າງໃຫ້ເອງ ແລ້ວຈື່ໄວ້ໃຫ້ຮອບຕໍ່ໄປ ແລະ hero.js ໃຊ້ນຳ.
async function pickUsablePort() {
  const tried = [];
  for (let port = PORT; port < PORT + 20; port++) {
    const state = await probe(port);
    tried.push(`${port}:${state}`);
    if (state === 'chrome') return { port, reuse: true };
    if (state === 'free') return { port, reuse: false };
  }
  throw new Error('ຫາ port ວ່າງສຳລັບ Chrome ບໍ່ໄດ້ — ລອງປິດແອັບທີ່ຢຶດ port ' + tried.join(' '));
}

async function ensureChrome(openUrl) {
  if (await chromeIsUp()) {
    // A previously launched JOD FLOW Chrome keeps running without newly added
    // command-line flags. Recycle only the process that owns this exact CDP
    // port and bot profile so the next launch actually receives --incognito.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const owned = ownedChromeProcess(PORT, profileDir);
      if (!owned) throw new Error(`port ${PORT} ມີ Chrome ທີ່ບໍ່ແມ່ນ profile ຂອງ JOD FLOW`);
      if (!/(?:^|\s)--incognito(?:\s|$)/.test(owned.commandLine)) {
        const pid = owned.pid;
        if (pid && pid !== process.pid) {
          log('ປິດ Chrome ເກົ່າຂອງ JOD FLOW ເພື່ອເປີດໃໝ່ດ້ວຍ Incognito');
          terminateProcessTree(pid, false);
          for (let i = 0; i < 10 && await chromeIsUp(); i++) await sleep(500);
          if (await chromeIsUp()) {
            terminateProcessTree(pid, true);
            for (let i = 0; i < 10 && await chromeIsUp(); i++) await sleep(300);
          }
          if (await chromeIsUp()) throw new Error('ປິດ Chrome ເກົ່າຂອງ JOD FLOW ບໍ່ໄດ້');
        } else return;
      } else return;
    } else return;
  }
  const browser = findAutomationBrowser();
  if (!browser) throw new Error('ບໍ່ພົບ Google Chrome ຫຼື Microsoft Edge — ຕິດຕັ້ງໜຶ່ງໃນນັ້ນກ່ອນ');
  const chosen = await pickUsablePort();
  if (chosen.port !== PORT) log(`port ${PORT} ຖືກແອັບອື່ນຢຶດ — ປ່ຽນໄປໃຊ້ ${chosen.port}`);
  PORT = chosen.port;
  saveCdpPort(PORT);
  if (chosen.reuse) return;
  fs.mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(browser.path, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--incognito',
    '--no-first-run', '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    // Chrome ໂຫຼດໂມເດວ AI ໃນເຄື່ອງ (Gemini Nano) ແລະ component ຕ່າງໆ ລົງ profile
    // ຂອງບັອດ ເຮັດໃຫ້ມັນໃຫຍ່ຮອດ 4 GB ທັງທີ່ບັອດບໍ່ເຄີຍໃຊ້ — ມັນພຽງແຕ່ຄຸມໜ້າເວັບ.
    // ປິດຖິ້ມເພື່ອບໍ່ໃຫ້ກິນດິສຜູ້ໃຊ້ໂດຍບໍ່ມີປະໂຫຍດ.
    '--disable-features=OptimizationGuideOnDeviceModel,OptimizationHints,TextSafetyClassifier',
    '--disable-component-update',
    openUrl || sel.url,
  ], { detached: true, stdio: 'ignore' });
  log(`ເປີດ ${browser.name} ສຳລັບບັອດ`);
  try { fs.writeFileSync(path.join(DATA, 'chrome-pid.json'), JSON.stringify({ pid: chrome.pid, port: PORT, profileDir, startedAt: Date.now() }, null, 2)); } catch {}
  chrome.unref();
  for (let i = 0; i < 30; i++) { if (await chromeIsUp()) return; await sleep(1000); }
  throw new Error('Chrome ຂອງບອດບໍ່ຕອບສະໜອງ');
}

async function connect() {
  await ensureChrome();
  return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
}

function listFlowPages(browser) {
  const out = [];
  for (const ctx of browser.contexts()) {
    for (const pg of ctx.pages()) {
      if (/flow\.google\.com/.test(pg.url())) out.push(pg);
    }
  }
  return out;
}

// ນັບຮູບທີ່ Flow ສ້າງຈິງ — ຮູບທີ່ສ້າງຢູ່ host ai-sandbox-videofx,
// ສ່ວນຮູບທີ່ເຮົາອັບໂຫຼດເອງຢູ່ flow-content.google (ບໍ່ນັບ)
async function countGeneratedImages(pg) {
  // Flow ວາງຮູບໃນ gallery ທີ່ host flow.google.com/asb/ :
  //   ຮູບທີ່ສ້າງ = 9:16 (ເຊັ່ນ 288x512)   ຮູບທີ່ເຮົາອັບໂຫຼດເອງ = 3:4 (2400x3200)
  // ຈຶ່ງກອງດ້ວຍສັດສ່ວນ ບໍ່ແມ່ນ host ຢ່າງດຽວ
  return (await snapshotAssets(pg)).length;
}

// ເກັບ "ຊຸດ URL" ຮູບໃນ gallery — ອ່ານຈາກ attribute ຢ່າງດຽວ ບໍ່ຕ້ອງໃຫ້ Chrome decode ຮູບ
// ຈຶ່ງໃຊ້ໄດ້ກັບແທັບທີ່ຢູ່ຂ້າງຫຼັງ (naturalWidth ຈະເປັນ 0 ສະເໝີໃນແທັບນັ້ນ)
// ຫ້າມກອງດ້ວຍ host: Flow ໃຊ້ທັງ flow-content.google ແລະ flow.google.com/asb/
// ແຍກດ້ວຍ "ສັດສ່ວນ" ແທນ — ແຜ່ນທີ່ສ້າງ = 9:16 (0.56), ຮູບທີ່ເຮົາອັບ = 3:4 (0.75), ໄອຄອນ = 1:1
async function snapshotAssets(pg) {
  return await pg.evaluate(() => {
    const out = new Set();
    // Flow ມີ <flow-grid-tile-container aria-label="..."> ຫໍ່ແຕ່ລະ <img>.
    // ຊີ້ນ Flow ສ້າງ (storyboard sheet/video) ໄດ້ aria-label ເປັນຄຳບັນຍາຍ
    // ປະໂຫຍກ (ຕົວຢ່າງ "SD Plus storyboard sheet"); ແຕ່ຮູບສິນຄ້າທີ່ບັອດອັບໂຫລດ
    // ເອງເປັນ ingredient ຈະໄດ້ aria-label ເປັນຊື່ໄຟລ໌ຕົງໆ (ຕົວຢ່າງ "product-ref.jpg")
    // — ບໍ່ແມ່ນຮູບ output. ຕ້ອງຍົກເວັ້ນ ບໍ່ດັ່ງນັ້ນບັອດຈະເກັບຮູບສິນຄ້າເອງມາແທນ
    // ຮູບ storyboard ທີ່ Flow ຫາກໍສ້າງ.
    const looksLikeFilename = s => /\.(jpe?g|png|webp|gif|heic)$/i.test(String(s || '').trim());
    for (const i of Array.from(document.querySelectorAll('img'))) {
      const src = (i.getAttribute('src') || i.currentSrc || '').split('?')[0];
      if (!src || src.startsWith('data:')) continue;
      let w = i.naturalWidth, h = i.naturalHeight;
      if (!w || !h) { const r = i.getBoundingClientRect(); w = r.width; h = r.height; }
      if (!w || !h || h < 150) continue;
      const ratio = w / h;
      if (!(ratio > 0.52 && ratio < 0.60)) continue;
      const tile = i.closest('flow-grid-tile-container, [aria-label]');
      const tileLabel = tile && tile.getAttribute ? tile.getAttribute('aria-label') : '';
      if (looksLikeFilename(tileLabel)) continue;
      out.add(src);
    }
    return [...out];
  }).catch(() => []);
}

// ລໍໃຫ້ຮູບໃນໜ້າໂຫຼດຄົບກ່ອນຈຶ່ງຈື່ເປັນຈຸດຕັ້ງຕົ້ນ
// ບໍ່ດັ່ງນັ້ນຮູບເກົ່າທີ່ຫາກໍໂຫຼດຂຶ້ນຈະຖືກນັບເປັນ "ຮູບໃໝ່" ແລ້ວແຈ້ງສຳເລັດທັງທີ່ຍັງບໍ່ທັນສ້າງ
async function settledSnapshot(pg, tries = 8) {
  let prev = await snapshotAssets(pg);
  for (let i = 0; i < tries; i++) {
    await sleep(1500);
    const now = await snapshotAssets(pg);
    if (now.length === prev.length) return now;
    prev = now;
  }
  return prev;
}


// ໜ້າ flow.google.com/ ເປົ່າບໍ່ມີ editor — ຕ້ອງເປັນ URL ຂອງ project
function flowProjectUrl(pages) {
  for (const pg of pages) {
    const u = pg.url();
    if (/flow\.google\.com\/project\//.test(u)) return u;
  }
  return null;
}

function flowProjectBase(url) {
  const m = String(url || '').match(/^(https:\/\/flow\.google\.com\/project\/[^/?#]+)/i);
  return m ? m[1] : '';
}

// Select the exact project used by the storyboard stage. Never fall back to a
// blank Flow home tab when a locked project URL is available.
async function findLockedFlowPage(browser, lockUrl) {
  const lockedBase = flowProjectBase(lockUrl);
  if (!lockedBase) return null;
  const pages = listFlowPages(browser);
  let pg = pages.find(p => flowProjectBase(p.url()) === lockedBase) || pages[0] || null;
  if (!pg) pg = await newFlowTab(browser, lockedBase);
  if (flowProjectBase(pg.url()) !== lockedBase) {
    log(`ພາແທັບ Flow ກັບ project ເດີມ: ${lockedBase}`);
    await pg.goto(lockedBase, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await forceDesktopViewport(pg);
  await pg.locator(sel.promptBox).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
  return flowProjectBase(pg.url()) === lockedBase ? pg : null;
}

// ບັງຄັບໃຫ້ໜ້າ Flow ຄິດວ່າຕົນກວ້າງ 1440 ສະເໝີ ບໍ່ວ່າໜ້າຕ່າງ Chrome ຈະຖືກຍໍ່
// ແຄບ (ແບ່ງຈໍ) ສຳໃດ. ຖ້າບໍ່ມີ Flow ຈະສະຫຼັບໄປ layout ແຄບ ແລ້ວປຸ່ມ/ອົງປະກອບ
// ຍ້າຍບ່ອນ ເຮັດໃຫ້ selector ຂອງບັອດບໍ່ຕົງ ແລະ ຂຶ້ນ error. ໃຊ້ CDP Emulation
// ເພາະ setViewportSize ຂອງ Playwright ບໍ່ໝັ້ນຄົງກັບ Chrome ທີ່ connectOverCDP.
async function forceDesktopViewport(pg) {
  if (!pg) return;
  try {
    const cdp = await pg.context().newCDPSession(pg);
    // ອ່ານຂະໜາດຈິງຂອງໜ້າຕ່າງກ່ອນ (ລ້າງ override ເກົ່າກ່ອນ ບໍ່ດັ່ງນັ້ນຈະອ່ານໄດ້ຄ່າທີ່ຕັ້ງໄວ້ຮອບກ່ອນ)
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    const real = await pg.evaluate(() => ({ w: window.innerWidth || 1280, h: window.innerHeight || 800 }));
    // ບັງຄັບ Flow ໃຫ້ຢູ່ layout desktop (ກວ້າງ ≥1280) ແຕ່ "ຍໍ່" ດ້ວຍ deviceScaleFactor
    // ໃຫ້ render ພໍດີໜ້າຕ່າງຈິງ — ແບ່ງຄຶ່ງຈໍກໍເຫັນໝົດ ແລະ selector ຍັງຕົງ.
    // ໜ້າຕ່າງກວ້າງ ≥1280 ໃຊ້ຂະໜາດຈິງ (dsf=1) ບໍ່ຍໍ່.
    const targetW = Math.max(1280, real.w);
    const dsf = real.w / targetW;                       // ≤1 : <1 = ຍໍ່ລົງພໍດີ
    const height = Math.round(real.h / dsf);            // ໃຫ້ຄວາມສູງ render ພໍດີໜ້າຕ່າງນຳ
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: targetW, height, deviceScaleFactor: dsf, mobile: false,
      screenWidth: targetW, screenHeight: height,
    });
  } catch { /* ຕັ້ງ viewport ບໍ່ໄດ້ກໍບໍ່ແມ່ນເລື່ອງຮ້າຍແຮງ */ }
}

async function newFlowTab(browser, url) {
  const ctx = browser.contexts()[0] || await browser.newContext();
  const pg = await ctx.newPage();
  await forceDesktopViewport(pg);
  await pg.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  // Flow ເປັນ SPA — ລໍຖ້າ prompt box ປະກົດກ່ອນຈຶ່ງຖືວ່າພ້ອມ
  await pg.locator(sel.promptBox).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
  return pg;
}

// slot = ແທັບ Flow ອັນທີ່ເທົ່າໃດ (0,1,2...) — ໃຫ້ worker ແຕ່ລະຕົວມີແທັບຂອງຕົນ ບໍ່ທັບກັນ
async function findFlowPage(browser, slot = 0, lockUrl = '') {
  let pages = listFlowPages(browser);
  // A split window, a manually opened Flow home page, or a scene editor can
  // leave several Flow tabs alive.  When the caller supplies a project lock,
  // the first tab in Chrome is not authoritative: always recover/select the
  // exact project first.  This keeps automation independent from window/tab
  // layout and prevents work being sent to Flow home.
  if (lockUrl) {
    const locked = await findLockedFlowPage(browser, lockUrl);
    if (locked) return locked;   // forceDesktopViewport ຖືກເອີ້ນຢູ່ໃນນັ້ນແລ້ວ
  }
  if (pages[slot]) { await forceDesktopViewport(pages[slot]); return pages[slot]; }
  const url = (lockUrl && lockUrl.split('?')[0]) || flowProjectUrl(pages) || 'https://flow.google.com/';
  let guard = 0;
  while (pages.length <= slot && guard++ < 10) {
    await newFlowTab(browser, url);
    pages = listFlowPages(browser);
  }
  const pg = pages[slot] || pages[pages.length - 1];
  await forceDesktopViewport(pg);
  return pg;
}

// A Flow project may reopen with the session composer collapsed.  In that
// state the prompt is visible only after a new session is started, while the
// settings trigger stays hidden.  Recover before any settings/upload work.
async function ensureFlowComposer(pg) {
  const box = pg.locator(sel.promptBox).first();
  if (await box.isVisible({ timeout: 1200 }).catch(() => false)) return true;
  const start = pg.locator('button[aria-label="เริ่มเซสชันใหม่"], button[aria-label="Start new session"]').first();
  if (!(await start.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await start.evaluate(el => el.click()).catch(() => {});
  return await box.isVisible({ timeout: 15000 }).catch(() => false);
}

// ສ້າງແທັບ Flow ໃຫ້ຄົບ N ອັນກ່ອນ (ແລ່ນຕົວດຽວ ບໍ່ແຂ່ງກັນ)
async function cmdPrepTabs() {
  const want = Number(process.argv[3] || 1);
  const b = await connect();
  const pages = listFlowPages(b);
  const url = flowProjectUrl(pages);
  if (!url) {
    log('ຜິດພາດ: ບໍ່ພົບແທັບ Flow ທີ່ເປີດ project ຢູ່ — ເປີດ project ໃນ Flow ກ່ອນ (flow.google.com/project/...)');
    sendEv('NO_PROJECT', {});
    await b.close();
    process.exit(2);
  }
  // ແທັບ Flow ທີ່ຍັງຄ້າງຢູ່ໜ້າເປົ່າ — ພາໄປທີ່ project ດຽວກັນ
  for (const pg of pages) {
    if (!/flow\.google\.com\/project\//.test(pg.url())) {
      log('ພາແທັບເປົ່າໄປທີ່ project');
      await pg.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await pg.locator(sel.promptBox).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
    }
  }
  for (let i = 0; i < want; i++) await findFlowPage(b, i);
  // One project run must have one authoritative Flow tab.  Worker processes
  // reconnect through CDP and page order is not stable, so duplicate Flow
  // tabs caused image/video jobs to land in a different tab.  Keep the first
  // project tab and close only the other Flow tabs; AI tabs are untouched.
  const flowPages = listFlowPages(b);
  const first = flowPages[0];
  for (const extra of flowPages.slice(1)) {
    log('ປິດ Flow ແທັບຊ້ຳ ເພື່ອລັອກໃຊ້ແທັບຫຼັກອັນດຽວ');
    await extra.close().catch(() => {});
  }
  const n = 1;
  await first.bringToFront().catch(() => {});
  await sleep(2500);
  const baseline = await countGeneratedImages(first);
  log(`ແທັບ Flow ພ້ອມ ${n} ອັນ (project ດຽວກັນ) — ຮູບທີ່ມີຢູ່ແລ້ວ ${baseline}`);
  sendEv('TABS_READY', { tabs: n, baseline, projectUrl: url });
  await b.close();
}

// ປິດ project ປັດຈຸບັນ (ກັບໜ້າ home) ແລ້ວສ້າງ project ໃໝ່ — ໃຊ້ຫຼັງດາວໂຫຼດຈົບ
// ເພື່ອໃຫ້ຮອບຕໍ່ໄປເລີ່ມໃນ project ສະອາດ ໂດຍບໍ່ຕ້ອງໃຫ້ຜູ້ໃຊ້ມາເປີດເອງ.
//
// ວິທີທີ່ Flow ໃຫ້ (ກວດ DOM ຈິງແລ້ວ): ໃນ project ມີປຸ່ມ home aria-label="หน้าแรก"
// → ກັບໜ້າ home → ປຸ່ມ button.new-project-button ສ້າງ project ໃໝ່ → URL ປ່ຽນເປັນ
// /project/<id> ໃໝ່ ແລະ ຊ່ອງພິມ prompt ພ້ອມໃຊ້ທັນທີ.
async function cmdNewProject() {
  const prevUrl = process.argv[3] || '';          // project ເກົ່າ (ກັນຈັບ URL ຊ້ຳ)
  const prevBase = prevUrl ? flowProjectBase(prevUrl) : '';
  const b = await connect();
  let pg = (listFlowPages(b) || [])[0];
  if (!pg) {
    const ctx = b.contexts()[0] || await b.newContext();
    pg = await ctx.newPage();
  }
  await pg.bringToFront().catch(() => {});

  // A downloaded Flow clip opens in the scene editor.  The screenshot flow is
  // Finish (เสร็จสิ้น) -> project page -> Home -> New project.  Going straight
  // to the home button while still on /scene/ can leave the old scene open or
  // make the next project click land on the wrong page.
  if (/\/scene\//.test(pg.url())) {
    const finishBtn = pg.locator(
      'button:has-text("เสร็จสิ้น"), button:has-text("Done"), button:has-text("Finish"), ' +
      '[aria-label*="เสร็จสิ้น"], [aria-label*="Done"], [aria-label*="Finish"]'
    ).last();
    if (await finishBtn.isVisible({ timeout: 12000 }).catch(() => false)) {
      await finishBtn.evaluate(el => el.click()).catch(() => {});
      for (let i = 0; i < 25; i++) {
        await sleep(500);
        if (!/\/scene\//.test(pg.url())) break;
      }
    } else {
      // Keep the recovery path deterministic if Flow changes the visible
      // label: return to the project URL rather than attempting a blind click.
      const m = pg.url().match(/^(https:\/\/flow\.google\.com\/project\/[^/?#]+)/i);
      if (m) await pg.goto(m[1], { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  }

  // 1) ກັບໜ້າ home — ລອງກົດປຸ່ມ home ກ່ອນ ຖ້າບໍ່ເຫັນຈຶ່ງ goto ຕົງ.
  // ສຳຄັນ: ກົດຜ່ານ el.click() ໃນ DOM ບໍ່ແມ່ນ pointer — ເພາະລິ້ງ "Skip to main
  // content" ບັງ pointer ຂອງປຸ່ມ home ເຮັດໃຫ້ .click() ທຳມະດາ timeout.
  const homeBtn = pg.locator('button[aria-label="หน้าแรก"], button[aria-label="Home"], button[aria-label="หน้าหลัก"], button.back-button').first();
  if (await homeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await homeBtn.evaluate(el => el.click()).catch(() => {});
  } else {
    await pg.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  // ລໍໃຫ້ຮອດໜ້າ home ແທ້ (URL ບໍ່ມີ /project/ ແລ້ວ ຫຼື ເຫັນປຸ່ມສ້າງ)
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    if (!/\/project\//.test(pg.url())) break;
  }

  // 2) ກົດສ້າງ project ໃໝ່
  const newBtn = pg.locator(
    'button.new-project-button, button:has-text("โปรเจ็กต์ใหม่"), button:has-text("New project"), ' +
    'button[aria-label*="โปรเจ็กต์ใหม่"], button[aria-label*="New project"]'
  ).first();
  // Flow home is an SPA and often paints its promotional banner before the
  // project action is usable.  Waiting for an enabled button avoids treating a
  // split/partially rendered home page as a failed automation run.
  let newButtonReady = false;
  for (let i = 0; i < 35; i++) {
    const visible = await newBtn.isVisible({ timeout: 900 }).catch(() => false);
    const enabled = visible && await newBtn.isEnabled().catch(() => false);
    if (enabled) { newButtonReady = true; break; }
    await sleep(1000);
  }
  if (!newButtonReady) {
    log('ສ້າງ project ໃໝ່ບໍ່ສຳເລັດ — ບໍ່ພົບປຸ່ມສ້າງ project ໃນໜ້າ home');
    sendEv('NEW_PROJECT', { ok: false, reason: 'new-project button was not visible and enabled' });
    await b.close(); process.exit(2);
  }
  await newBtn.scrollIntoViewIfNeeded().catch(() => {});
  let clicked = await newBtn.click({ timeout: 10000 }).then(() => true).catch(() => false);
  // Do not retry a second full click after this point: Flow may already be
  // navigating and a second click could create a duplicate project.  The DOM
  // fallback is only for an overlay that intercepts the pointer event.
  if (!clicked) clicked = await newBtn.evaluate(el => { el.click(); return true; }).catch(() => false);
  if (!clicked) {
    log('ສ້າງ project ໃໝ່ບໍ່ສຳເລັດ — ກົດປຸ່ມ project ໃໝ່ບໍ່ໄດ້');
    sendEv('NEW_PROJECT', { ok: false, reason: 'could not activate new-project button' });
    await b.close(); process.exit(2);
  }

  // 3) ລໍ URL ປ່ຽນເປັນ project ໃໝ່ (ບໍ່ຊ້ຳກັບເກົ່າ)
  let newUrl = '';
  for (let i = 0; i < 55; i++) {
    await sleep(800);
    const u = pg.url();
    if (/\/project\//.test(u) && (!prevBase || flowProjectBase(u) !== prevBase)) { newUrl = u; break; }
  }
  if (!newUrl) {
    log('ສ້າງ project ໃໝ່ບໍ່ສຳເລັດ — URL ບໍ່ປ່ຽນເປັນ project ໃໝ່');
    sendEv('NEW_PROJECT', { ok: false, reason: 'url did not change' });
    await b.close(); process.exit(3);
  }

  // 4) ຢືນຢັນ project ພ້ອມໃຊ້ (ມີຊ່ອງພິມ prompt) ກ່ອນລາຍງານສຳເລັດ
  const promptBox = pg.locator(sel.promptBox).first();
  const ready = await promptBox.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  if (!ready) log('ເຕືອນ: ສ້າງ project ໃໝ່ແລ້ວ ແຕ່ຍັງບໍ່ເຫັນຊ່ອງພິມ — ອາດຕ້ອງລໍ Flow ໂຫຼດ');
  log('ປິດ project ເກົ່າ ແລະ ສ້າງ project ໃໝ່ແລ້ວ: ' + flowProjectBase(newUrl));
  sendEv('NEW_PROJECT', { ok: true, url: newUrl });
  await b.close();
}

// ນັບຮູບທີ່ Flow ສ້າງໃນ project ດຽວນີ້ — ໃຫ້ server ກວດຜົນຫຼັງ worker ຈົບ
async function cmdCountImages() {
  const b = await connect();
  const pages = listFlowPages(b);
  if (!pages.length) { sendEv('IMAGE_COUNT', { count: 0 }); await b.close(); return; }
  const pg = pages[0];
  // ຕ້ອງເອົາແທັບມາໜ້າກ່ອນ ບໍ່ດັ່ງນັ້ນ Chrome ບໍ່ decode ຮູບ ແລະ ນັບບໍ່ໄດ້
  await pg.bringToFront().catch(() => {});
  await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2500);
  const count = await countGeneratedImages(pg);
  log(`ຮູບທີ່ Flow ສ້າງໃນ project: ${count}`);
  sendEv('IMAGE_COUNT', { count });
  await b.close();
}

async function findAIPage(browser, key) {
  const urls = { claude: /claude\.ai/, chatgpt: /chat(gpt)?\.(open)?com/, gemini: /gemini\.google/ };
  const re = urls[key] || urls.claude;
  for (const ctx of browser.contexts()) {
    for (const pg of ctx.pages()) {
      if (re.test(pg.url())) return pg;
    }
  }
  return null;
}

async function lockedAIPage(browser, key, lockUrl) {
  if (!lockUrl) return findAIPage(browser, key);
  for (const ctx of browser.contexts()) {
    for (const pg of ctx.pages()) {
      if (pg.url() === lockUrl) return pg;
    }
  }
  return null;
}

// Keep Gemini on the fast, predictable profile requested for JOD FLOW.
// Gemini changes its DOM labels occasionally, so use visible text/roles and
// verify both selections instead of depending on one brittle CSS class.
async function configureGemini(pg) {
  const wantedModel = String(cfg.geminiModel || '3.5 Flash-Lite');
  const wantedThinking = String(cfg.geminiThinking || 'low').toLowerCase();
  const visibleLast = async locator => {
    const n = await locator.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      const el = locator.nth(i);
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) return el;
    }
    return null;
  };
  const clickText = async (patterns, exact = true) => {
    for (const text of patterns) {
      const el = await visibleLast(pg.getByText(text, { exact }));
      if (el && await el.click({ timeout: 3000 }).then(() => true).catch(() => false)) return true;
    }
    return false;
  };
  const modelTrigger = async () => {
    let trigger = await visibleLast(pg.getByRole('button', { name: /Flash-Lite|Flash Lite|Gemini/i }));
    if (!trigger) trigger = await visibleLast(pg.locator('button').filter({ hasText: /Flash-Lite|Flash Lite/i }));
    return trigger;
  };
  const waitForModelTrigger = async () => {
    const deadline = Date.now() + 20000;
    do {
      const trigger = await modelTrigger();
      if (trigger) return trigger;
      await sleep(500);
    } while (Date.now() < deadline);
    return null;
  };

  await pg.locator('rich-textarea div[contenteditable="true"], div[contenteditable="true"]')
    .first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});

  // The closed trigger normally shows "Flash-Lite" while the open menu shows
  // the full versioned label, currently "3.5 Flash-Lite".
  let trigger = await waitForModelTrigger();
  if (!trigger) {
    log('Gemini setting: ບໍ່ພົບປຸ່ມເລືອກ model — ບໍ່ສົ່ງຄຳຖາມ');
    return false;
  }
  await trigger.click({ timeout: 5000 }).catch(() => {});
  await sleep(350);
  const modelSet = await clickText([wantedModel, wantedModel.replace('3.5 ', '')]);
  if (!modelSet) {
    await pg.keyboard.press('Escape').catch(() => {});
    log(`Gemini setting: ເລືອກ model ${wantedModel} ບໍ່ໄດ້`);
    return false;
  }

  // Reopen the same menu to set the thinking submenu.
  await sleep(350);
  trigger = await waitForModelTrigger();
  if (!trigger || !(await trigger.click({ timeout: 5000 }).then(() => true).catch(() => false))) return false;
  await sleep(300);
  const openedThinking = await clickText(['ระดับการคิด', 'Thinking level', 'ລະດັບການຄິດ']);
  if (!openedThinking) {
    await pg.keyboard.press('Escape').catch(() => {});
    log('Gemini setting: ບໍ່ພົບເມນູລະດັບການຄິດ');
    return false;
  }
  await sleep(300);
  const lowLabels = wantedThinking === 'low' ? ['ต่ำ', 'Low', 'ຕ່ຳ'] : [cfg.geminiThinking];
  const thinkingSet = await clickText(lowLabels);
  await pg.keyboard.press('Escape').catch(() => {});
  if (!thinkingSet) {
    log('Gemini setting: ເລືອກລະດັບຄິດຕ່ຳບໍ່ໄດ້');
    return false;
  }
  log(`Gemini setting: ${wantedModel} + thinking ${wantedThinking}`);
  return true;
}

// ---------- ຄຳສັ່ງຍ່ອຍ (ແຕ່ລະອັນເປັນ CLI command) ----------
const CMD = process.argv[2];

async function cmdStatus() {
  const out = { chrome: false, flow: false, ai: [] };
  if (await chromeIsUp()) {
    out.chrome = true;
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    for (const ctx of b.contexts()) for (const pg of ctx.pages()) {
      const u = pg.url();
      if (/flow\.google\.com/.test(u)) out.flow = true;
      if (/claude\.ai/.test(u)) out.ai.push('claude');
      if (/chat(gpt)?\./.test(u)) out.ai.push('chatgpt');
      if (/gemini\.google/.test(u)) out.ai.push('gemini');
    }
    await b.close();
  }
  sendEv('STATUS', out);
}

async function cmdLogin() {
  await ensureChrome(sel.url);
  log('ເປີດ Chrome ຂອງບອດແລ້ວ ລ໋ອກອິນ Google ແລະ ເປີດ Flow ໃນໜ້າຕ່າງນັ້ນ');
  log('ຈາກນັ້ນເປີດແຊັດ AI (Claude/ChatGPT/Gemini) ແລະ ລ໋ອກອິນໄວ້ຄ້າງ');
}

async function cmdOpen() {
  const url = process.argv[3] || sel.url;
  await ensureChrome(url);
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = b.contexts()[0] || await b.newContext();
  const pg = await ctx.newPage();
  await pg.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await b.close();
}

async function cmdGeminiSetup() {
  const b = await connect();
  let pg = await findAIPage(b, 'gemini');
  if (!pg) {
    const ctx = b.contexts()[0] || await b.newContext();
    pg = await ctx.newPage();
    await pg.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await pg.bringToFront().catch(() => {});
  const ok = await configureGemini(pg);
  sendEv('GEMINI_SETUP', { ok, model: cfg.geminiModel, thinking: cfg.geminiThinking });
  await b.close();
  if (!ok) process.exit(7);
}

// ສົ່ງຂໍ້ຄວາມໃຫ້ AI ແລ້ວລໍຖ້າຄຳຕອບ (ອ່ານຈາກ DOM)
async function cmdAsk() {
  const aiKey = process.argv[3] || 'claude';
  const msg = fs.readFileSync(process.argv[4], 'utf8');
  const outFile = process.argv[5];
  const refImg = process.argv[6] || ''; // ຮູບສິນຄ້າ — ໃຫ້ AI ເຫັນກ່ອງຈິງຕອນຂຽນບົດ
  const lockUrl = process.argv[7] || '';
  const autoNewChat = process.argv[8] === 'auto-new-chat';
  const briefMode = /brief-expand/i.test(path.basename(process.argv[4] || '')) || /^[ \t]*={2,}[ \t]*NARRATION[ \t]*={2,}[ \t]*$/m.test(msg);
  const policyMode = /ask-fix-policy/i.test(path.basename(process.argv[4] || ''));
  const fixMode = !policyMode && /ask-fix/i.test(path.basename(process.argv[4] || ''));
  const expectedFixShots = fixMode
    ? [...msg.matchAll(/^Shot\s+(\d{1,2})\s*\(/gmi)].map(m => Number(m[1]))
    : [];
  const b = await connect();
  let pg = await lockedAIPage(b, aiKey, lockUrl);
  if (!pg && lockUrl) { log('NOT VERIFIED: ບໍ່ພົບ AI ແຊັດທີ່ລັອກໄວ້'); await b.close(); process.exit(10); }
  if (!pg) {
    const urls = { claude: 'https://claude.ai/', chatgpt: 'https://chatgpt.com/', gemini: 'https://gemini.google.com/app' };
    const ctx = b.contexts()[0] || await b.newContext();
    pg = await ctx.newPage();
    await pg.goto(urls[aiKey] || urls.claude, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(3000);
  }
  if (autoNewChat) {
    const fresh = { claude: 'https://claude.ai/new', chatgpt: 'https://chatgpt.com/', gemini: 'https://gemini.google.com/app' };
    await pg.goto(fresh[aiKey] || fresh.claude, { waitUntil: 'domcontentloaded' });
  }
  await pg.bringToFront();
  // ວາງຂໍ້ຄວາມ ແລະ ສົ່ງ
  const inputSel = aiKey === 'chatgpt' ? '#prompt-textarea, textarea' : aiKey === 'gemini' ? 'rich-textarea div[contenteditable="true"], div[contenteditable="true"]' : 'div[contenteditable="true"][translate="no"], div[contenteditable="true"]';
  if (aiKey === 'gemini') {
    const ok = await configureGemini(pg).catch(() => false);
    if (!ok && briefMode) {
      log('Gemini setting: ຂັ້ນ brief ຕ້ອງເປັນ 3.5 Flash-Lite + thinking low — ບໍ່ສົ່ງຂໍ້ຄວາມ');
      await b.close();
      process.exit(9);
    }
    if (!ok) log('Gemini setting: ຕັ້ງບໍ່ໄດ້ — ໃຊ້ model ປັດຈຸບັນຕໍ່');
  }
  // ຈື່ບລັອກທີ່ມີຢູ່ກ່ອນແລ້ວ — ແຊັດເກົ່າມີຄຳຕອບເກົ່າຢູ່ ຖ້າບໍ່ຈື່ ບັອດຈະເກັບຂອງເກົ່າມາໃຊ້ຊ້ຳ
  let beforeBlocks = await pg.evaluate(() =>
    Array.from(document.querySelectorAll('pre code, code, pre')).map(e => (e.innerText || e.textContent || '').trim())
  ).catch(() => []);
  log(`ບລັອກທີ່ມີຢູ່ກ່ອນຖາມ: ${beforeBlocks.length}`);

  // brief-expand ແມ່ນວຽກຂໍ້ຄວາມລ້ວນໆ (ແຍກ/ຂະຫຍາຍບົດ) — ບໍ່ຕ້ອງເຫັນຮູບສິນຄ້າ.
  // ການແນບຮູບທຸກຄັ້ງເຮັດໃຫ້ຊ້າລົງ ແລະ ບໍ່ມີປະໂຫຍດຫຍັງຕໍ່ວຽກນີ້.
  if (refImg && !briefMode && !(await attachToChat(pg, refImg))) {
    sendEv('REFERENCE_MISSING', { kind: 'ai-script', reason: 'Gemini did not visibly accept product image' });
    await b.close();
    process.exit(8);
  }

  await pg.locator(inputSel).first().click({ timeout: 15000 });
  await pg.keyboard.insertText(msg);
  await sleep(500);
  await pg.keyboard.press('Enter');
  // ລໍຖ້າ jodflow block ປາກົດ ແລະ stable
  // Claude.ai renders code blocks as <pre><code>: innerText strips backtick fences
  // → ຊອກຈາກ <code> element ໂດຍກົງ ຫຼື body text
  // ລະວັງ: prompt ຂອງເຮົາເອງກໍເປັນ code block ທີ່ມີ "JOD FLOW SCRIPT", "Shot 1", "Shot 12"
  // ຖ້າບໍ່ກວດຈຳນວນ shot ບັອດຈະເກັບ prompt ຕົນເອງມາແທນຄຳຕອບ AI (ໄດ້ແຕ່ placeholder)
  // ສະນັ້ນ: ຮັບສະເພາະບລັອກທີ່ມີ Shot 1..12 ຄົບ ແລະ ບໍ່ມີຂໍ້ຄວາມ template
  let answer = '', stable = 0, sawPartial = 0, safetyRetried = false;
  let deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const got = await pg.evaluate(({ prev, briefMode, fixMode, policyMode }) => {
      const shotCount = t => {
        const nums = new Set();
        const re = /^Shot\s+(\d{1,2})\s*(?:\||:)/gm;
        let m;
        while ((m = re.exec(t))) nums.add(Number(m[1]));
        return nums.size;
      };
      const isTemplate = t => /ຂຽນປະໂຫຍກລາວຈິງ|ຂຽນ English scene ຈິງ|ຕໍ່ໄປຮອດ Shot 12/.test(t);
      const marker = label => new RegExp('^[ \\t]*={2,}[ \\t]*' + label + '[ \\t]*={2,}[ \\t]*$', 'im');
      const hasAllMarkers = t => ['NAME', 'DESC', 'STORY', 'NARRATION'].every(k => marker(k).test(t));
      const blocks = Array.from(document.querySelectorAll('pre code, code, pre'))
        .map(e => e.innerText || e.textContent || '');
      const body = document.body.innerText || '';
      const fm = body.match(/`{3}jodflow[\s\S]*?`{3}/i);
      if (fm) blocks.push(fm[0]);
      let best = 0;
      // AI ຂຶ້ນ error (ເຊັ່ນ Gemini: "I encountered an error... try again") — ລໍໄປກໍບໍ່ໄດ້ຄຳຕອບ
      const tail = (document.body.innerText || '').slice(-6000);
      const errRe = /(I encountered an error|Something went wrong|go(?:es|ing)? against my guidelines|would go against my guidelines|I can(?:not|'t) help with (?:this|that) request|ຂ້ອຍພົບຂໍ້ຜິດພາດ|เกิดข้อผิดพลาด|ลองอีกครั้ง|Try again later|unable to (complete|process))/i;
      const aiErr = errRe.test(tail) ? tail.match(errRe)[0] : null;

      // Gemini may render a short correction as ordinary assistant text
      // instead of a <pre>/<code> block.  In fix mode, accept the latest
      // visible Shot N: lines from the tail of the conversation.
      if (fixMode && !aiErr) {
        // Do not depend on line breaks or Markdown. Gemini sometimes places
        // the whole correction in one DOM text node. Keep the last occurrence
        // of each Shot N: label so the user's new answer wins over the prompt.
        const last = new Map();
        const re = /^\s*Shot\s+(\d{1,2})\s*:\s*([^\r\n]+)$/gmi;
        let m;
        while ((m = re.exec(tail))) last.set(Number(m[1]), `Shot ${m[1]}: ${m[2].trim()}`);
        const shotLines = expectedFixShots.filter(n => last.has(n)).map(n => last.get(n));
        if (shotLines.length) {
          return { text: shotLines.join('\n'), shots: shotLines.length };
        }
      }

      // Compare by DOM position/count, not by text value. Gemini can return the
      // exact same JSON text twice; text-based de-duplication then mistakes the
      // new answer for the old one and waits until timeout.
      const oldBlockCount = Array.isArray(prev) ? prev.length : 0;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const t = blocks[i];
        if (i < oldBlockCount) continue;
        if (policyMode) {
          const lines = t.split('\n').filter(line => /^\s*Shot\s+\d{1,2}\s*:\s*\S/i.test(line));
          if (lines.length) return { text: lines.join('\n'), shots: lines.length };
          continue;
        }
        if (isTemplate(t)) continue;   // prompt ຂອງເຮົາເອງ
        if (briefMode && hasAllMarkers(t)) return { text: t, shots: 12 };
        const c = shotCount(t);
        if (fixMode) {
          const found = new Set([...t.matchAll(/^Shot\s+(\d{1,2})\s*:/gmi)].map(x => Number(x[1])));
          if (expectedFixShots.some(n => found.has(n))) return { text: t, shots: found.size };
        }
        if (c >= 12) return { text: t, shots: c };
        if (c > best) best = c;
      }
      // Fallback: Gemini sometimes answers without a code fence. Markdown then
      // renders the narration as a list and innerText drops the "1." numbers, so
      // keep the first twelve narration lines instead of hunting for a "12.".
      if (briefMode && !aiErr) {
        const page = document.body.innerText || '';
        const heads = [...page.matchAll(/^[ \t]*={2,}[ \t]*NAME[ \t]*={2,}[ \t]*$/gim)].map(m => m.index);
        for (let i = heads.length - 1; i >= 0; i--) {
          const chunk = page.slice(heads[i]);
          if (/<product name on one line>/.test(chunk) || !hasAllMarkers(chunk)) continue;
          const nIdx = chunk.search(marker('NARRATION'));
          const lines = chunk.slice(nIdx).split('\n');
          const head = lines.shift();
          const twelve = lines.map(s => s.trim()).filter(Boolean).slice(0, 12);
          if (twelve.length === 12) return { text: chunk.slice(0, nIdx) + head + '\n' + twelve.join('\n'), shots: 12 };
          best = Math.max(best, twelve.length);
          break;
        }
      }
      return { text: null, shots: best, aiErr };
    }, { prev: beforeBlocks, briefMode, fixMode, policyMode }).catch(() => ({ text: null, shots: 0, aiErr: null }));

    if (got.aiErr && !got.text) {
      log(`AI ຕອບບໍ່ໄດ້: "${got.aiErr}"`);
      sendEv('ASK_AI_ERROR', { reason: got.aiErr });
      if (aiKey === 'gemini' && !briefMode && !safetyRetried) {
        safetyRetried = true;
        log('Gemini ປະຕິເສດ — ເປີດແຊັດໃໝ່ ແລະປັບສະເພາະຄຳສ່ຽງອັດຕະໂນມັດ');
        const safeMsg = msg
          .replace(/ຮັກສາ|ປິ່ນປົວ|ຫາຍຂາດ|ໄດ້ຜົນແນ່ນອນ/g, 'ນຳສະເໜີຕາມຂໍ້ມູນໃນສະຫຼາກ')
          .replace(/ນົກເຂົາບໍ່ຂັນ|ຂຶ້ນຊ້າ|ຫຼັ່ງໄວ|ຕໍ່ຮອບ\s*[ສອງ2]\s*ຮອບ\s*[ສາມ3]?/g, 'ບັນຫາສຸຂະພາບສ່ວນຕົວຂອງຜູ້ໃຫຍ່')
          .replace(/รักษา|หายขาด|ได้ผลแน่นอน|หลั่งเร็ว|เสื่อมสมรรถภาพ/g, 'นำเสนอตามข้อมูลบนฉลากโดยไม่รับประกันผล')
          .replace(/cure|guaranteed results?|erectile dysfunction|premature ejaculation/gi, 'general adult wellness support described on the label');
        const retryMsg = [
          safeMsg,
          '',
          'SAFETY-SAFE REVISION RULE:',
          '- Present the product only according to information on its label. Do not claim treatment, cure, guaranteed results, or medical certainty.',
          '- Remove explicit sexual descriptions and use neutral, non-graphic adult-wellness wording.',
          '- If any remaining claim is unsafe, revise only that wording. Preserve the original 12-shot structure, characters, locations, action order, CTA, and Shot 12 Hero ending.',
          '- Return the complete requested output, not an explanation of these changes.'
        ].join('\n');
        await pg.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await pg.locator(inputSel).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await sleep(1000);
        // ຕັ້ງບໍ່ໄດ້ກໍບໍ່ຢຸດ — ໃຊ້ model ປັດຈຸບັນຕໍ່
        const ok2 = await configureGemini(pg).catch(() => false);
        if (!ok2 && briefMode) {
          log('Gemini setting (retry): ຕັ້ງຄ່າສຳລັບ brief ບໍ່ໄດ້ — ບໍ່ສົ່ງຊ້ຳ');
          await b.close();
          process.exit(9);
        }
        if (!ok2) log('Gemini setting (retry): ຕັ້ງບໍ່ໄດ້ — ໃຊ້ model ປັດຈຸບັນຕໍ່');
        beforeBlocks = await pg.evaluate(() =>
          Array.from(document.querySelectorAll('pre code, code, pre')).map(e => (e.innerText || e.textContent || '').trim())
        ).catch(() => []);
        if (refImg && !briefMode && !(await attachToChat(pg, refImg))) {
          sendEv('REFERENCE_MISSING', { kind: 'ai-script-retry', reason: 'Gemini did not visibly accept product image' });
          await b.close();
          process.exit(8);
        }
        await pg.locator(inputSel).first().click({ timeout: 15000 });
        await pg.keyboard.insertText(retryMsg);
        await sleep(500);
        await pg.keyboard.press('Enter');
        answer = ''; stable = 0; sawPartial = 0;
        deadline = Date.now() + 300000;
        continue;
      }
      await b.close();
      process.exit(6);
    }
    if (!got.text) {
      if (got.shots > sawPartial) { sawPartial = got.shots; log(`AI ກຳລັງຂຽນ... ${got.shots}/12 shot`); }
      continue;
    }
    const norm = briefMode ? got.text : (got.text.startsWith('```') ? got.text : ('```jodflow\n' + got.text + '\n```'));
    if (norm === answer) { if (++stable >= 2) break; } // ຄືເກົ່າ 2 ຮອບ = ຂຽນຈົບແລ້ວ
    else { answer = norm; stable = 0; }
  }
  if (!answer) {
    log(`ລໍຄຳຕອບ AI ໝົດເວລາ — ເຫັນພຽງ ${sawPartial}/12 shot`);
    sendEv('ASK_INCOMPLETE', { ok: false, shots: sawPartial });
    await b.close();
    process.exit(5);
  }
  fs.writeFileSync(outFile, answer, 'utf8');
  sendEv('ASK_DONE', { ok: true, bytes: answer.length });
  if (autoNewChat || lockUrl) sendEv('AI_CHAT_URL', { url: pg.url() });
  await b.close();
}

// ແນບຮູບສິນຄ້າ (ຕ້ອງຖືກຮຽກກ່ອນພິມ prompt — ບັງຄັບຕາມ SKILL)
// opts.assetLabel = ຊື່ທີ່ Flow ຕັ້ງໃຫ້ asset ນັ້ນ (ສຳລັບແຜ່ນ storyboard ທີ່ Flow
// ສ້າງເອງ ຊື່ຂອງມັນເປັນຄຳບັນຍາຍ ບໍ່ແມ່ນຊື່ໄຟລ໌ໃນເຄື່ອງ)
async function attachProductImage(pg, filePath, opts = {}) {
  if (!filePath || !fs.existsSync(filePath)) { log('ຂ້າມ: ບໍ່ມີຮູບສິນຄ້າ'); return false; }
  const assetName = path.basename(filePath);
  const stem = assetName.replace(/\.[^.]+$/, '');
  // ລຳດັບຊື່ທີ່ຈະລອງຄົ້ນ: ຊື່ຈາກ Flow (ຖ້າມີ) → ຊື່ໄຟລ໌ → ຊື່ໄຟລ໌ບໍ່ມີນາມສະກຸນ
  const queries = [opts.assetLabel, assetName, stem].filter(Boolean);

  // ຢ່າອີງພຽງວ່າມີຮູບຕິດຢູ່ກັບ prompt ແລ້ວ — ອາດເປັນຮູບເກົ່າ/ຮູບຄົນລະສິນຄ້າ.
  // ຕ້ອງຄົ້ນຫາ assetName ຈາກ library ແລະ add ຮູບທີ່ຖືກຕ້ອງທຸກຄັ້ງ.

  // ນັບ "ingredient" (ຮູບທີ່ແນບໃນ prompt) — ໃຊ້ຢືນຢັນວ່າແນບເພີ່ມຈິງ.
  // ແກ້ bug: ຕອນແນບຮູບທີ 2 (ຄົນ) ຕໍ່ຈາກຮູບທີ 1 (ສິນຄ້າ) code ເຄີຍ return true
  // ທັນທີໂດຍບໍ່ກວດ → ຮູບຄົນບໍ່ຕິດຈິງ ແຕ່ລະບົບວ່າ 2/2.
  const ingredientCount = () => pg.locator(sel.ingredientImg).count().catch(() => 0);
  const startCount = await ingredientCount();
  const waitAttached = async (base, ms = 12000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await ingredientCount()) > base) return true;
      await sleep(400);
    }
    return false;
  };

  const openPicker = async () => {
    const up = pg.locator(sel.pickerUpload).first();
    if (await up.isVisible({ timeout: 2000 }).catch(() => false)) return up;
    const adds = pg.locator('button[aria-label="ເພີ່ມອົງປະກອບລົງໃນຊ່ອງພຣອມທ໌"], button[aria-label="เพิ่มองค์ประกอบลงในช่องพรอมต์"], button[aria-label="Add ingredients to the prompt box"], button.add-menu-trigger');
    let add = null;
    for (let i = 0; i < await adds.count(); i++) {
      const candidate = adds.nth(i);
      if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) { add = candidate; break; }
    }
    if (!add) throw new Error('ບໍ່ພົບປຸ່ມ "+" ສຳລັບແນບສື່');
    await add.evaluate(el => el.click()).catch(() => {});
    await up.waitFor({ timeout: 15000 });
    return up;
  };
  const addToPrompt = pg.locator(sel.pickerAdd).first();

  // 2) ຫາຮູບເກົ່າໃນ library ກ່ອນ
  await openPicker();
  await pg.locator(sel.pickerItem).first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});

  // ລໍໃຫ້ຈຳນວນລາຍການຢຸດນິ້ງ — ນັບວ່ານິ້ງສະເພາະເມື່ອ "ມີລາຍການແລ້ວ".
  // ການຮັບ 0 ວ່ານິ້ງເຮັດໃຫ້ບັອດສະຫຼຸບພາຍໃນ ~0.8 ວິວ່າ library ຫວ່າງ
  // ທັງທີ່ລາຍການຍັງບໍ່ທັນໂຫຼດ ແລ້ວໄປອັບຊ້ຳ (ຈຸດທີ່ພາດຮອບກ່ອນ).
  const settleOptions = async (maxMs = 9000) => {
    const deadline = Date.now() + maxMs;
    let prev = -1, stable = 0;
    while (Date.now() < deadline) {
      const c = await pg.locator(sel.pickerItem).count().catch(() => 0);
      stable = (c > 0 && c === prev) ? stable + 1 : 0;
      prev = c;
      if (stable >= 3) return c;
      await sleep(250);
    }
    return prev > 0 ? prev : 0;
  };

  // ຢືນຢັນການເພີ່ມ: Flow ແຕ່ລະລຸ້ນໃຊ້ປຸ່ມຄົນລະຊື່ ແລະ ບາງລຸ້ນເພີ່ມໃຫ້ເລີຍ
  // ໂດຍບໍ່ມີປຸ່ມ. ການຮູ້ຈັກແຕ່ "เพิ่มไปยังพรอมต์" ຢ່າງດຽວຄືເຫດທີ່ບັອດ
  // ຖືວ່າລົ້ມທັງທີ່ຮູບຕິດແລ້ວ ແລ້ວໄປອັບຊ້ຳ.
  const confirmAdd = async () => {
    for (const s of [sel.pickerAdd, sel.pickerAddMedia]) {
      const btn = pg.locator(s).first();
      if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await sleep(500);
        return true;
      }
    }
    await sleep(900);
    const stillOpen = await pg.locator(sel.pickerUpload).first().isVisible({ timeout: 1500 }).catch(() => false);
    if (!stillOpen) { log('  Flow ເພີ່ມຮູບໃຫ້ເລີຍ (ບໍ່ມີປຸ່ມຢືນຢັນ)'); return true; }
    log('  ກົດເລືອກແລ້ວ ແຕ່ບໍ່ພົບປຸ່ມຢືນຢັນ ແລະ picker ຍັງເປີດຢູ່');
    return false;
  };

  const search = pg.locator(sel.pickerSearch).first();
  const hasSearch = await search.isVisible({ timeout: 4000 }).catch(() => false);

  // ງົບເວລາລວມຂອງການຫາຮູບເກົ່າ — ເກີນນີ້ໄປອັບເລີຍ. ການປ່ຽນມາພິມຄົ້ນຫາ
  // ລ້ວນໆເຮັດໃຫ້ເສຍເວລາຮອດ ~100 ວິຕໍ່ຮູບ ແລະ ສຸດທ້າຍກໍອັບຊ້ຳຢູ່ດີ.
  const LOOKUP_BUDGET = 20000;
  const until = Date.now() + LOOKUP_BUDGET;

  const pickFrom = async (q, how) => {
    const hits = pg.locator(sel.pickerItem).filter({ hasText: q });
    // ຖ້າຕົງຫຼາຍກວ່າ 1 ລາຍການ ແປວ່າບອກບໍ່ໄດ້ວ່າອັນໃດແທ້ — ຢ່າເດົາ
    // ການເອົາ .first() ຕອນຊື່ຊ້ຳ ຄືເຫດທີ່ເອົາແຜ່ນ storyboard ຜິດໄປສ້າງຄລິບ
    const n = await hits.count().catch(() => 0);
    if (n > 1) { log(`  "${q}" ຕົງ ${n} ລາຍການ — ບອກບໍ່ໄດ້ວ່າອັນໃດ ຈຶ່ງບໍ່ໃຊ້ຂອງເກົ່າ`); return false; }
    const item = hits.first();
    if (!(await item.isVisible({ timeout: 1500 }).catch(() => false))) return false;
    await item.click().catch(() => {});
    await sleep(300);
    if (!(await confirmAdd())) { log(`  ເລືອກ "${q}" (${how}) ແລ້ວ ແຕ່ຢືນຢັນບໍ່ໄດ້`); return false; }
    if (!(await waitAttached(startCount))) { log(`  ເລືອກ "${q}" ແຕ່ ingredient ບໍ່ເພີ່ມ — ລອງວິທີອື່ນ`); return false; }
    log(`ໃຊ້ຮູບເກົ່າ "${q}" ຈາກ library (${how}, ບໍ່ອັບຊ້ຳ)`);
    return true;
  };

  // ຂັ້ນ 1 — ເບິ່ງລາຍການທີ່ສະແດງຢູ່ເລີຍ ໂດຍບໍ່ພິມຫຍັງ (ວິທີເດີມ: ໄວ ແລະ ເຄີຍໄດ້ຜົນ).
  // ຕ້ອງລອງອັນນີ້ກ່ອນສະເໝີ ການຂ້າມໄປພິມຄົ້ນທັນທີຄືເຫດທີ່ເຮັດໃຫ້ຊ້າລົງ ແລະ ພາດທຸກຄັ້ງ.
  const shown = await settleOptions(6000);
  log(`library ສະແດງ ${shown} ລາຍການ — ລອງຈັບຈາກລາຍການກ່ອນ`);
  for (const q of queries) {
    if (await pickFrom(q, 'ຈາກລາຍການ')) return true;
  }

  // ຂັ້ນ 2 — ຍັງບໍ່ພົບ ຈຶ່ງພິມຄົ້ນ (ພາຍໃນງົບເວລາທີ່ເຫຼືອ)
  if (hasSearch) {
    for (const q of queries) {
      if (Date.now() > until) { log('  ໝົດງົບເວລາຫາຮູບເກົ່າ — ໄປອັບໂຫຼດ'); break; }
      await search.click().catch(() => {});
      await search.fill('').catch(() => {});
      await sleep(200);
      await search.pressSequentially(q, { delay: 35 }).catch(() => {});
      const found = await settleOptions(Math.min(5000, Math.max(1000, until - Date.now())));
      log(`  ຄົ້ນ "${q}" → ${found} ລາຍການ`);
      if (await pickFrom(q, 'ຈາກການຄົ້ນ')) return true;
    }
    await search.fill('').catch(() => {});   // ລ້າງຄຳຄົ້ນ ບໍ່ດັ່ງນັ້ນປຸ່ມອັບໂຫຼດອາດບໍ່ຕອບ
  }

  // 3) ບໍ່ພົບ → ປິດແລ້ວເປີດ picker ໃໝ່ ຈຶ່ງອັບໂຫຼດ (ການຄົ້ນຫາຄ້າງຢູ່ເຮັດໃຫ້ປຸ່ມອັບໂຫຼດບໍ່ຕອບ)
  log('ບໍ່ພົບໃນ library — ອັບໂຫຼດໃໝ່:', assetName);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await pg.keyboard.press('Escape').catch(() => {});
    await sleep(900);
    const uploadBtn = await openPicker();
    const [chooser] = await Promise.all([
      pg.waitForEvent('filechooser', { timeout: 20000 }),
      uploadBtn.click(),
    ]);
    await chooser.setFiles(filePath);
    await sleep(1500);   // ລໍໃຫ້ຮູບເລີ່ມອັບກ່ອນ ບໍ່ດັ່ງນັ້ນກົດ "ເພີ່ມ" ໄວເກີນ (ຄືປຸ່ມຄ້າງ)
    for (let i = 0; i < 50; i++) {
      if (await addToPrompt.isVisible().catch(() => false)) { await addToPrompt.click().catch(() => {}); break; }
      await sleep(600);   // ເຊັກຖີ່ຂຶ້ນ ຮູ້ຜົນໄວຂຶ້ນ ແຕ່ເວລາລໍສູງສຸດເທົ່າເກົ່າ
    }
    if (await uploadBtn.isVisible().catch(() => false)) { await pg.keyboard.press('Escape').catch(() => {}); await sleep(600); }
    // ຢືນຢັນວ່າ ingredient ເພີ່ມຈິງ ຈຶ່ງຖືວ່າສຳເລັດ — ກັນ false success
    if (await waitAttached(startCount)) { log('ແນບຮູບສຳເລັດ'); return true; }
    log(`  ອັບແລ້ວແຕ່ ingredient ບໍ່ເພີ່ມ (ຮອບ ${attempt}/2) — ລອງໃໝ່`);
  }
  log('NOT VERIFIED: ອັບຮູບແລ້ວແຕ່ແນບບໍ່ຕິດ');
  return false;
}

// ຕັ້ງຄ່າ Flow: model ສົມຈິງ, ອັດຕາສ່ວນ 9:16, ຈຳນວນ 1x — ແຕ່ລະຂັ້ນ best-effort (ບໍ່ throw ຖ້າ UI ປ່ຽນ)

// ໃສ່ຮູບຈິງເຂົ້າຊ່ອງເຟຣມ (ໂໝດ "ເຟຣມ" ຂອງ Flow) — ເຟຣມເລີ່ມແມ່ນພິກເຊວຈິງ
// ສິນຄ້າຈຶ່ງຖືກຕ້ອງ 100% ແທນການໃຫ້ Flow ແຕ້ມຈາກຄຳໃບ້ (ຮຽນຈາກວິທີຂອງ FlowBot)
const SLOT_RE = { start: /^\s*(เริ่ม|Start)\s*$/i, end: /^\s*(สิ้นสุด|End)\s*$/i };

async function pickFrame(pg, slot, filePath) {
  if (!filePath || !fs.existsSync(filePath)) { log(`ຂ້າມເຟຣມ ${slot}: ບໍ່ມີໄຟລ໌`); return false; }
  const assetName = path.basename(filePath);
  const chipOf = () => pg.locator(sel.frameChip).filter({ hasText: SLOT_RE[slot] }).first();
  const chip = chipOf();
  if (!(await chip.isVisible({ timeout: 5000 }).catch(() => false))) {
    log(`ບໍ່ພົບຊ່ອງເຟຣມ "${slot}" — ຕ້ອງຢູ່ໂໝດເຟຣມກ່ອນ`);
    return false;
  }
  await chip.click().catch(() => {});
  await pg.locator(sel.pickerUpload).first().waitFor({ timeout: 15000 }).catch(() => {});

  // ຫາໃນ library ກ່ອນ ແລ້ວຄ່ອຍອັບ
  await pg.locator(sel.pickerItem).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  let item = pg.locator(sel.pickerItem).filter({ hasText: assetName }).first();
  if (!(await item.isVisible({ timeout: 2500 }).catch(() => false))) {
    const [chooser] = await Promise.all([
      pg.waitForEvent('filechooser', { timeout: 20000 }),
      pg.locator(sel.pickerUpload).first().click(),
    ]);
    await chooser.setFiles(filePath);
    for (let t = 0; t < 12; t++) {
      await sleep(2500);
      item = pg.locator(sel.pickerItem).filter({ hasText: assetName }).first();
      if (await item.isVisible().catch(() => false)) break;
    }
  }
  if (!(await item.isVisible().catch(() => false))) { log(`ບໍ່ພົບຮູບ "${assetName}" ສຳລັບເຟຣມ ${slot}`); return false; }

  await item.click().catch(() => {});
  await sleep(1200);
  const addBtn = pg.locator(sel.pickerAdd).first();
  if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) { await addBtn.click().catch(() => {}); await sleep(1200); }
  if (await pg.locator(sel.pickerUpload).first().isVisible().catch(() => false)) { await pg.keyboard.press('Escape').catch(() => {}); await sleep(800); }

  const stillEmpty = await chipOf().count().catch(() => 0);
  if (stillEmpty) { log(`ໃສ່ຮູບໃນຊ່ອງເຟຣມ ${slot} ບໍ່ສຳເລັດ`); return false; }
  log(`ໃສ່ເຟຣມ ${slot} = ${assetName} ແລ້ວ (ພິກເຊວຈິງ ບໍ່ແມ່ນ Flow ແຕ້ມ)`);
  return true;
}

async function setFlowSettings(pg, kind, frameMode = false) {
  // ແຜງຕັ້ງຄ່າ: ທຸກຕົວເລືອກເປັນ button[role=radio] ທີ່ມີ text (ກວດກັບ Flow ຈິງແລ້ວ)
  const pick = async (selector, label) => {
    const el = pg.locator(selector).first();
    if (!(await el.isVisible({ timeout: 3000 }).catch(() => false))) { log(`ຕັ້ງ ${label}: ບໍ່ພົບຕົວເລືອກ`); return false; }
    // Angular's Agent settings panel can keep an animation pending after a
    // normal Playwright click.  A DOM click updates the radio control without
    // waiting for that unrelated SPA animation.
    await el.evaluate(node => node.click()).catch(() => {});
    await sleep(500);
    log(`ຕັ້ງ ${label}: ແລ້ວ`);
    return true;
  };
  try {
    // Prefer the visible Agent composer control.  The legacy trigger remains
    // in the DOM with `hidden`, and union.locator(...).first() would select it.
    const agentTrigger = pg.locator('button.agent-action-button[aria-label="การตั้งค่า"], button.agent-action-button[aria-label="Settings"]').first();
    const legacyTrigger = pg.locator('button[aria-label="ทริกเกอร์การตั้งค่า"], button[aria-label="Settings trigger"], button.settings-trigger-button').first();
    const trigger = await agentTrigger.isVisible({ timeout: 1500 }).catch(() => false) ? agentTrigger : legacyTrigger;
    if (!(await trigger.isVisible({ timeout: 5000 }).catch(() => false))) {
      log('NOT VERIFIED: ບໍ່ພົບປຸ່ມ/ຊ່ອງຕັ້ງຄ່າ Flow');
      return false;
    }
    const beforeTxt = (await trigger.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const isAgentSettings = await trigger.evaluate(el => el.classList.contains('agent-action-button')).catch(() => false);
    // ຖ້າຄ່າຖືກຢູ່ແລ້ວ ບໍ່ຕ້ອງເປີດແຜງ ແລະ ກົດຊ້ຳ — ປະຢັດ ~4 ວິ/ແຜ່ນ
    const wantMode = kind === 'video' ? /ວິດີໂອ|วิดีโอ|video/i : /Banana|ຮູບ|รูปภาพ|image/i;
    if (!frameMode && wantMode.test(beforeTxt) && /crop_9_16/.test(beforeTxt) && /x1/.test(beforeTxt)
        && (kind !== 'video' || /10\s*(วินาที|seconds|s)/i.test(beforeTxt))) {
      log(`ຄ່າ Flow ຖືກຢູ່ແລ້ວ ຂ້າມການຕັ້ງ: ${beforeTxt}`);
      return true;
    }
    // Flow now has two composer UIs.  The Agent panel uses a small "tune"
    // button and its normal Playwright click can wait on a SPA transition.
    // Dispatching the trusted DOM click keeps this a bounded operation.
    await trigger.evaluate(el => el.click()).catch(() => {});
    await sleep(900);

    // Agent Settings is already the image-generation configuration; it has
    // no separate Image radio.  Do not wait on a selector that cannot exist.
    if (!isAgentSettings) await pick(kind === 'video' ? sel.modeVideoOption : sel.modeImageOption, kind === 'video' ? 'ໂໝດ: ວິດີໂອ' : 'ໂໝດ: ຮູບພາບ');
    if (kind === 'video' && !isAgentSettings) {
      await pick(frameMode ? sel.modeFramesOption : sel.modeIngredientsOption,
                 frameMode ? 'ວິດີໂອ: ໂໝດເຟຣມ' : 'ວິດີໂອ: ໂໝດອົງປະກອບ');
    }
    await pick(sel.aspectRatio916Option, 'ອັດຕາສ່ວນ 9:16');
    if (kind === 'video') await pick(sel.duration10Option, 'ໄລຍະເວລາ 10 ວິນາທີ');
    await pick(sel.outputCount1Option, 'ຈຳນວນ x1');

    // The Agent panel does not repeat settings in its trigger label.  Verify
    // the selected radio controls while the panel is open instead of guessing
    // from the old compact-button text.
    const selected = await pg.locator('button[role="radio"][aria-checked="true"]')
      .allInnerTexts().catch(() => []);
    const selectedTxt = selected.join(' | ').replace(/\s+/g, ' ').trim();
    await pg.keyboard.press('Escape').catch(() => {});
    await sleep(600);
    const afterTxt = (await trigger.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    log(`ຄ່າ Flow: ${beforeTxt} → ${afterTxt}; ຄ່າທີ່ເລືອກ: ${selectedTxt}`);
    const hasPortrait = /crop_9_16|9:16/.test(selectedTxt) || /crop_9_16/.test(afterTxt);
    const hasOne = /(^|\|\s*)x1(?:\s*\||$)/.test(selectedTxt) || /\bx1\b/.test(afterTxt);
    const hasTenSeconds = kind !== 'video'
      || /10\s*(ວິນາທີ|วินาที|seconds|s)/i.test(selectedTxt + ' ' + afterTxt);
    const hasImageModel = /Banana|Imagen|รูปภาพ|image|สมจริง|Photorealistic/i.test(beforeTxt + ' ' + afterTxt)
      || await pg.locator('button:has-text("Nano Banana"), button:has-text("Imagen")').count().catch(() => 0) > 0;
    const verified = kind === 'image'
      ? hasPortrait && hasOne && hasImageModel
      : hasPortrait && hasOne && hasTenSeconds;
    if (!verified) log(`NOT VERIFIED: ຄ່າ Flow ສຳລັບ ${kind} ບໍ່ຄົບ — ບໍ່ຄວນສ້າງຕໍ່`);
    return verified;
  } catch (e) {
    log('ຕັ້ງຄ່າ Flow ບໍ່ຄົບ (ສືບຕໍ່ດ້ວຍຄ່າເດີມ):', e && e.message || e);
    return false;
  }
}

// ກວດວ່າ Flow ສະແດງ policy error ຫຼັງສົ່ງ prompt ບໍ່
async function checkPolicyError(pg, waitMs = 8000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const found = await pg.locator(sel.policyErrorBanner).first().isVisible().catch(() => false);
    if (found) {
      const txt = await pg.locator(sel.policyErrorBanner).first().innerText().catch(() => 'policy violation');
      return txt.slice(0, 200);
    }
    await sleep(1000);
  }
  return null;
}

// ສົ່ງ prompt ຮູບ/ວິດີໂອເຂົ້າ Flow ແລະ ລໍຖ້າຜົນ (ບໍ່ດາວໂຫຼດ)
async function cmdFlow() {
  const kind = process.argv[3]; // "image" | "video"
  const promptFile = process.argv[4];
  const refPath = process.argv[5]; // ຮູບສິນຄ້າຈິງ (ບັງຄັບ)
  const slot = Number(process.argv[6] || 0); // ແທັບ Flow ຂອງ worker ນີ້
  const lockUrl = process.argv[7] || ''; // project ທີ່ຕ້ອງຢູ່ (ກັນແທັບຍ້າຍເອງ)
  const sheetPath = process.argv[8] || ''; // ແຜ່ນ storyboard ຂອງຄລິບນີ້ (Image 1)
  const text = fs.readFileSync(promptFile, 'utf8');
  const b = await connect();
  const pg = await findFlowPage(b, slot, lockUrl);
  if (lockUrl && !pg.url().startsWith(lockUrl.split('?')[0])) {
    log('ແທັບຍ້າຍໄປ project ອື່ນ — ພາກັບຄືນ');
    await pg.goto(lockUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await pg.locator(sel.promptBox).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
  }
  const tileSel = kind === 'image' ? (sel.imageTile || 'button:has(img), img[src]') : sel.videoTile;
  const beforeTiles = kind === 'image'
    ? await countGeneratedImages(pg)
    : await pg.locator(tileSel).count().catch(() => 0);
  // 1) ລ້າງ prompt box ກ່ອນ (ປ້ອງກັນ text ເກົ່າຄ້າງ → Flow ສ້າງທຸກ shot ລວມກັນ)
  await pg.locator(sel.clearPrompt).first().click({ timeout: 5000 }).catch(() => {});
  await sleep(400);
  // 1.5) ຕັ້ງຄ່າ model ສົມຈິງ, 9:16, ຈຳນວນ 1x (ສຳລັບ storyboard image ເທົ່ານັ້ນ — video ຕັ້ງຕາມ shot)
  const settingsVerified = await setFlowSettings(pg, kind);
  if (!settingsVerified) {
    sendEv('NOT_VERIFIED', { kind, reason: 'Flow settings could not be verified before generation' });
    await b.close();
    process.exit(7);
  }
  // 2) ແນບຮູບສິນຄ້າກ່ອນ — ຖ້າແນບບໍ່ສຳເລັດ ຢຸດ, ບໍ່ສ້າງແບບ text-only
  if (!refPath || !fs.existsSync(refPath)) {
    log('NOT VERIFIED: ບໍ່ມີຮູບສິນຄ້າຈິງ'); sendEv('REFERENCE_MISSING', { kind, reason: 'product image missing' });
    await b.close(); process.exit(7);
  }
  // Image 1 = ແຜ່ນ storyboard, Image 2 = ຮູບສິນຄ້າ — ລຳດັບຕ້ອງຕົງກັບ REFERENCE MAPPING ໃນ prompt
  if (sheetPath && fs.existsSync(sheetPath)) {
    if (await attachProductImage(pg, sheetPath)) log('ແນບແຜ່ນ storyboard ເປັນ Image 1 ແລ້ວ');
    else log('ເຕືອນ: ແນບແຜ່ນ storyboard ບໍ່ສຳເລັດ — ສືບຕໍ່ດ້ວຍຮູບສິນຄ້າຢ່າງດຽວ');
  } else if (kind === 'video') {
    log('ເຕືອນ: ບໍ່ມີແຜ່ນ storyboard ສົ່ງມາ — prompt ອ້າງເຖິງ Image 1 ທີ່ບໍ່ມີ');
  }
  if (!(await attachProductImage(pg, refPath))) {
    log('NOT VERIFIED: ແນບຮູບສິນຄ້າບໍ່ສຳເລັດ'); sendEv('REFERENCE_MISSING', { kind, reason: 'product image not accepted' });
    await b.close(); process.exit(7);
  }
  // 3) ພິມ prompt ໃໝ່ (Select-All + replace ເພື່ອ clear ໃດໆທີ່ຍັງຄ້າງ)
  await pg.locator(sel.promptBox).first().click({ timeout: 20000 });
  await pg.keyboard.press('ControlOrMeta+a');   // Meta+a ແມ່ນປຸ່ມ Windows ໃນ Windows — select-all ບໍ່ເຮັດວຽກ
  await sleep(100);
  await pg.keyboard.press('Backspace');
  await sleep(200);
  await pg.keyboard.insertText(text);
  await sleep(500);
  await pg.locator(sel.generateButton).first().click({ timeout: 15000 });
  log(`ສົ່ງ prompt ${kind} ເຂົ້າ Flow ແລ້ວ ລໍຖ້າຜົນ...`);

  // ກວດ policy error ທັນທີຫຼັງສົ່ງ — ຖ້າເຈີ ລາຍງານ + ອອກດ້ວຍ code 3 ໃຫ້ server retry ດ້ວຍບົດໃໝ່
  const policyErr = await checkPolicyError(pg, 8000);
  if (policyErr) {
    sendEv('POLICY_ERROR', { kind, reason: policyErr });
    log('Flow ປະຕິເສດ (policy):', policyErr);
    await b.close();
    process.exit(3);
  }

  if (kind === 'image') {
    // ລໍຮູບໃໝ່ໂດຍປຽບທຽບຊຸດ URL ກ່ອນ/ຫຼັງ — ບໍ່ອີງ naturalWidth ຈຶ່ງເຮັດວຽກໃນແທັບຂ້າງຫຼັງ
    const before = new Set(await settledSnapshot(pg));
    let elapsed = 0, fresh = [], steady = 0;
    while (elapsed < 240000) {
      await sleep(1200); elapsed += 1200;
      const now = await snapshotAssets(pg);
      fresh = now.filter(u => !before.has(u));
      sendEv('FLOW_PROGRESS', { progress: 1, seen: now.length, fresh: fresh.length });
      // ເຫັນແລ້ວຢືນຢັນສັ້ນ 800ms ພໍ — ບໍ່ຕ້ອງລໍອີກຮອບເຕັມ
      // Flow ສ້າງຮູບບໍ່ທັນໃນ 8 ວິ — ຖ້າ "ເຫັນຮູບໃໝ່" ໄວກວ່ານັ້ນແປວ່ານັບຮູບເກົ່າຜິດ
      if (fresh.length > 0 && elapsed >= 8000) {
        await sleep(800); elapsed += 800;
        const again = await snapshotAssets(pg);
        if (again.filter(u => !before.has(u)).length >= fresh.length) break;
      } else if (fresh.length > 0) {
        before.clear();
        for (const u of await snapshotAssets(pg)) before.add(u);
        log('ປັບຈຸດຕັ້ງຕົ້ນໃໝ່ — ຮູບທີ່ເຫັນໄວເກີນແມ່ນຮູບເກົ່າທີ່ຫາກໍໂຫຼດ');
        fresh = [];
      }
      steady = 0;
    }
    if (!fresh.length) {
      log(`ລໍ ${elapsed / 1000} ວິແລ້ວຍັງບໍ່ເຫັນຮູບໃໝ່ — ຖືວ່າບໍ່ສຳເລັດ`);
      sendEv('FLOW_TIMEOUT', { kind, waited: elapsed / 1000 });
      await b.close();
      process.exit(4);
    }
    log(`ເຫັນຮູບໃໝ່ ${fresh.length} ຮູບ (ໃຊ້ເວລາ ${elapsed / 1000} ວິ)`);
    sendEv('FLOW_DONE', { kind, added: fresh.length });
  } else {
    // Flow ບໍ່ວາງ <video> ໃນ gallery — ຄລິບທີ່ສຳເລັດປາກົດເປັນຮູບ poster 9:16
    // ຈຶ່ງໃຊ້ຕົວກວດອັນດຽວກັບຮູບ ບວກເງື່ອນໄຂວ່າ % ຕ້ອງຫາຍໄປແລ້ວ
    const beforeV = new Set(await settledSnapshot(pg));
    const deadline = Date.now() + 900000;
    let freshV = [], steadyV = 0;
    while (Date.now() < deadline) {
      await sleep(2500);
      const pct = await pg.locator(sel.progressIndicator).count().catch(() => 0);
      const now = await snapshotAssets(pg);
      freshV = now.filter(u => !beforeV.has(u));
      sendEv('FLOW_PROGRESS', { progress: pct, seen: now.length, fresh: freshV.length });
      if (freshV.length > 0 && pct === 0) {
        await sleep(900);
        if ((await pg.locator(sel.progressIndicator).count().catch(() => 0)) === 0) break;
      }
      steadyV = 0;
    }
    if (!freshV.length) {
      log('ລໍວິດີໂອຈົນໝົດເວລາ ແຕ່ບໍ່ເຫັນຄລິບໃໝ່');
      sendEv('FLOW_TIMEOUT', { kind });
      await b.close();
      process.exit(4);
    }
    log(`ເຫັນຄລິບໃໝ່ ${freshV.length}`);
    sendEv('FLOW_DONE', { kind, added: freshV.length });
  }
  await b.close();
}

// ອ່ານຊື່ຄລິບວິດີໂອໃນ project (ໃໝ່ສຸດກ່ອນ) — Flow ຕັ້ງຊື່ເອງຈາກ prompt ຈຶ່ງຕ້ອງອ່ານເອົາ
async function videoTitles(pg) {
  // Only video tiles have the play_circle footer icon.  Image/storyboard
  // tiles use the same footer-left class and must not be included.
  return await pg.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll('button.footer-left[aria-label]')) {
      const a = (n.getAttribute('aria-label') || '').trim();
      const icon = n.querySelector('mat-icon, .footer-icon');
      const iconText = (icon?.textContent || '').trim().toLowerCase();
      // Keep duplicate labels. Flow can legitimately assign the same generated
      // title to different clips; each tile is a separate asset.
      if (a && /play_circle|play_arrow|videocam|video/.test(iconText)) out.push(a);
    }
    return out;
  }).catch(() => []);
}

// Flow truncates a tile label with an ellipsis, so compare on the whole
// remaining text and let the shorter side act as a prefix. Slicing to a fixed
// 24 characters collapsed "…presenting clinic" and "…presenting produc" into
// one key, which left all three clips indistinguishable and the scene order
// down to positional guesswork.
const normTitle = t => String(t || '').replace(/\s*[.…]+\s*$/, '').trim();
function sameTitle(a, b) {
  const rawA = String(a || '').trim(), rawB = String(b || '').trim();
  const x = normTitle(rawA), y = normTitle(rawB);
  if (!x || !y) return false;
  if (x === y) return true;
  // A prefix is safe only when Flow visibly truncated one long title.  Do
  // not equate ordinary shared prefixes such as "Scene 1" and "Scene 10".
  const aTruncated = /[.…]\s*$/.test(rawA), bTruncated = /[.…]\s*$/.test(rawB);
  const short = x.length < y.length ? x : y;
  const long = x.length < y.length ? y : x;
  return (aTruncated || bTruncated) && short.length >= 24 && long.startsWith(short);
}

// ລາຍນິ້ວມື (aHash 8x8) ຂອງຮູບຕົວຢ່າງຄລິບ "ໃນຄັງ" ພ້ອມ src ແລະ ຊື່.
// ຊື່ທີ່ Flow ຕັ້ງໃຫ້ເຊື່ອບໍ່ໄດ້ 100% (ຊ້ຳກັນໄດ້ ແລະ ຖືກຕັດດ້ວຍ "…")
// ແຕ່ຮູບຂອງແຕ່ລະຄລິບແຍກຕ່າງກັນຊັດ — ວັດແລ້ວ: ອັນດຽວກັນ 4-11 bit,
// ຄົນລະອັນ 21-38 bit. ຈຶ່ງໃຊ້ຮູບເປັນຕົວຢືນຢັນວ່າຄລິບນີ້ແມ່ນສາກໃດແທ້.
async function libraryVideoFingerprints(pg) {
  return await pg.evaluate(async () => {
    const aHash = async (src) => {
      try {
        const im = await new Promise((r, j) => {
          const i = new Image(); i.crossOrigin = 'anonymous';
          i.onload = () => r(i); i.onerror = j; i.src = src;
        });
        const c = document.createElement('canvas'); c.width = 8; c.height = 8;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, 8, 8);
        const d = g.getImageData(0, 0, 8, 8).data;
        const px = [];
        for (let i = 0; i < d.length; i += 4) px.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        const mean = px.reduce((a, b) => a + b, 0) / px.length;
        return px.map(v => (v > mean ? '1' : '0')).join('');
      } catch { return ''; }
    };
    const out = [];
    for (const n of document.querySelectorAll('button.footer-left[aria-label]')) {
      const icon = n.querySelector('mat-icon, .footer-icon');
      const iconText = (icon?.textContent || '').trim().toLowerCase();
      if (!/play_circle|play_arrow|videocam|video/.test(iconText)) continue;
      const tile = n.closest('flow-grid-tile-container');
      const img = tile && tile.querySelector('img');
      const src = img ? (img.currentSrc || img.src || '') : '';
      out.push({ label: (n.getAttribute('aria-label') || '').trim(), src, fp: src ? await aHash(src) : '' });
    }
    return out;
  }).catch(() => []);
}

function subtractOccurrences(items, baseline) {
  const counts = new Map();
  for (const item of baseline || []) counts.set(item, (counts.get(item) || 0) + 1);
  return (items || []).filter(item => {
    const left = counts.get(item) || 0;
    if (!left) return true;
    counts.set(item, left - 1);
    return false;
  });
}

async function cmdListClips() {
  const lockUrl = process.argv[3] || '';
  const b = await connect();
  const pg = (listFlowPages(b) || []).find(p => flowProjectBase(p.url()) === flowProjectBase(lockUrl));
  if (!pg) { sendEv('CLIP_LIST', { titles: [] }); await b.close(); process.exit(2); }
  await pg.bringToFront().catch(() => {});
  if (lockUrl && flowProjectBase(pg.url()) !== flowProjectBase(lockUrl)) {
    sendEv('CLIP_LIST', { error: 'opened Flow project differs from current job', titles: [] });
    await b.close(); process.exit(2);
  }
  await sleep(5000);
  const vt = pg.locator('button').filter({ hasText: /videocam/ }).first();
  if (await vt.isVisible({ timeout: 4000 }).catch(() => false)) { await vt.click().catch(() => {}); await sleep(3000); }
  const titles = await videoTitles(pg);
  log('ຊື່ຄລິບ (ໃໝ່ສຸດກ່ອນ): ' + titles.slice(0, 6).join(' | '));
  sendEv('CLIP_LIST', { titles, clips: await libraryVideoFingerprints(pg) });
  await b.close();
}

async function cmdRecoverFirstSheet() {
  const lockUrl = process.argv[3] || '';
  const b = await connect();
  const pg = await findLockedFlowPage(b, lockUrl);
  if (!pg) { await b.close(); process.exit(2); }
  const tab = pg.locator('button').filter({ hasText: /รูปภาพ|Images|ຮູບພາບ/ }).first();
  if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) await tab.click().catch(() => {});
  await sleep(3000);
  const assets = await settledSnapshot(pg);
  if (assets.length !== 1) {
    sendEv('NOT_VERIFIED', { reason: `expected one existing storyboard image, found ${assets.length}` });
    await b.close(); process.exit(7);
  }
  const index = await pg.evaluate(url => Array.from(document.querySelectorAll('img'))
    .findIndex(img => (img.getAttribute('src') || img.currentSrc || '').split('?')[0] === url), assets[0]);
  if (index < 0) { await b.close(); process.exit(7); }
  const img = pg.locator('img').nth(index);
  const ready = await img.evaluate(el => el.complete && el.naturalWidth > 50).catch(() => false);
  if (!ready) { await b.close(); process.exit(7); }
  const file = path.join(DATA, 'sb-sheet-1.png');
  await img.screenshot({ path: file, animations: 'disabled' });
  if (fs.statSync(file).size < 4000) { await b.close(); process.exit(7); }
  const label = await img.evaluate(el => el.closest('flow-grid-tile-container, [aria-label]')?.getAttribute('aria-label') || '');
  fs.writeFileSync(path.join(DATA, 'storyboard-assets.json'), JSON.stringify({
    projectUrl: lockUrl, assets: [{ sheet: 1, url: assets[0], file, label }],
  }, null, 2));
  sendEv('SHEET_RECOVERED', { sheet: 1, file, url: assets[0] });
  await b.close();
}

// ລວມຄລິບເປັນ scene ດຽວຕາມລຳດັບ 1→2→3 ແລ້ວດາວໂຫຼດ
// ທາງທີ່ Flow ໃຫ້: ເປີດຄລິບ 1 → ປຸ່ມ + ທ້າຍ timeline → "เพิ่มคลิป" → ຄົ້ນຊື່ → ເລືອກ → "เพิ่มสื่อ" → ດາວໂຫຼດฉาก
// ສ່ວນດາວໂຫຼດ scene — ໃຊ້ຮ່ວມກັນລະຫວ່າງ 'combine-scene' (ຕໍ່ເອງແລ້ວໂຫຼດ)
// ແລະ 'download-scene' (ຜູ້ໃຊ້ລຽງເອງໃນ Flow ແລ້ວໃຫ້ບັອດໂຫຼດໃຫ້)
async function exportSceneToFile(b, pg, outFile, requestedOut, titlesLen) {
  const dlBtn = pg.locator(sel.sceneDownload).first();
  if (!(await dlBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
    log('ບໍ່ພົບປຸ່ມດາວໂຫຼດ');
    sendEv('COMBINE_MANUAL', { reason: 'scene download button not found', url: pg.url() }); await b.close(); return null;
  }
  // ບັງຄັບບ່ອນບັນທຶກຜ່ານ CDP — ~/Downloads ເຊື່ອບໍ່ໄດ້ ເພາະ Chrome ບລັອກການດາວໂຫຼດອັດຕະໂນມັດຊ້ຳໆ
  const tmpDir = path.join(DATA, 'dl-tmp');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* reported when download starts */ }
  try { for (const f of fs.readdirSync(tmpDir)) { try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* Windows scanner may temporarily lock one old file */ } } } catch { /* ຂ້າມ */ }
  // Incognito's target browserContextId is not accepted by
  // Browser.setDownloadBehavior in this Chrome build. Configure the actual
  // Flow page instead; the browser-level call failed before the click.
  const ps = await pg.context().newCDPSession(pg);
  await ps.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmpDir, eventsEnabled: true });
  let dlState = '', dlBytes = 0, dlName = '', dlGuid = '', clickAt = 0;
  ps.on('Page.downloadWillBegin', e => {
    if (!clickAt || Date.now() < clickAt) return;
    dlGuid = e.guid || '';
    dlName = e.suggestedFilename || '';
    log('  ເລີ່ມດາວໂຫຼດ: ' + dlName);
  });
  ps.on('Page.downloadProgress', e => {
    if (!dlGuid || e.guid !== dlGuid) return;
    dlState = e.state;
    dlBytes = e.receivedBytes || 0;
  });

  // Scene readiness can arrive before the old fixed 20-second delay. Require
  // stable clip count, no build indicator, and an enabled export button.
  let exportReady = false, stableExport = 0;
  for (let i = 0; i < 30; i++) {
    const count = await pg.locator('div.cdk-drop-list > div.cdk-drag').count().catch(() => 0);
    const busy = await pg.locator(sel.sceneBuilding).first().isVisible().catch(() => false);
    const enabled = await dlBtn.isEnabled().catch(() => false);
    stableExport = count === titlesLen && !busy && enabled ? stableExport + 1 : 0;
    if (stableExport >= 3) { exportReady = true; break; }
    await sleep(1000);
  }
  if (!exportReady) {
    sendEv('COMBINE_MANUAL', { reason: 'scene export was not ready', url: pg.url() });
    await b.close(); process.exit(5);
  }
  clickAt = Date.now();
  await dlBtn.click();
  log('ກົດດາວໂຫຼດ — Flow ກຳລັງສົ່ງອອກ scene (ອາດໃຊ້ເວລາ 1-5 ນາທີ)');
  // Some Chrome builds save the MP4 but never emit Page.downloadProgress.
  // Watch the dedicated empty temp directory as well. Never click export a
  // second time merely because an event is missing (that created duplicates).
  let fileCandidate = '', fileSize = 0, stableFile = 0;
  for (let i = 0; i < 160; i++) {
    if (dlState === 'canceled' || dlState === 'completed') break;
    const files = fs.readdirSync(tmpDir).filter(f => /\.mp4$/i.test(f));
    const partial = fs.readdirSync(tmpDir).some(f => /\.crdownload$/i.test(f));
    const newest = files.map(f => path.join(tmpDir, f))
      .filter(f => fs.statSync(f).mtimeMs >= clickAt - 5000)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (newest && !partial) {
      const size = fs.statSync(newest).size;
      stableFile = newest === fileCandidate && size === fileSize && size > 1000000 ? stableFile + 1 : 0;
      fileCandidate = newest; fileSize = size;
      if (stableFile >= 2) {
        const fd = fs.openSync(newest, 'r'), head = Buffer.alloc(8);
        fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
        if (head.subarray(4, 8).toString('ascii') === 'ftyp') {
          dlState = 'completed'; dlName = path.basename(newest); dlBytes = size;
          log('  ພົບ MP4 ຂຽນສຳເລັດໃນ dl-tmp ແມ່ນບໍ່ມີ Chrome event');
          break;
        }
      }
    }
    await sleep(3000);
  }

  // Chrome ບາງເທື່ອບໍ່ເຊື່ອ downloadPath ທີ່ສັ່ງ ແລ້ວລົງ ~/Downloads ດ້ວຍຊື່ຈິງແທນ
  // ຈຶ່ງຕ້ອງຫາທັງ 2 ບ່ອນ ບໍ່ດັ່ງນັ້ນໄຟລ໌ມາຄົບແຕ່ລະບົບລາຍງານວ່າລົ້ມເຫຼວ
  const pickNewest = (dir, wantName, isGuid = false) => {
    let best = '', bestAt = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (!st.isFile() || st.size < 1000000) continue;
        if (st.mtimeMs + 5000 < clickAt) continue;             // ຕ້ອງໃໝ່ກວ່າຕອນກົດ
        if (wantName && f !== wantName) continue;
        if (isGuid ? f !== dlGuid : !/\.mp4$/i.test(f)) continue;
        let signature = '';
        try { const fd = fs.openSync(full, 'r'); const buf = Buffer.alloc(8); fs.readSync(fd, buf, 0, 8, 0); fs.closeSync(fd); signature = buf.subarray(4, 8).toString('ascii'); } catch { continue; }
        if (signature !== 'ftyp') continue;
        if (st.mtimeMs > bestAt) { bestAt = st.mtimeMs; best = full; }
      }
    } catch { /* ຂ້າມ */ }
    return best;
  };
  let got = dlState === 'completed' && fileCandidate ? pickNewest(tmpDir, path.basename(fileCandidate)) : '';
  if (!got && dlState === 'completed' && dlName) got = pickNewest(tmpDir, dlName);
  if (!got && dlState === 'completed') got = pickNewest(tmpDir, '');
  if (!got && dlState === 'completed' && dlName) got = pickNewest(downloadsDir(), dlName);
  if (got) log('  ພົບໄຟລ໌: ' + got);
  try { await ps.send('Page.setDownloadBehavior', { behavior: 'default' }); } catch { /* ຂ້າມ */ }
  await ps.detach().catch(() => {});
  if (!got || dlState !== 'completed') {
    log(`ດາວໂຫຼດບໍ່ສຳເລັດ (ສະຖານະ ${dlState || 'ບໍ່ເລີ່ມ'}) — scene ລວມແລ້ວ ດາວໂຫຼດເອງໄດ້ທີ່ ` + pg.url());
    sendEv('COMBINE_MANUAL', { reason: `scene download ${dlState || 'did not start'}`, url: pg.url() }); await b.close(); return null;
  }
  const sig = fs.readFileSync(got).subarray(4, 8).toString('ascii');
  if (sig !== 'ftyp') {
    log('NOT VERIFIED: ໄຟລ໌ທີ່ Flow ສົ່ງກັບບໍ່ແມ່ນ MP4');
    sendEv('COMBINE_MANUAL', { reason: 'downloaded file is not MP4' });
    await b.close(); process.exit(6);
  }
  let deliveredFile = '';
  try {
    const userDownloads = downloadsDir();
    fs.mkdirSync(userDownloads, { recursive: true });
    const existing = fs.readdirSync(userDownloads).map(name => /^AI(\d+)\.mp4$/i.exec(name)).filter(Boolean);
    let next = Math.max(223, ...existing.map(match => Number(match[1]))) + 1;
    while (!deliveredFile) {
      const candidate = path.join(userDownloads, `AI${next}.mp4`);
      try { copyWithRetry(got, candidate, true); deliveredFile = candidate; }
      catch (e) { if (e.code !== 'EEXIST') throw e; next++; }
    }
    // Also retain the internal copy for recovery/debugging, but report the
    // Downloads copy as the actual user deliverable.
    if (!samePath(requestedOut, deliveredFile)) copyWithRetry(got, requestedOut);
    const delivered = fs.statSync(deliveredFile);
    const fd = fs.openSync(deliveredFile, 'r');
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);
    const deliveredSig = header.subarray(4, 8).toString('ascii');
    if (delivered.size < 1000000 || deliveredSig !== 'ftyp') throw new Error('ກວດ MP4 ຫຼັງສຳເນົາບໍ່ຜ່ານ');
  } catch (e) {
    log('NOT VERIFIED: ສຳເນົາ/ກວດ MP4 ບໍ່ຜ່ານ: ' + e.message);
    sendEv('COMBINE_MANUAL', { reason: 'final MP4 copy or verification failed' });
    await b.close(); process.exit(6);
  }
  log(`  ໄດ້ ${Math.round(dlBytes / 1048576)} MB`);
  log('ບັນທຶກວິດີໂອລວມແລ້ວ: ' + deliveredFile);
  return deliveredFile;
}


// ດາວໂຫຼດ scene ທີ່ມີຢູ່ແລ້ວ — ສຳລັບຕອນຜູ້ໃຊ້ລຽງຄລິບເອງໃນ Flow
// ບັອດຈະບໍ່ແຕະລຳດັບ ພຽງແຕ່ກົດສົ່ງອອກ ແລະ ເອົາໄຟລ໌ມາໃຫ້
async function cmdDownloadScene() {
  const sceneUrl = process.argv[3] || '';
  const requestedOut = process.argv[4] || path.join(DATA, 'final-combined.mp4');
  const productName = process.argv[5] || '';
  const safeName = String(productName)
    .replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'JOD-FLOW';
  const d = new Date(); const p2 = v => String(v).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const userDownloads = downloadsDir();
  fs.mkdirSync(userDownloads, { recursive: true });
  const outFile = path.join(userDownloads, `${safeName}-${stamp}.mp4`);

  const b = await connect();
  let pg = (listFlowPages(b) || []).find(p => p.url().includes('/scene/'));
  if (!pg) pg = (listFlowPages(b) || [])[0];
  if (!pg) { log('ບໍ່ພົບແທັບ Flow'); sendEv('COMBINE_MANUAL', { reason: 'no tab' }); await b.close(); process.exit(2); }
  if (sceneUrl && !pg.url().startsWith(sceneUrl.split('?')[0])) {
    await pg.goto(sceneUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(6000);
  }
  await pg.bringToFront().catch(() => {});
  const made = await pg.locator('div.cdk-drop-list > div.cdk-drag').count().catch(() => 0);
  if (!made) { log('ບໍ່ພົບຄລິບໃນ scene ນີ້'); sendEv('COMBINE_MANUAL', { reason: 'scene has no clips', url: pg.url() }); await b.close(); process.exit(5); }
  log(`ດາວໂຫຼດ scene ທີ່ມີຢູ່ (${made} ຄລິບ ຕາມລຳດັບທີ່ຜູ້ໃຊ້ລຽງ — ບັອດບໍ່ແຕະ)`);

  const saved = await exportSceneToFile(b, pg, outFile, requestedOut, made);
  if (saved === null) return;
  sendEv('COMBINE_DONE', { clips: made, file: saved, url: pg.url() });
  await b.close();
}

async function cmdCombineScene() {
  const lockUrl = process.argv[3] || '';
  const manifestPath = process.argv[4] || '';
  let scenes = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  } catch (e) {
    log('ອ່ານ combine manifest ບໍ່ໄດ້: ' + (e.message || e));
    sendEv('COMBINE_MANUAL', { reason: 'invalid combine manifest' });
    process.exit(2);
  }
  // Never compact this list.  The physical timeline must always be exactly
  // Scene 1, then Scene 2, then Scene 3.
  if (scenes.length !== 3 || scenes.some((s, i) => !s || Number(s.scene) !== i + 1 || !String(s.title || '').trim())) {
    log('combine manifest ບໍ່ຄົບ Scene 1→2→3 — ຢຸດກ່ອນຕໍ່ຄລິບ');
    sendEv('COMBINE_MANUAL', { reason: 'manifest must contain ordered Scene 1, 2, 3 titles' });
    process.exit(2);
  }
  const titles = scenes.map(s => String(s.title).trim());
  // ລາຍນິ້ວມືຮູບຂອງແຕ່ລະສາກ (ເກັບຕອນສ້າງຄລິບ) — ໃຊ້ຢືນຢັນວ່າຄລິບທີ່ຕໍ່ເຂົ້າ
  // ແມ່ນສາກນັ້ນແທ້. ຊື່ຢ່າງດຽວຢືນຢັນບໍ່ໄດ້ ເພາະ Flow ຕັ້ງຊື່ຊ້ຳກັນໄດ້
  // ແລະ ຕັດຊື່ດ້ວຍ "…" — ນີ້ຄືເຫດທີ່ວິດີໂອລວມເຄີຍລຳດັບຜິດທັງທີ່ log ວ່າຖືກ.
  const expectFps = scenes.map(s => String(s.fp || ''));
  const hamming = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  };
  // ວັດຈາກ Flow ແທ້: ຮູບໃນຄັງ ທຽບ ຮູບໃນ timeline ຂອງຄລິບດຽວກັນຕ່າງ 4-11 bit
  // ສ່ວນຄົນລະຄລິບຕ່າງ 21-38 bit. ສະນັ້ນໃຊ້ກົດ "ອັນໃກ້ສຸດ ແລະ ຕ້ອງນຳອັນຮອງ
  // ຢ່າງໜ້ອຍ 8 bit" ແທນການກຳນົດເສັ້ນຕາຍຕົວ.
  const CLIP_ID_MARGIN = 8;
  const whichScene = (fp) => {
    const ranked = expectFps
      .map((e, i) => (e && e.length === fp.length ? { i, d: hamming(fp, e) } : null))
      .filter(Boolean)
      .sort((a, b) => a.d - b.d);
    if (!ranked.length) return null;
    const margin = ranked.length > 1 ? ranked[1].d - ranked[0].d : 64;
    return { scene: ranked[0].i + 1, dist: ranked[0].d, margin };
  };
  // ຢືນຢັນຄລິບທີ່ຢູ່ຕຳແໜ່ງ pos (ເລີ່ມ 1) ວ່າແມ່ນສາກ pos ແທ້ບໍ່
  const verifyClipIdentity = async (pg, fps, pos) => {
    if (!expectFps[pos - 1]) return true;                  // ບໍ່ມີລາຍນິ້ວມື — ຂ້າມ
    // ຮູບໃນ timeline ຂອງຄລິບທີ່ຫາກໍເພີ່ມເຂົ້າຍັງບໍ່ນິ້ງ (Flow ແຕ້ມຮູບຫຍາບກ່ອນ)
    // ການກວດເທື່ອດຽວຈຶ່ງໄດ້ "ບໍ່ຊັດ" ແລ້ວຂ້າມການກວດໄປ — ຕ້ອງລໍແລ້ວລອງຄືນ
    let fp = fps[pos - 1], got = fp ? whichScene(fp) : null;
    for (let attempt = 1; attempt <= 5 && (!got || got.margin < CLIP_ID_MARGIN); attempt++) {
      await sleep(2000);
      const again = await stableFingerprints(pg, fps.length);
      fp = again[pos - 1] || fp;
      got = fp ? whichScene(fp) : null;
    }
    if (!fp) { log(`  ກວດຮູບຄລິບ ${pos} ບໍ່ໄດ້ (ອ່ານຮູບບໍ່ອອກ) — ຂ້າມການກວດ`); return true; }
    if (!got || got.margin < CLIP_ID_MARGIN) {
      log(`  ກວດຮູບຄລິບ ${pos} ບໍ່ຊັດ (ຕ່າງກັນໜ້ອຍ) — ຂ້າມການກວດ`);
      return true;
    }
    if (got.scene !== pos) {
      log(`ຄລິບທີ່ຕຳແໜ່ງ ${pos} ເປັນຮູບຂອງສາກ ${got.scene} (ຕ່າງ ${got.dist} bit) — ຢຸດ ບໍ່ໃຫ້ລຳດັບຜິດ`);
      sendEv('COMBINE_MANUAL', { reason: `clip at position ${pos} is scene ${got.scene}`, url: pg.url() });
      return false;
    }
    log(`  ຢືນຢັນຮູບ: ຕຳແໜ່ງ ${pos} = ສາກ ${pos} ແທ້ (ຕ່າງ ${got.dist} bit, ນຳອັນຮອງ ${got.margin})`);
    return true;
  };
  const requestedOut = process.argv[5] || path.join(DATA, 'final-combined.mp4');
  // The user-facing export belongs in Downloads. Keep the app data path only
  // as an internal fallback; otherwise Chrome history shows an MP4 while the
  // user cannot find it in Finder's Downloads folder.
  const userDownloads = downloadsDir();
  fs.mkdirSync(userDownloads, { recursive: true });
  // ທຸກຮອບເຄີຍບັນທຶກຊື່ດຽວກັນ "final-combined.mp4" ເຮັດໃຫ້ຮອບໃໝ່ທັບຮອບເກົ່າ
  // ຜູ້ໃຊ້ຈຶ່ງຕ້ອງຟ້າວປ່ຽນຊື່ເອງທຸກເທື່ອ. ດຽວນີ້ໃຫ້ຊື່ບອກສິນຄ້າ + ວັນເວລາ
  // ຈຶ່ງບໍ່ທັບກັນ ແລະ ຫາງ່າຍໃນ Finder.
  const productName = process.argv[6] || '';
  const safeName = String(productName)
    .replace(/[\\/:*?"<>|]/g, ' ')      // ຕົວທີ່ໃຊ້ໃນຊື່ໄຟລ໌ບໍ່ໄດ້
    .replace(/\s+/g, ' ').trim().slice(0, 40) || 'JOD-FLOW';
  const d = new Date();
  const p2 = v => String(v).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  let outFile = path.join(userDownloads, `${safeName}-${stamp}.mp4`);
  if (titles.length !== 3) { log('ຕ້ອງມີຊື່ຄລິບຄົບ Scene 1, 2, 3'); sendEv('COMBINE_MANUAL', { reason: 'not exactly three scene titles' }); process.exit(2); }
  // Flow truncates a tile label with an ellipsis, so compare on the whole
  // remaining text and let the shorter side act as a prefix. Slicing to a fixed
  // 24 characters collapsed "…presenting clinic" and "…presenting produc" into
  // one key, which left all three clips indistinguishable and the scene order
  // down to positional guesswork.
  // Gallery/picker lists newest assets first. Titles still identical after
  // normalisation are genuinely ambiguous, so pick the occurrence belonging to
  // this scene by counting equal titles generated after it (scene 3 is
  // occurrence 0, scene 2 occurrence 1, ...).
  const occurrenceForScene = sceneIndex =>
    titles.slice(sceneIndex + 1).filter(t => sameTitle(t, titles[sceneIndex])).length;

  // Angular CDK can keep drag items in creation/DOM order while positioning
  // them elsewhere with transforms.  Therefore nth(count - 1) is not
  // necessarily the clip at the end of the visible timeline.  The old logic
  // clicked the + after Scene 1 and inserted Scene 3 between 1 and 2.
  // ຄລິບໃນ timeline ຂອງ Flow ບໍ່ມີຊື່ໃຫ້ອ່ານເລີຍ (ກວດ DOM ແທ້ແລ້ວ: ບໍ່ມີ aria-label,
  // title, alt ຫຼື ຂໍ້ຄວາມ) ສະນັ້ນການກວດລຳດັບດ້ວຍຊື່ຈຶ່ງເປັນໄປບໍ່ໄດ້ຕະຫຼອດໄປ.
  // ແຕ່ແຕ່ລະຄລິບມີຮູບຕົວຢ່າງຝັງເປັນ data URI — ໃຊ້ມັນເປັນ "ລາຍນິ້ວມື" ແທນຊື່
  // ແລ້ວກວດວ່າ "ຄລິບໃໝ່ໄປຕໍ່ທ້າຍແທ້ ແລະ ຂອງເກົ່າບໍ່ຖືກແຊກ".
  // ໃຊ້ aHash 8x8 (ທຽບ "ເນື້ອພາບ" ບໍ່ແມ່ນ byte ຂອງ src).
  // ວັດແລ້ວ: ຄລິບດຽວກັນຄົນລະໜ້າ/ຄົນລະການ encode ຕ່າງກັນ 0 bit
  // ສ່ວນຄລິບຄົນລະອັນຕ່າງກັນ 22-36 bit — ຈຶ່ງແຍກໄດ້ຊັດ.
  // (ການ hash ຂໍ້ຄວາມ src ໃຊ້ບໍ່ໄດ້ ເພາະ Flow encode ຮູບໃໝ່ທຸກຄັ້ງທີ່ສ້າງ scene)
  const timelineFingerprints = async pg =>
    pg.locator('div.cdk-drop-list > div.cdk-drag').evaluateAll(async els => {
      const aHash = async (src) => {
        try {
          const im = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
          const c = document.createElement('canvas'); c.width = 8; c.height = 8;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data;
          const px = [];
          for (let i = 0; i < d.length; i += 4) px.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          const mean = px.reduce((a, b) => a + b, 0) / px.length;
          return px.map(v => (v > mean ? '1' : '0')).join('');
        } catch { return ''; }
      };
      const out = [];
      for (const el of els) {
        const src = (el.querySelector('img') || {}).currentSrc || '';
        out.push({ left: el.getBoundingClientRect().left, fp: src ? await aHash(src) : '' });
      }
      return out.sort((a, b) => a.left - b.left).map(x => x.fp);
    }).catch(() => []);

  // ຄລິບດຽວກັນຍອມໃຫ້ຕ່າງກັນໄດ້ບໍ່ເກີນ 8 bit ໃນ 64 (ວັດຈິງໄດ້ 0, ຄົນລະອັນ 22+)
  const sameClip = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 8) return false;
    return true;
  };

  // ລໍໃຫ້ຮູບຕົວຢ່າງໂຫຼດຄົບ ແລະ ນິ້ງ ກ່ອນຈຶ່ງເອົາໄປທຽບ
  const stableFingerprints = async (pg, expected) => {
    let prev = null;
    for (let i = 0; i < 25; i++) {
      const fps = await timelineFingerprints(pg);
      const ok = fps.length === expected && fps.every(Boolean);
      if (ok && prev && prev.join('|') === fps.join('|')) return fps;
      prev = ok ? fps : null;
      await sleep(600);
    }
    return prev || [];
  };

  const visualTimeline = async pg => {
    const items = pg.locator('div.cdk-drop-list > div.cdk-drag');
    return items.evaluateAll(els => {
      // Material icon ligatures render as real text, so a clip tile's innerText
      // normally begins with "play_circle".  The old filter rejected any
      // candidate that merely STARTED with an icon/control word, which threw
      // away the one string that actually carried the clip title and left every
      // label empty.  The bot then read "unreadable" as "wrong order" and
      // stopped after two clips without exporting.  Strip the icon/duration
      // tokens instead of discarding the whole string.
      const ICONS = /\b(?:play_circle|play_arrow|pause|videocam|movie|image|more_vert|more_horiz|drag_indicator|add|close|delete|edit|content_copy|check)\b/gi;
      const CONTROL = /^(?:add|เพิ่มคลิป|more|options|menu|play|delete|remove|drag|move|trim|split)$/i;
      const clean = s => String(s || '')
        .replace(ICONS, ' ')
        .replace(/\b\d{1,2}:\d{2}\b/g, ' ')   // ຄວາມຍາວຄລິບ ເຊັ່ນ 0:10
        .replace(/\s+/g, ' ')
        .trim();
      return els.map((el, domIndex) => {
        const r = el.getBoundingClientRect();
        const body = el.querySelector('.clip-body');
        const raw = [
          body && body.getAttribute('aria-label'),
          body && body.getAttribute('title'),
          body && body.innerText,
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          ...Array.from(el.querySelectorAll('[aria-label], [title], img[alt]'))
            .map(x => x.getAttribute('aria-label') || x.getAttribute('title') || x.getAttribute('alt')),
          el.innerText,
        ];
        // A clip title is a descriptive sentence; control labels are one word.
        // Take the longest surviving candidate rather than the first.
        const label = raw.map(clean).filter(x => x && !CONTROL.test(x))
          .sort((a, b) => b.length - a.length)[0] || '';
        return { domIndex, left: r.left, top: r.top, width: r.width, label };
      }).sort((a, b) => a.left - b.left);
    }).catch(() => []);
  };

  const b = await connect();
  const pg = (listFlowPages(b) || [])[0];
  if (!pg) { log('ບໍ່ພົບແທັບ Flow'); sendEv('COMBINE_MANUAL', { reason: 'no tab' }); await b.close(); process.exit(2); }
  await pg.bringToFront().catch(() => {});
  if (lockUrl) await pg.goto(lockUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // 1) ເປີດຕົວແກ້ຂອງຄລິບ 1
  const vt = pg.locator('button').filter({ hasText: /videocam/ }).first();
  if (await vt.isVisible({ timeout: 10000 }).catch(() => false)) await vt.click().catch(() => {});
  // ຈັບຄູ່ດ້ວຍການອ່ານ aria-label ແທນ CSS prefix (ກັນຊ່ອງວ່າງ/ຕົວພິເສດ)
  const want1 = normTitle(titles[0]);
  const tiles = pg.locator('button.footer-left');
  await tiles.first().waitFor({ timeout: 15000 }).catch(() => {});
  const nTiles = await tiles.count();
  let idx = -1, seenMatch = 0;
  // ຖ້າມີລາຍນິ້ວມືຮູບຂອງສາກ 1 ໃຫ້ເລືອກດ້ວຍ "ຮູບ" ກ່ອນ — ແນ່ນອນກວ່າຊື່
  // ເພາະຮູບນີ້ມາຈາກແຜ່ນໃນຄັງອັນດຽວກັນ ຈຶ່ງຄວນຕ່າງກັນເກືອບ 0 bit
  if (expectFps[0]) {
    const tileFps = await tiles.evaluateAll(async (els) => {
      const aHash = async (src) => {
        try {
          const im = await new Promise((r, j) => {
            const i = new Image(); i.crossOrigin = 'anonymous';
            i.onload = () => r(i); i.onerror = j; i.src = src;
          });
          const c = document.createElement('canvas'); c.width = 8; c.height = 8;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data;
          const px = [];
          for (let i = 0; i < d.length; i += 4) px.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          const mean = px.reduce((a, b) => a + b, 0) / px.length;
          return px.map(v => (v > mean ? '1' : '0')).join('');
        } catch { return ''; }
      };
      const out = [];
      for (const el of els) {
        const tile = el.closest('flow-grid-tile-container');
        const img = tile && tile.querySelector('img');
        const src = img ? (img.currentSrc || img.src || '') : '';
        out.push(src ? await aHash(src) : '');
      }
      return out;
    }).catch(() => []);
    const ranked = tileFps
      .map((fp, i) => (fp && fp.length === expectFps[0].length ? { i, d: hamming(fp, expectFps[0]) } : null))
      .filter(Boolean)
      .sort((a, b) => a.d - b.d);
    const margin = ranked.length > 1 ? ranked[1].d - ranked[0].d : 64;
    if (ranked.length && margin >= CLIP_ID_MARGIN) {
      idx = ranked[0].i;
      log(`ຫາຄລິບ 1 ດ້ວຍຮູບ: ຕ່າງ ${ranked[0].d} bit (ນຳອັນຮອງ ${margin}) — ບໍ່ຕ້ອງເດົາຈາກຊື່`);
    } else {
      log('ຫາຄລິບ 1 ດ້ວຍຮູບບໍ່ຊັດ — ກັບໄປໃຊ້ຊື່');
    }
  }
  const wantedOccurrence = occurrenceForScene(0);
  for (let i = 0; idx < 0 && i < nTiles; i++) {
    const a = ((await tiles.nth(i).getAttribute('aria-label')) || '').trim();
    const iconText = ((await tiles.nth(i).locator('mat-icon, .footer-icon').first().textContent().catch(() => '')) || '').trim().toLowerCase();
    if (sameTitle(a, titles[0]) && /play_circle|play_arrow|videocam|video/.test(iconText)) {
      if (seenMatch === wantedOccurrence) { idx = i; break; }
      seenMatch++;
    }
  }
  if (idx < 0) {
    log(`ຫາຄລິບ 1 ບໍ່ພົບ: "${want1}" — ທີ່ເຫັນ: ${(await videoTitles(pg)).join(' | ') || '(ບໍ່ມີ)'}`);
    sendEv('COMBINE_MANUAL', { reason: 'clip1 not found' }); await b.close(); process.exit(3);
  }
  // ຊື່ຢູ່ແຖວລຸ່ມຂອງ tile — ຕ້ອງກົດທີ່ຮູບເໜືອມັນຈຶ່ງເປີດຕົວແກ້
  const fb = await tiles.nth(idx).boundingBox();
  await pg.mouse.dblclick(fb.x + fb.width / 2, fb.y - 70);
  for (let i = 0; i < 20 && !/\/(edit|scene)\//.test(pg.url()); i++) await sleep(800);
  if (!/\/(edit|scene)\//.test(pg.url())) {
    log('ເປີດຕົວແກ້ຄລິບ 1 ບໍ່ໄດ້ — URL: ' + pg.url());
    sendEv('COMBINE_MANUAL', { reason: 'editor not open' }); await b.close(); process.exit(3);
  }
  await pg.locator('div.cdk-drop-list > div.cdk-drag').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  log('ເປີດຄລິບ 1 ແລ້ວ: ' + pg.url());
  let activeSceneUrl = pg.url();
  const restoreScene = async () => {
    if (flowProjectBase(pg.url()) === flowProjectBase(lockUrl) && /\/(edit|scene)\//.test(pg.url())) return;
    log('Flow ຍ້າຍອອກຈາກ scene ເດີມ — ກັບໄປກວດ scene ທີ່ລັອກໄວ້');
    await pg.goto(activeSceneUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await pg.locator('div.cdk-drop-list > div.cdk-drag').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  };

  // 2) ເພີ່ມຄລິບທີ່ເຫຼືອເທື່ອລະອັນ ຕາມລຳດັບ
  let orderVerified = true;
  for (let n = 1; n < titles.length; n++) {
    const appendStarted = Date.now();
    const stage = label => log(`  ເວລາຕໍ່ຄລິບ ${n + 1} — ${label}: ${((Date.now() - appendStarted) / 1000).toFixed(1)}s`);
    const want = normTitle(titles[n]);
    log(`ເພີ່ມຄລິບ ${n + 1}: "${want}"`);
    let fpsBefore = [];   // ຈັບຫຼັງຊູມ — ເບິ່ງໝາຍເຫດບ່ອນກົດ +
    // ຊູມອອກກ່ອນ ໃຫ້ timeline ທັງເສັ້ນຢູ່ໃນຈໍ — ບໍ່ດັ່ງນັ້ນ + ທ້າຍສຸດຢູ່ນອກຈໍ
    // ແລ້ວຈະໄປກົດ + ລະຫວ່າງກາງ ເຮັດໃຫ້ລຳດັບສະຫຼັບ (ເຄີຍໄດ້ 1→3→2)
    const zo = pg.locator(sel.sceneZoomOut).first();
    for (let z = 0; z < 4; z++) {
      const lastClip = pg.locator('div.cdk-drop-list > div.cdk-drag').last();
      const clipBox = await lastClip.boundingBox().catch(() => null);
      const view = pg.viewportSize();
      if (clipBox && view && clipBox.x >= 0 && clipBox.x + clipBox.width <= view.width) break;
      if (!(await zo.isVisible().catch(() => false))) break;
      if (await zo.isDisabled().catch(() => false)) break;
      await zo.click().catch(() => {});
    }
    stage('timeline ພ້ອມ');
    // ສຳຄັນ: ເລືອກຄລິບສຸດທ້າຍແບບ deterministic ກ່ອນກົດ +.
    // ການກົດສຸ່ມຫຼາຍຈຸດເຄີຍເຮັດໃຫ້ Flow ເລືອກຄລິບ 1 ແທນຄລິບສຸດທ້າຍ → 1→3→2.
    const drags = pg.locator('div.cdk-drop-list > div.cdk-drag');
    // ອ່ານ timeline ຊ້ຳໄດ້ — ທັນທີຫຼັງເພີ່ມຄລິບ DOM ຍັງຈັດໜ້າ ການອ່ານເທື່ອດຽວ
    // ອາດໄດ້ລາຍການຫວ່າງແລ້ວບັອດຢຸດທັງທີ່ບໍ່ມີຫຍັງຜິດ
    let visualItems = [];
    for (let t = 1; t <= 5; t++) {
      visualItems = await visualTimeline(pg);
      if (visualItems.length) break;
      log(`  ອ່ານ timeline ເທື່ອ ${t} ບໍ່ເຫັນຄລິບ — ລອງໃໝ່`);
      await sleep(1500);
    }
    const dn = visualItems.length;
    const rightmost = visualItems[visualItems.length - 1];
    if (!rightmost) {
      sendEv('COMBINE_MANUAL', { reason: 'timeline has no visible clip to append after', url: pg.url() });
      await b.close(); process.exit(6);
    }
    const rightmostDrag = drags.nth(rightmost.domIndex);
    // ເຮັດທຸກຮອບ ລວມທັງຮອບທຳອິດ (ຄລິບດຽວ) — ເມື່ອກ່ອນຂ້າມຮອບທຳອິດໄປ
    // ຖ້າຄລິບດຽວນັ້ນບັງເອີນບໍ່ຖືກເລືອກ ປຸ່ມ + ຈະບໍ່ມີ ແລ້ວບັອດຢຸດທັນທີ
    {
      // ກວດ DOM ຈິງແລ້ວ: ປຸ່ມ + ຂຶ້ນສະເພາະຄລິບທີ່ມີ class "selected" ເທົ່ານັ້ນ
      // ແລະ ທັນທີຫຼັງເພີ່ມຄລິບ timeline ຍັງຈັດໜ້າຢູ່ ການກົດເທື່ອດຽວຈຶ່ງມັກພາດ.
      // ເມື່ອກ່ອນພາດເທື່ອດຽວກໍຢຸດເລີຍ — ດຽວນີ້ລອງກົດຊ້ຳຈົນຕິດ.
      const last = rightmostDrag;
      const body = last.locator('.clip-body').first();
      const lastPlus = last.locator(sel.clipAddButton).first();
      let selected = false, hasLastPlus = false;
      for (let attempt = 1; attempt <= 6; attempt++) {
        await last.scrollIntoViewIfNeeded().catch(() => {});
        await last.hover().catch(() => {});
        await body.click({ timeout: 10000 }).catch(() => {});
        await sleep(900);
        selected = await last.evaluate(el => el.classList.contains('selected')).catch(() => false);
        hasLastPlus = (await lastPlus.count().catch(() => 0)) > 0;
        if (selected && hasLastPlus) {
          log(`  ຄລິບ ${dn} ອັນ — ເລືອກຄລິບສຸດທ້າຍໄດ້ (ລອງ ${attempt} ເທື່ອ) ✓`);
          break;
        }
        log(`  ລອງເລືອກຄລິບສຸດທ້າຍເທື່ອ ${attempt}: selected=${selected} ປຸ່ມ+=${hasLastPlus}`);
        await sleep(1000);
      }
      if (!selected || !hasLastPlus) {
        log('ເລືອກຄລິບສຸດທ້າຍບໍ່ໄດ້ຫຼັງລອງ 6 ເທື່ອ — ຢຸດ ກັນລຳດັບສະຫຼັບ');
        sendEv('COMBINE_MANUAL', { reason: `cannot select last clip (selected=${selected}, plus=${hasLastPlus}, count=${dn})`, url: pg.url() });
        await b.close(); process.exit(6);
      }
    }
    const selectedDrag = rightmostDrag;
    const appendPlus = selectedDrag.locator(sel.clipAddButton).first();
    if (!(await appendPlus.count())) { log('ບໍ່ພົບປຸ່ມ + ຂອງຄລິບສຸດທ້າຍ'); sendEv('COMBINE_MANUAL', { reason: 'last clip has no append button' }); await b.close(); process.exit(4); }
    // ຈັບລາຍນິ້ວມື "ຫຼັງຊູມອອກ" ເທົ່ານັ້ນ — ການຊູມປ່ຽນຂະໜາດຮູບຕົວຢ່າງ
    // ລາຍນິ້ວມືຈຶ່ງປ່ຽນໄປນຳ. ຖ້າຈັບກ່ອນຊູມແລ້ວໄປທຽບຫຼັງຊູມ ຈະເຫັນວ່າ
    // "ຕ່າງກັນ" ທັງທີ່ຄລິບບໍ່ໄດ້ຍ້າຍ — ເປັນເຫດທີ່ບັອດຢຸດຕັ້ງແຕ່ຄລິບ 2.
    fpsBefore = await stableFingerprints(pg, n);
    // ກວດຄລິບ 1 ເທື່ອດຽວກ່ອນຕໍ່ອັນໃດ — ຖ້າຄລິບແລກຜິດ ລຳດັບກໍຜິດໝົດ
    if (n === 1 && !(await verifyClipIdentity(pg, fpsBefore, 1))) { await b.close(); process.exit(6); }
    await appendPlus.click();
    await pg.locator(sel.clipAddMenuItem).first().click({ timeout: 10000 });

    const search = pg.locator(sel.pickerSearch).first();
    if (!(await search.isVisible({ timeout: 45000 }).catch(() => false))) {
      log('ບໍ່ເຫັນຊ່ອງຄົ້ນຫາຂອງ picker'); sendEv('COMBINE_MANUAL', { reason: 'no picker' }); await b.close(); process.exit(4);
    }
    stage('picker ເປີດ');
    // ຕ້ອງພິມແທ້ (fill ບໍ່ກະຕຸ້ນການກັ່ນຕອງ) ບໍ່ດັ່ງນັ້ນລາຍການບໍ່ຫຼຸດ
    // ແລ້ວ Flow ຈະໃສ່ອັນທີ່ *ACTIVE* ຄືອັນໃໝ່ສຸດ ເຮັດໃຫ້ລຳດັບຜິດ (ເຄີຍໄດ້ 1→3→2)
    await search.click();
    await search.pressSequentially(want, { delay: 55 });
    const optAll = pg.locator('button[role="option"]');
    // Repeated titles mean the list rarely narrows to one. Wait for the filter
    // to settle instead of for a single result, which never arrived and simply
    // burned the whole timeout.
    let prevCount = -1, stableCount = 0;
    for (let i = 0; i < 35; i++) {
      const count = await optAll.count().catch(() => 0);
      stableCount = count > 0 && count === prevCount ? stableCount + 1 : 0;
      prevCount = count;
      if (stableCount >= 3) break;
      await sleep(200);
    }
    const collectMatches = async () => {
      const oc = await optAll.count();
      const out = [];
      for (let oi = 0; oi < oc; oi++) {
        const txt = ((await optAll.nth(oi).innerText().catch(() => '')) || '').trim();
        if (sameTitle(txt, titles[n])) out.push(oi);
      }
      return out;
    };
    let matching = await collectMatches();
    // ຄົ້ນບໍ່ເຫັນເທື່ອທຳອິດ = ການກັ່ນຕອງອາດຍັງບໍ່ທັນແລ່ນ — ພິມຄືນແລ້ວລອງອີກ
    // ແທນທີ່ຈະຢຸດທັງວຽກ
    for (let retry = 1; retry <= 2 && !matching.length; retry++) {
      log(`  ຄົ້ນເທື່ອ ${retry} ບໍ່ເຫັນ "${want}" — ພິມຄືນແລ້ວລອງໃໝ່`);
      await search.click().catch(() => {});
      await search.fill('').catch(() => {});
      await sleep(400);
      await search.pressSequentially(want, { delay: 55 }).catch(() => {});
      await sleep(2500);
      matching = await collectMatches();
    }
    const wantedPickerOccurrence = occurrenceForScene(n);
    log(`  ຄົ້ນແລ້ວເຫັນ ${matching.length} ຄລິບທີ່ຊື່ກົງ — ເລືອກລຳດັບ ${wantedPickerOccurrence + 1}`);
    if (matching.length <= wantedPickerOccurrence) {
      log(`ບໍ່ພົບ occurrence ທີ່ຖືກຂອງຄລິບ "${want}" — ຢຸດ ກັນລຳດັບສະຫຼັບ`);
      sendEv('COMBINE_MANUAL', { reason: `picker occurrence missing for ${want} (${matching.length} found)` }); await b.close(); process.exit(4);
    }
    await optAll.nth(matching[wantedPickerOccurrence]).click();
    stage('ເລືອກຄລິບ');
    // ບາງເທື່ອກົດລາຍການແລ້ວ Flow ເພີ່ມເລີຍ ບາງເທື່ອຕ້ອງກົດ "เพิ่มสื่อ" ຢືນຢັນ
    const confirm = pg.locator(sel.pickerAddMedia).first();
    if (await confirm.isVisible({ timeout: 4000 }).catch(() => false)) {
      await confirm.click().catch(() => {});
      log('  ກົດ "เพิ่มสื่อ" ຢືນຢັນ');
    } else {
      log('  ກົດລາຍການແລ້ວ Flow ເພີ່ມໃຫ້ເລີຍ');
    }
    // One readiness loop replaces separate picker, building, and timeline waits.
    // Flow can leave hidden status nodes in the DOM, so check visibility.
    let ready = false, stable = 0;
    const readyDeadline = Date.now() + 240000;
    while (Date.now() < readyDeadline) {
      await restoreScene();
      const pickerOpen = await search.isVisible().catch(() => false);
      const count = await pg.locator('div.cdk-drop-list > div.cdk-drag').count().catch(() => 0);
      const busy = await pg.locator(sel.sceneBuilding).first().isVisible().catch(() => false);
      stable = count === n + 1 && !busy && !pickerOpen ? stable + 1 : 0;
      if (stable >= 2) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) {
      sendEv('COMBINE_MANUAL', { reason: `clip ${n + 1} did not settle in timeline`, url: pg.url() });
      await b.close(); process.exit(5);
    }
    stage('Flow ຕໍ່ຄລິບສຳເລັດ');
    // ກວດລຳດັບດ້ວຍລາຍນິ້ວມືຮູບ (ຊື່ອ່ານບໍ່ໄດ້ — ເບິ່ງໝາຍເຫດຢູ່ timelineFingerprints).
    // ເງື່ອນໄຂທີ່ຖືກຕ້ອງ: ລາຍການໃໝ່ = ລາຍການເກົ່າ + 1 ອັນຕໍ່ "ທ້າຍສຸດ" ເທົ່ານັ້ນ.
    const fpsAfter = await stableFingerprints(pg, n + 1);
    // ຢືນຢັນ "ຕົວຕົນ" ຂອງຄລິບທີ່ຕໍ່ເຂົ້າ ບໍ່ແມ່ນພຽງ "ຕຳແໜ່ງ"
    if (!(await verifyClipIdentity(pg, fpsAfter, n + 1))) { await b.close(); process.exit(6); }
    // ຢຸດວຽກສະເພາະເມື່ອ "ແນ່ໃຈ" ວ່າລຳດັບຜິດເທົ່ານັ້ນ:
    //   ຄລິບເກົ່າຢູ່ຄົບທຸກອັນ + ມີອັນໃໝ່ 1 ອັນ ແຕ່ອັນໃໝ່ບໍ່ໄດ້ຢູ່ທ້າຍສຸດ
    // ນອກນັ້ນ (ອ່ານຮູບບໍ່ຄົບ/ຮູບປ່ຽນ) ຖືວ່າ "ກວດບໍ່ໄດ້" ແລ້ວໄປຕໍ່ —
    // ຢ່າໃຫ້ການກວດທີ່ບໍ່ແນ່ໃຈມາກັ້ນບໍ່ໃຫ້ຜູ້ໃຊ້ໄດ້ວິດີໂອ.
    // ຈັບຄູ່ແບບຜ່ອນຜັນ (aHash) ແທນການທຽບເທົ່າກັນເປະໆ
    const usedBefore = new Set();
    const matchIdx = fpsAfter.map(f => {
      for (let i = 0; i < fpsBefore.length; i++) {
        if (!usedBefore.has(i) && sameClip(f, fpsBefore[i])) { usedBefore.add(i); return i; }
      }
      return -1;
    });
    const missing = fpsBefore.filter((_, i) => !usedBefore.has(i));
    const added = fpsAfter.filter((_, i) => matchIdx[i] < 0);
    const lengthsOk = fpsBefore.length === n && fpsAfter.length === n + 1;

    if (lengthsOk && missing.length === 0 && added.length === 1) {
      const newAt = matchIdx.findIndex(m => m < 0);
      const oldInOrder = matchIdx.slice(0, n).every((m, i) => m === i);
      if (newAt === n && oldInOrder) {
        log(`  ກວດລຳດັບຫຼັງເພີ່ມຄລິບ ${n + 1}: ຕໍ່ທ້າຍຖືກຕ້ອງ ✓`);
      } else {
        const at = newAt + 1;
        log(`NOT VERIFIED: ຄລິບໃໝ່ໄປຢູ່ຕຳແໜ່ງ ${at} ບໍ່ແມ່ນທ້າຍສຸດ — ຢຸດກ່ອນດາວໂຫຼດ`);
        sendEv('COMBINE_MANUAL', {
          reason: `clip ${n + 1} inserted at position ${at} instead of the end`,
          before: fpsBefore, after: fpsAfter, url: pg.url(),
        });
        await b.close(); process.exit(6);
      }
    } else {
      orderVerified = false;
      log(`  ກວດລຳດັບຄລິບ ${n + 1} ບໍ່ໄດ້ — ສືບຕໍ່ ແຕ່ບໍ່ຢືນຢັນລຳດັບ`);
      log(`    ລາຍລະອຽດ: ກ່ອນ=${fpsBefore.length}/${n} [${fpsBefore.join(',')}] ຫຼັງ=${fpsAfter.length}/${n + 1} [${fpsAfter.join(',')}] ຫາຍ=${missing.length} ໃໝ່=${added.length}`);
      sendEv('COMBINE_ORDER_UNVERIFIED', { after: n + 1, url: pg.url() });
    }
    activeSceneUrl = pg.url();
    stage('ກວດລຳດັບສຳເລັດ');
    sendEv('CLIP_ADDED', { n: n + 1, url: pg.url() });
  }

  // 3) ກວດວ່າໄດ້ຄົບຕາມຈຳນວນກ່ອນດາວໂຫຼດ
  await restoreScene();
  const made = await pg.locator('div.cdk-drop-list > div.cdk-drag').count().catch(() => 0);
  log(`ຄລິບໃນ scene: ${made}/${titles.length}`);
  if (made !== titles.length) {
    log('ຈຳນວນຄລິບບໍ່ຄົບ — ບໍ່ດາວໂຫຼດ ກວດໃນ Flow ເອງ');
    sendEv('COMBINE_MANUAL', { reason: `scene has ${made}/${titles.length} clips`, url: pg.url() });
    await b.close(); process.exit(5);
  }

  // Counting clips never caught a jumbled scene, so compare the order actually
  // built against the requested 1→2→3 before exporting anything.
  // Validate the order users will actually see/play (left → right), not DOM
  // order.  CDK drag transforms can make those two orders different.
  // ລຳດັບຖືກຢືນຢັນມາແລ້ວທຸກຄັ້ງທີ່ເພີ່ມຄລິບ (ຄລິບໃໝ່ຕ້ອງໄປຕໍ່ທ້າຍ ແລະ ຂອງເກົ່າ
  // ບໍ່ຖືກແຊກ). ຖ້າທຸກຮອບຜ່ານ = ລຳດັບ 1→2→3 ຖືກຕ້ອງ.
  if (orderVerified) {
    log(`ລຳດັບ 1→${titles.length} ຖືກຕ້ອງ (ຢືນຢັນດ້ວຍຮູບຕົວຢ່າງທຸກຄັ້ງທີ່ເພີ່ມ)`);
  } else {
    log('ບາງຮອບກວດລຳດັບບໍ່ໄດ້ — ສົ່ງອອກຕໍ່ ແຕ່ໝາຍວ່າ "ບໍ່ໄດ້ກວດລຳດັບ"');
    sendEv('COMBINE_ORDER_UNVERIFIED', { url: pg.url() });
  }

  const saved = await exportSceneToFile(b, pg, outFile, requestedOut, titles.length);
  if (saved === null) return;
  sendEv('COMBINE_DONE', { clips: titles.length, file: saved, url: pg.url() });
  await b.close();
}

// ເກົ່າ: ຊອກປຸ່ມຊື່ "Combine/รวม" ທີ່ Flow ບໍ່ເຄີຍມີ — ເກັບໄວ້ເປັນທາງຖອຍ
async function cmdCombine() {
  const b = await connect();
  const pg = await findFlowPage(b);
  try {
    await pg.bringToFront().catch(() => {});
    await sleep(1500);
    // ກອງເບິ່ງສະເພາະວິດີໂອໃນແຖບຊ້າຍ ເພື່ອນັບຄລິບໃຫ້ຖືກ
    const vidTab = pg.locator('button:has-text("วิดีโอ"), button:has-text("Video")').first();
    if (await vidTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await vidTab.click().catch(() => {});
      await sleep(2500);
    }
    const clips = await snapshotAssets(pg);
    log(`ຄລິບໃນ project: ${clips.length}`);

    // ຫາປຸ່ມລວມ — Flow ຮຸ່ນນີ້ອາດບໍ່ມີ
    const combineBtn = pg.locator(sel.combineButton).first();
    if (await combineBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await combineBtn.click().catch(() => {});
      await sleep(3000);
      log('ສົ່ງຄຳສັ່ງລວມຄລິບແລ້ວ');
      sendEv('COMBINE_DONE', { ok: true, clips: clips.length });
    } else {
      log('Flow ຮຸ່ນນີ້ບໍ່ມີປຸ່ມລວມຄລິບ — ດາວໂຫຼດ 3 ຄລິບແລ້ວຕໍ່ກັນໃນໂປຣແກຣມຕັດຕໍ່');
      sendEv('COMBINE_MANUAL', { reason: 'no combine control in Flow', clips: clips.length });
    }
  } catch (e) {
    log('ລວມຄລິບບໍ່ສຳເລັດ:', e && e.message || e);
    sendEv('COMBINE_MANUAL', { reason: String(e && e.message || e) });
  }
  await b.close();
}


// ຍິງຫຼາຍ prompt ໃນ browser session ດຽວ.
// ສົ່ງວຽກໃຫ້ຄົບກ່ອນ ແລ້ວຈຶ່ງລໍ/ກວດຜົນຮວມຄັ້ງດຽວ.
async function cmdFlowBatch() {
  const kind = process.argv[3];
  const files = (process.argv[4] || '').split(',').filter(Boolean);
  // ຮັບໄດ້ຫຼາຍຮູບ (ຄັ່ນດ້ວຍ ,): ຮູບສິນຄ້າກ່ອນ ແລ້ວຮູບຄົນ. ຮອງຮັບຮູບດຽວແບບເກົ່າ.
  const refPaths = (process.argv[5] || '').split(',').filter(Boolean);
  const refPath = refPaths[0] || '';
  const lockUrl = process.argv[6] || '';
  const startNo = Number(process.argv[7] || 1); // ເລກແຜ່ນຂອງໄຟລ໌ທຳອິດ (ສຳລັບການລອງໃໝ່)
  const sourceFiles = (process.argv[8] || '').split(',').filter(Boolean); // ສຳລັບ video: storyboard ແຍກຕາມ clip
  const b = await connect();
  let pg = lockUrl ? await findLockedFlowPage(b, lockUrl) : await findFlowPage(b, 0);
  if (!pg || (lockUrl && flowProjectBase(pg.url()) !== flowProjectBase(lockUrl))) {
    log('NOT VERIFIED: ບໍ່ສາມາດກັບເຂົ້າ project ເດີມທີ່ສ້າງ Storyboard');
    sendEv('NOT_VERIFIED', { kind, reason: 'locked storyboard project could not be reopened', lockUrl });
    await b.close(); process.exit(7);
  }
  if (lockUrl) log(`ຢືນຢັນ project ເດີມແລ້ວ: ${flowProjectBase(pg.url())}`);

  if (!(await ensureFlowComposer(pg))) {
    log('NOT VERIFIED: Flow ບໍ່ເປີດ session composer');
    sendEv('NOT_VERIFIED', { kind, reason: 'Flow session composer is unavailable' });
    await b.close(); process.exit(7);
  }

  const batchSettingsVerified = await setFlowSettings(pg, kind); // ເທື່ອດຽວສຳລັບທັງຊຸດ
  if (!batchSettingsVerified) {
    sendEv('NOT_VERIFIED', { kind, reason: 'Flow settings could not be verified before batch generation' });
    await b.close();
    process.exit(7);
  }

  // ຈື່ gallery ກ່ອນສົ່ງທັງ batch ເພື່ອກວດ output ຮວມຄັ້ງດຽວ.
  const before = new Set(await settledSnapshot(pg));
  const imageAssetsBySheet = [];
  if (kind === 'image' && startNo > 1) {
    try {
      const old = JSON.parse(fs.readFileSync(path.join(DATA, 'storyboard-assets.json'), 'utf8'));
      if ((!lockUrl || !old.projectUrl || flowProjectBase(old.projectUrl) === flowProjectBase(lockUrl))) {
        imageAssetsBySheet.push(...(old.assets || []).filter(x => x.sheet < startNo && x.url));
      }
    } catch { /* retry can continue only with assets recorded in this run */ }
  }
  const beforeVideoTitles = kind === 'video' ? await videoTitles(pg) : null;
  // ຊຸດຮູບຕົວຢ່າງຄລິບທີ່ມີຢູ່ກ່ອນແລ້ວ — ໃຊ້ຫາວ່າຄລິບໃໝ່ແມ່ນອັນໃດ
  const beforeClipSrcs = new Set(
    kind === 'video' ? (await libraryVideoFingerprints(pg)).map(x => x.src).filter(Boolean) : []
  );

  // ຊື່ທີ່ Flow ຕັ້ງໃຫ້ແຕ່ລະແຜ່ນ storyboard (ເກັບໄວ້ຕອນຂັ້ນສ້າງຮູບ) — ໃຊ້ຄົ້ນຫາ
  // asset ທີ່ມີຢູ່ແລ້ວໃນໂປຣເຈັກ ແທນການອັບໄຟລ໌ຂຶ້ນໃໝ່ທຸກເທື່ອ
  // ສຳຄັນ: Flow ຕັ້ງຊື່ແຜ່ນເອງ ແລະ **ຕັ້ງຊື່ຄືກັນໄດ້** ໃຫ້ຫຼາຍແຜ່ນ
  // (ວັດແທ້: ແຜ່ນ 1 ແລະ ແຜ່ນ 3 ຕ່າງກໍຊື່ "Coffee commercial storyboard sheet").
  // ການຄົ້ນຫາດ້ວຍຊື່ແລ້ວເອົາອັນທຳອິດ ຈຶ່ງເອົາແຜ່ນຜິດໄປສ້າງຄລິບ — ຮູບໃນຄລິບ
  // ບໍ່ຕົງກັບສາກ ແຕ່ຊື່ຄລິບຍັງເບິ່ງຖືກ ຈຶ່ງເປັນເຫດທີ່ວິດີໂອລວມລຳດັບຜິດ.
  // ສະນັ້ນ: ຊື່ທີ່ຊ້ຳກັນ = ໃຊ້ບໍ່ໄດ້ ຕ້ອງອັບໄຟລ໌ຂຶ້ນໃໝ່ສະເພາະແຜ່ນນັ້ນ.
  const sheetLabels = {};
  if (kind === 'video') {
    try {
      const man = JSON.parse(fs.readFileSync(path.join(DATA, 'storyboard-assets.json'), 'utf8'));
      // ບັນຊີແຜ່ນຕ້ອງເປັນຂອງໂປຣເຈັກນີ້ ບໍ່ດັ່ງນັ້ນເປັນຊື່ເກົ່າຂອງສິນຄ້າອື່ນ
      const sameProject = !lockUrl || !man.projectUrl
        || man.projectUrl.split('?')[0] === lockUrl.split('?')[0];
      if (!sameProject) {
        log('ບັນຊີແຜ່ນ storyboard ເປັນຂອງໂປຣເຈັກອື່ນ — ບໍ່ໃຊ້ ຈະອັບໄຟລ໌ຄືເກົ່າ');
      } else {
        const counts = {};
        for (const a of man.assets || []) if (a && a.label) counts[a.label] = (counts[a.label] || 0) + 1;
        for (const a of man.assets || []) {
          if (!a || !a.sheet || !a.label) continue;
          if (counts[a.label] > 1) {
            log(`ແຜ່ນ ${a.sheet}: ຊື່ "${a.label}" ຊ້ຳກັບແຜ່ນອື່ນ — ບໍ່ໃຊ້ຊື່ ຈະອັບໄຟລ໌ແຜ່ນນີ້ຂຶ້ນໃໝ່`);
            continue;
          }
          sheetLabels[a.sheet] = a.label;
        }
        const got = Object.keys(sheetLabels).length;
        log(got ? `ມີຊື່ແຜ່ນ storyboard ທີ່ບໍ່ຊ້ຳ ${got}/3 — ແຜ່ນນັ້ນໃຊ້ຂອງເກົ່າ ບໍ່ອັບຊ້ຳ`
                : 'ບໍ່ມີຊື່ແຜ່ນທີ່ໃຊ້ໄດ້ — ຈະອັບໄຟລ໌ຄືເກົ່າ');
      }
    } catch { log('ອ່ານ storyboard-assets.json ບໍ່ໄດ້ — ຈະອັບໄຟລ໌ຄືເກົ່າ'); }
  }
  const clipTitlesByScene = [];
  const waitGenerateReady = async (n) => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const ready = await pg.locator(sel.generateButton).first().evaluate(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true').catch(() => false);
      if (ready) return true;
      await sleep(700);
    }
    log(`ວຽກ ${n}: Flow ບໍ່ພ້ອມຮັບ prompt ຕໍ່ໄປ`);
    return false;
  };

  for (let i = 0; i < files.length; i++) {
    const n = startNo + i;
    const text = fs.readFileSync(files[i], 'utf8');
    log(`${kind === 'video' ? 'ຄລິບ' : 'ແຜ່ນ'} ${n} — ສົ່ງເຂົ້າ Flow (${i + 1}/${files.length})`);

    await pg.locator(sel.clearPrompt).first().click({ timeout: 5000 }).catch(() => {});
    await sleep(400);
    // ວິດີໂອໃຊ້ storyboard sheet + product reference ຄື workflow ເດີມ.
    const sourcePath = sourceFiles[i] || '';
    if (kind === 'video') {
      if (!sourcePath || !fs.existsSync(sourcePath) || !(await attachProductImage(pg, sourcePath, { assetLabel: sheetLabels[n] }))) {
        log(`NOT VERIFIED: ຄລິບ ${n} ບໍ່ມີ storyboard reference ທີ່ Flow ຮັບໄດ້`);
        sendEv('REFERENCE_MISSING', { kind, n, reason: 'storyboard source missing or not accepted' });
        await b.close(); process.exit(7);
      }
      log(`ຄລິບ ${n}: ແນບ storyboard sheet ແລ້ວ`);
    }
    // ແນບຮູບອ້າງອີງທັງໝົດຕາມລຳດັບ: ຮູບສິນຄ້າກ່ອນ ແລ້ວຮູບຄົນ (ໂໝດຄົນລິວິວ/ຂາຍຄອດ).
    // ຮູບທຳອິດບັງຄັບ (ສິນຄ້າ ຫຼື ຄົນຫຼັກ); ຮູບຕໍ່ໄປ best-effort — Flow ອາດຈຳກັດ
    // ຈຳນວນ reference, ຖ້າແນບຮູບໃດບໍ່ໄດ້ ໃຫ້ຢຸດເພີ່ມ ແລ້ວໃຊ້ເທົ່າທີ່ແນບສຳເລັດ.
    if (!refPaths.length) {
      log(`NOT VERIFIED: ${kind === 'video' ? 'ຄລິບ' : 'ແຜ່ນ'} ${n} ບໍ່ມີຮູບອ້າງອີງ`);
      sendEv('REFERENCE_MISSING', { kind, n, reason: 'no reference images provided' });
      await b.close(); process.exit(7);
    }
    let attachedRefs = 0;
    for (let r = 0; r < refPaths.length; r++) {
      const rp = refPaths[r];
      const okRef = rp && fs.existsSync(rp) && await attachProductImage(pg, rp);
      if (okRef) { attachedRefs++; continue; }
      if (r === 0) {
        log(`NOT VERIFIED: ${kind === 'video' ? 'ຄລິບ' : 'ແຜ່ນ'} ${n} ບໍ່ມີ reference ຫຼັກທີ່ຍອມຮັບ`);
        sendEv('REFERENCE_MISSING', { kind, n, reason: 'primary reference missing or not accepted' });
        await b.close(); process.exit(7);
      }
      log(`  ຮູບອ້າງອີງທີ ${r + 1} ແນບບໍ່ໄດ້ (ອາດຮອດຂີດຈຳກັດ Flow) — ໃຊ້ ${attachedRefs} ຮູບ`);
      break;
    }
    if (refPaths.length > 1) log(`ແນບຮູບອ້າງອີງ ${attachedRefs}/${refPaths.length} ຮູບ`);
    await pg.locator(sel.promptBox).first().click({ timeout: 20000 });
    await pg.keyboard.press('ControlOrMeta+a');   // Meta+a ແມ່ນປຸ່ມ Windows ໃນ Windows — select-all ບໍ່ເຮັດວຽກ
    await sleep(100);
    await pg.keyboard.press('Backspace');
    await sleep(200);
    await pg.keyboard.insertText(text);
    await sleep(500);
    if (kind === 'video') {
      try {
        const current = JSON.parse(fs.readFileSync(path.join(DATA, 'job.json'), 'utf8'));
        if ((current.videoSubmitted || {})[n] === current.projectUrl) {
          sendEv('NOT_VERIFIED', { kind, n, reason: `clip ${n} already submitted; refusing duplicate` });
          await b.close(); process.exit(7);
        }
      } catch { /* job may be unavailable; server still tracks submissions */ }
    }
    if (!(await waitGenerateReady(n))) { sendEv('FLOW_TIMEOUT', { kind, n, stage: 'submit' }); await b.close(); process.exit(4); }
    const policyCountBefore = kind === 'image'
      ? await pg.locator(sel.policyErrorBanner).count().catch(() => 0) : 0;
    await pg.locator(sel.generateButton).first().click({ timeout: 15000 });
    sendEv('JOB_SUBMITTED', { kind, n, submitted: i + 1, total: files.length });

    // Video completion is polled below; check policy in that same loop instead
    // of adding a separate unconditional eight-second wait per clip.
    const policyErr = kind === 'video' ? null : await checkPolicyError(pg, 8000);
    if (policyErr) {
      log(`ແຜ່ນ ${n}: Flow ປະຕິເສດ (policy):`, policyErr);
      sendEv('POLICY_ERROR', { kind, n, reason: policyErr });
      await b.close();
      process.exit(3);
    }

    // Image jobs must be mapped to their exact sheet.  Gallery order is not a
    // stable contract and a product reference/packshot must never be guessed as
    // Storyboard 1/2/3.  Wait for exactly this submission's new asset before
    // sending the next sheet, then persist the URL-to-sheet mapping.
    if (kind === 'image') {
      const known = new Set([...before, ...imageAssetsBySheet.map(x => x.url)]);
      const imageDeadline = Date.now() + 360000;
      let added = [];
      let firstPoll = true;
      while (Date.now() < imageDeadline) {
        // ເຊັກກ່ອນລໍ ແລະ ລໍຖີ່ຂຶ້ນ — ເມື່ອກ່ອນລໍ 1.5 ວິກ່ອນເຊັກທຸກຮອບ
        // ເຮັດໃຫ້ຮູ້ຜົນຊ້າກວ່າຄວາມຈິງເຖິງ 1.5 ວິຕໍ່ຮູບ
        if (!firstPoll) await sleep(700);
        firstPoll = false;
        const policyCountNow = await pg.locator(sel.policyErrorBanner).count().catch(() => 0);
        if (policyCountNow > policyCountBefore) {
          const reason = (await pg.locator(sel.policyErrorBanner).nth(policyCountBefore).innerText().catch(() => 'policy violation')).slice(0, 200);
          sendEv('POLICY_ERROR', { kind, n, reason }); await b.close(); process.exit(3);
        }
        added = (await snapshotAssets(pg)).filter(u => !known.has(u));
        if (added.length === 1) break;
        if (added.length > 1) {
          sendEv('NOT_VERIFIED', { kind, n, reason: `sheet asset mapping is ambiguous: ${added.length} new images` });
          await b.close(); process.exit(7);
        }
      }
      if (added.length !== 1) {
        sendEv('FLOW_TIMEOUT', { kind, n, completed: 0, expected: 1 });
        await b.close(); process.exit(4);
      }
      // Save the exact mapped image now, before Flow rewrites its URL on the
      // next reload.  This makes the video stage independent of gallery order
      // and rotating /asb/ asset URLs.
      let localFile = '', tileLabel = '';
      const mappedIndex = await pg.evaluate(u => {
        const canonical = s => String(s || '').split('?')[0];
        const wanted = canonical(u);
        return Array.from(document.querySelectorAll('img')).findIndex(img =>
          [img.currentSrc, img.getAttribute('src')].filter(Boolean).some(src => canonical(src) === wanted));
      }, added[0]).catch(() => -1);
      if (mappedIndex >= 0) {
        // Flow ປັກ URL ສຸດທ້າຍໃສ່ gallery tile ກ່ອນ bitmap ຈິງຈະໂຫຼດແລ້ວແລ້ວ — ຖ່າຍ
        // ທັນທີອາດໄດ້ແຕ່ placeholder (ໄອຄອນຮູບແຕກ + ເປີເຊັນ) ແທນຮູບ storyboard ແທ້.
        // ລໍໃຫ້ <img> ນີ້ complete ແລະ ມີ naturalWidth ພໍສົມຄວນກ່ອນຖ່າຍ.
        const imgReady = async () => pg.locator('img').nth(mappedIndex).evaluate(el => el.complete && el.naturalWidth > 50).catch(() => false);
        let ready = await imgReady();
        for (let w = 0; !ready && w < 10; w++) { await sleep(1000); ready = await imgReady(); }
        if (!ready) log(`ແຜ່ນ ${n}: ຮູບຍັງບໍ່ໂຫຼດຄົບ ຫຼັງລໍ 10 ວິ — ຖ່າຍເທົ່າທີ່ມີ`);
        const candidate = path.join(DATA, `sb-sheet-${n}.png`);
        await pg.locator('img').nth(mappedIndex).screenshot({ path: candidate, type: 'png', animations: 'disabled' }).catch(() => {});
        if (fs.existsSync(candidate) && fs.statSync(candidate).size >= 4000) localFile = candidate;
        // ຈື່ຊື່ທີ່ Flow ຕັ້ງໃຫ້ແຜ່ນນີ້ (ເຊັ່ນ "SD Plus storyboard sheet").
        // ຊື່ໄຟລ໌ sb-sheet-N.png ມີແຕ່ໃນເຄື່ອງເຮົາ Flow ບໍ່ເຄີຍຮູ້ຈັກ ສະນັ້ນຂັ້ນ
        // ວິດີໂອຈຶ່ງຄົ້ນຫາບໍ່ເຈີແລ້ວອັບຊ້ຳທຸກເທື່ອ. ເກັບຊື່ນີ້ໄວ້ໃຫ້ຂັ້ນວິດີໂອໃຊ້ຄົ້ນ.
        tileLabel = await pg.locator('img').nth(mappedIndex).evaluate(el => {
          const t = el.closest('flow-grid-tile-container, [aria-label]');
          return (t && t.getAttribute && t.getAttribute('aria-label')) || '';
        }).catch(() => '');
        if (tileLabel) log(`ແຜ່ນ ${n}: ຊື່ໃນ Flow = "${tileLabel}"`);
      }
      if (!localFile) {
        sendEv('NOT_VERIFIED', { kind, n, reason: 'exact storyboard image could not be persisted before URL rotation' });
        await b.close(); process.exit(7);
      }
      const oldIndex = imageAssetsBySheet.findIndex(x => x.sheet === n);
      if (oldIndex >= 0) imageAssetsBySheet.splice(oldIndex, 1);
      imageAssetsBySheet.push({ sheet: n, url: added[0], file: localFile, label: tileLabel });
      imageAssetsBySheet.sort((a, b) => a.sheet - b.sheet);
      fs.writeFileSync(path.join(DATA, 'storyboard-assets.json'), JSON.stringify({ projectUrl: lockUrl, assets: imageAssetsBySheet }, null, 2));
      sendEv('SHEET_ASSET', { sheet: n, url: added[0] });
      sendEv('SHEET_DONE', { n });
      log(`ແຜ່ນ ${n}: ຈັບຄູ່ asset ສຳເລັດແລ້ວ`);
    }

    // Flow may finish parallel video jobs in a different order than they were
    // submitted.  For video batches, wait for this job's new asset before
    // submitting the next one so gallery order remains Clip 1 -> Clip 2 ->
    // Clip 3.  Images remain batched for speed.
    if (kind === 'video') {
      const expected = i + 1;
      let completed = 0;
      let newTitles = [];
      let firstClipPoll = true;
      // ງົບເວລາຕໍ່ຄລິບ — ກ່ອນນີ້ loop ນີ້ບໍ່ມີ deadline ຈຶ່ງຄ້າງຕະຫຼອດໄປເມື່ອ Flow
      // ບໍ່ສ້າງຄລິບ (ມັກເກີດກັບຄລິບ 3: ສົ່ງແລ້ວ ແຕ່ Flow ບໍ່ອອກຜົນ) → ບັອດຄ້າງຢູ່ 2/3.
      // ຕອນນີ້ timeout ແລ້ວອອກ code 4 ເພື່ອໃຫ້ກູ້ຕໍ່ໄດ້ (ປຸ່ມ "ກວດ/ຕໍ່ຄລິບ").
      const clipWaitDeadline = Date.now() + 600000; // 10 ນາທີ/ຄລິບ
      // Wait for the actual video tile. A policy banner is only a transient
      // response to one prompt; the user may repair that clip in Flow. Keep
      // watching the same project and submit the next clip when it appears.
      while (true) {
        // ເຊັກກ່ອນລໍ ແລະ ລໍຖີ່ຂຶ້ນ (2.5 ວິ → 1.2 ວິ) ຮູ້ຜົນໄວຂຶ້ນຕໍ່ຄລິບ
        if (!firstClipPoll) await sleep(1200);
        firstClipPoll = false;
        if (Date.now() > clipWaitDeadline) {
          log(`ຄລິບ ${n}: ລໍ ${Math.round(600000 / 60000)} ນາທີ ແຕ່ Flow ບໍ່ອອກຄລິບ — ຢຸດ (ກູ້ຕໍ່ໄດ້ດ້ວຍປຸ່ມ "ກວດ/ຕໍ່ຄລິບ")`);
          sendEv('FLOW_TIMEOUT', { kind, n, stage: 'await-clip', completed, expected });
          await b.close(); process.exit(4);
        }
        if (lockUrl && flowProjectBase(pg.url()) !== flowProjectBase(lockUrl)) {
          pg = await findLockedFlowPage(b, lockUrl) || pg;
          const videoTab = pg.locator('button').filter({ hasText: /videocam/ }).first();
          if (await videoTab.isVisible({ timeout: 4000 }).catch(() => false)) await videoTab.click().catch(() => {});
        }
        const currentTitles = await videoTitles(pg);
        newTitles = subtractOccurrences(currentTitles, beforeVideoTitles);
        const prevCompleted = completed;
        completed = newTitles.length;
        // ລາຍງານສະເພາະຕອນຕົວເລກປ່ຽນ — ການລາຍງານທຸກຮອບ (ທຸກ 1.2 ວິ)
        // ເຮັດໃຫ້ log ເຕັມໄປດ້ວຍແຖວຊ້ຳ ແລ້ວປະຫວັດທີ່ຕ້ອງການຫາຍໄປ
        if (completed !== prevCompleted || firstClipPoll) {
          sendEv('VIDEO_PROGRESS', { submitted: expected, completed, total: files.length });
        }
        if (completed >= expected) break;
      }
      if (newTitles.length !== expected) {
        sendEv('NOT_VERIFIED', { kind, n, reason: `expected ${expected} new clip titles, saw ${newTitles.length}` });
        await b.close(); process.exit(7);
      }
      const unmapped = subtractOccurrences(newTitles, clipTitlesByScene);
      const title = unmapped[0];
      if (!title || unmapped.length !== 1) {
        sendEv('NOT_VERIFIED', { kind, n, reason: 'clip title cannot be mapped uniquely to scene' });
        await b.close(); process.exit(7);
      }
      clipTitlesByScene.push(title);
      // ຈື່ "ຮູບ" ຂອງຄລິບນີ້ໄວ້ນຳ — ຕອນລວມຈະໄດ້ຢືນຢັນວ່າຄລິບທີ່ຕໍ່ເຂົ້າ
      // ແມ່ນສາກນີ້ແທ້ ບໍ່ແມ່ນເຊື່ອຊື່ຢ່າງດຽວ (ຊື່ຊ້ຳກັນໄດ້)
      // ແຜ່ນຄລິບທີ່ຫາກໍສຳເລັດອາດຍັງບໍ່ມີ <img> — ຕ້ອງລໍຮູບກ່ອນ ບໍ່ດັ່ງນັ້ນ
      // ສາກນີ້ຈະບໍ່ມີລາຍນິ້ວມື ແລ້ວຕອນລວມກໍກວດຕົວຕົນບໍ່ໄດ້
      let fp = '';
      for (let attempt = 1; attempt <= 6 && !fp; attempt++) {
        try {
          const lib = await libraryVideoFingerprints(pg);
          const fresh = lib.filter(x => x.src && x.fp && !beforeClipSrcs.has(x.src));
          const mine = fresh.filter(x => sameTitle(x.label, title));
          const chosen = mine.length === 1 ? mine[0] : (fresh.length === 1 ? fresh[0] : null);
          if (chosen) { fp = chosen.fp; beforeClipSrcs.add(chosen.src); break; }
          if (attempt === 6) log(`  ຄລິບ ${n}: ບອກບໍ່ໄດ້ວ່າຮູບໃດເປັນຂອງມັນ (ໃໝ່ ${fresh.length} ອັນ) — ຈະບໍ່ມີລາຍນິ້ວມື`);
        } catch { /* ບໍ່ມີລາຍນິ້ວມື ກໍຍັງເຮັດວຽກຕໍ່ໄດ້ຄືເກົ່າ */ }
        await sleep(1500);
      }
      sendEv('CLIP_TITLE', { n, title, fp });
      log(`ຄລິບ ${n} ສຳເລັດແລ້ວ — ຈຶ່ງສົ່ງຄລິບຕໍ່ໄປ`);
    }

  }

  // ສົ່ງຄົບແລ້ວຈຶ່ງລໍຜົນຮວມ. ບໍ່ລໍທີລະວຽກ.
  //
  // ສຳລັບວິດີໂອ ຕ້ອງນັບດ້ວຍ "ຊື່ຄລິບ" ບໍ່ແມ່ນ "ຮູບຕົວຢ່າງ":
  // ວັດຈາກ Flow ແທ້ — ຄລິບສຳເລັດແລ້ວ ແຕ່ແຜ່ນຂອງມັນ **ບໍ່ມີ <img> ໃນໜ້າ**
  // (ຮູບໂຫຼດຊ້າ ຫຼື ຖືກປ່ອຍຄືນຕອນ grid ແຕ້ມໃໝ່). ການນັບດ້ວຍຮູບຈຶ່ງໄດ້ 2/3
  // ຕະຫຼອດ 15 ນາທີ ແລ້ວວຽກຕາຍຄາທີ່ບໍ່ໄດ້ຕໍ່ຄລິບ ທັງທີ່ຄລິບມີຄົບ 3 ອັນແທ້.
  // ຮອບລໍທີລະຄລິບຂ້າງເທິງກວດດ້ວຍຊື່ຢູ່ແລ້ວ ແລະ ຈັບຄູ່ຊື່ກັບສາກໄດ້ຄົບ
  // ຈຶ່ງເອົາມາເປັນຕົວວັດອັນດຽວກັນ ບໍ່ໃຫ້ສອງຂັ້ນວັດຄົນລະຢ່າງ.
  const deadline = Date.now() + (kind === 'video' ? 900000 : 360000);
  let fresh = [];
  if (kind === 'video' && clipTitlesByScene.length >= files.length) {
    fresh = clipTitlesByScene.slice();
    log(`ຄລິບຄົບ ${fresh.length}/${files.length} ແລ້ວ (ຢືນຢັນດ້ວຍຊື່ຕອນສ້າງ) — ບໍ່ຕ້ອງລໍຮູບຕົວຢ່າງ`);
    sendEv('BATCH_PROGRESS', { kind, submitted: files.length, completed: fresh.length, total: files.length });
  }
  while (fresh.length < files.length && Date.now() < deadline) {
    await sleep(kind === 'video' ? 2500 : 1200);
    if (kind === 'video') {
      fresh = subtractOccurrences(await videoTitles(pg), beforeVideoTitles);
    } else {
      const now = await snapshotAssets(pg);
      fresh = kind === 'image' ? imageAssetsBySheet.map(x => x.url) : now.filter(u => !before.has(u));
    }
    sendEv('BATCH_PROGRESS', { kind, submitted: files.length, completed: fresh.length, total: files.length });
  }
  if (fresh.length < files.length) {
    log(`batch ${kind}: ໄດ້ຜົນ ${fresh.length}/${files.length} ເທົ່ານັ້ນ`);
    sendEv('FLOW_TIMEOUT', { kind, completed: fresh.length, expected: files.length });
    await b.close(); process.exit(4);
  }
  log(`batch ${kind}: ສຳເລັດ ${fresh.length}/${files.length} ວຽກ — ກວດຮວມຕໍ່`);
  sendEv('BATCH_DONE', { kind, count: files.length, added: fresh.length });
  await b.close();
}



// ດຶງແຜ່ນ storyboard ຈາກ Flow ລົງເຄື່ອງ — ເພື່ອໃຫ້ຂັ້ນວິດີໂອແນບກັບຄືນໄດ້
// ແຜ່ນໃນ gallery ຮຽງໃໝ່ສຸດກ່ອນ ຈຶ່ງຕ້ອງກັບລຳດັບໃຫ້ເປັນແຜ່ນ 1,2,3
async function cmdPullSheets() {
  const want = Number(process.argv[3] || 3);
  const outDir = process.argv[4] || DATA;
  const lockUrl = process.argv[5] || ''; // ບັງຄັບໃຫ້ຢູ່ project ທີ່ຖືກ — ແທັບມັກຍ້າຍເອງ
  const b = await connect();
  const pg = (listFlowPages(b) || [])[0];
  if (!pg) { log('ບໍ່ພົບແທັບ Flow'); sendEv('SHEETS_PULLED', { files: [] }); await b.close(); process.exit(2); }
  await pg.bringToFront().catch(() => {});
  if (lockUrl && !pg.url().startsWith(lockUrl.split('?')[0])) {
    log('ແທັບຢູ່ project ອື່ນ — ພາກັບ');
    await pg.goto(lockUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  } else {
    await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await sleep(6000);
  // ກອງໃຫ້ເປັນ "ຮູບພາບ" ເພື່ອບໍ່ໃຫ້ຕິດແຖບວິດີໂອຈາກຂັ້ນລວມຄລິບ
  const imgTab = pg.locator('button').filter({ hasText: /รูปภาพ|Images|ຮູບພາບ/ }).first();
  if (await imgTab.isVisible({ timeout: 4000 }).catch(() => false)) { await imgTab.click().catch(() => {}); await sleep(3000); }
  const manifestPath = path.join(DATA, 'storyboard-assets.json');
  let mapped = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!lockUrl || !manifest.projectUrl || flowProjectBase(manifest.projectUrl) === flowProjectBase(lockUrl)) {
      mapped = (manifest.assets || []).filter(x => Number.isInteger(x.sheet) && x.url).sort((a, b) => a.sheet - b.sheet);
    }
  } catch { /* old run without exact mapping */ }
  if (mapped.length < want) {
    log(`NOT VERIFIED: ບໍ່ມີ exact storyboard mapping ຄົບ ${want} ແຜ່ນ`);
    sendEv('SHEETS_PULLED', { files: [], reason: 'exact storyboard asset mapping missing' });
    await b.close(); process.exit(7);
  }
  const take = mapped.slice(0, want);
  // ຍົກເວັ້ນ tile ທີ່ aria-label ເປັນຊື່ໄຟລ໌ຕົງໆ (ຮູບສິນຄ້າທີ່ອັບໂຫລດ) ຄືກັນກັບ
  // snapshotAssets() — ບໍ່ດັ່ງນັ້ນ strictOrderRecovery ອາດກູ້ຄືນຮູບສິນຄ້າມາແທນ
  // storyboard sheet ແທ້.
  const livePortraits = await pg.evaluate(() => {
    const looksLikeFilename = s => /\.(jpe?g|png|webp|gif|heic)$/i.test(String(s || '').trim());
    return Array.from(document.querySelectorAll('img')).map((img, index) => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { const r = img.getBoundingClientRect(); w = r.width; h = r.height; }
      const tile = img.closest('flow-grid-tile-container, [aria-label]');
      const tileLabel = tile && tile.getAttribute ? tile.getAttribute('aria-label') : '';
      return { index, url: img.currentSrc || img.getAttribute('src') || '', w, h, isRef: looksLikeFilename(tileLabel) };
    }).filter(x => x.url && x.h >= 150 && x.w / x.h > 0.52 && x.w / x.h < 0.60 && !x.isRef);
  }).catch(() => []);
  // Flow rewrites a freshly-created flow-content URL to an /asb/ URL after a
  // reload.  If this project contains exactly the three mapped portrait
  // outputs (and no additional portrait output), DOM order is an unambiguous
  // recovery of Sheet 1 -> 2 -> 3.  Never use this fallback when extra assets
  // make the mapping ambiguous.
  const exactLiveMatches = take.map(x => livePortraits.find(y => String(y.url).split('?')[0] === String(x.url).split('?')[0]) || null);
  const strictOrderRecovery = exactLiveMatches.every(x => !x) && livePortraits.length === want && take.length === want;
  if (strictOrderRecovery) log('Flow ປ່ຽນ asset URL ຫຼັງ reload — ກູ້ mapping 1→2→3 ຈາກ 3 portrait outputs ທີ່ມີພຽງຊຸດດຽວ');
  const files = [];
  for (let i = 0; i < take.length; i++) {
    const sheetNo = take[i].sheet;
    const assetUrl = take[i].url;
    if (take[i].file && fs.existsSync(take[i].file) && fs.statSync(take[i].file).size >= 4000) {
      const source = take[i].file;
      const f = path.join(outDir, `sb-sheet-${sheetNo}.png`);
      if (path.resolve(source) !== path.resolve(f)) fs.copyFileSync(source, f);
      const bytes = fs.statSync(f).size;
      files.push({ sheet: sheetNo, file: f, kb: Math.round(bytes / 1024) });
      log(`ໃຊ້ exact saved sheet ${sheetNo} (${Math.round(bytes / 1024)} KB)`);
      continue;
    }
    // The manifest keeps a stable URL without its rotating query string so it
    // can map Sheet 1/2/3 reliably.  Downloading that bare URL, however, may
    // return a tiny redirect/error body.  Resolve it back to the exact live
    // <img> and use currentSrc (including signed query parameters).
    let live = await pg.evaluate(u => {
      const canonical = s => String(s || '').split('?')[0];
      const wanted = canonical(u);
      const imgs = Array.from(document.querySelectorAll('img'));
      const index = imgs.findIndex(img => {
        const candidates = [img.currentSrc, img.getAttribute('src')].filter(Boolean);
        return candidates.some(src => canonical(src) === wanted);
      });
      if (index < 0) return null;
      const img = imgs[index];
      return { index, url: img.currentSrc || img.getAttribute('src') || u };
    }, assetUrl).catch(() => null);
    if (!live && strictOrderRecovery) live = livePortraits[i];
    if (!live) { log(`ບໍ່ພົບຮູບຈິງຂອງແຜ່ນ ${sheetNo} ໃນ project`); continue; }

    const download = await pg.evaluate(async u => {
      try {
        const r = await fetch(u, { credentials: 'include', cache: 'no-store' });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !type.startsWith('image/')) return { b64: '', status: r.status, type };
        const buf = await r.arrayBuffer();
        let str = ''; const by = new Uint8Array(buf);
        for (let k = 0; k < by.length; k++) str += String.fromCharCode(by[k]);
        return { b64: btoa(str), status: r.status, type };
      } catch (e) { return { b64: '', status: 0, type: '', error: String(e) }; }
    }, live.url);
    const f = path.join(outDir, `sb-sheet-${sheetNo}.png`);
    let bytes = 0;
    if (download && download.b64 && download.type === 'image/png') {
      const buf = Buffer.from(download.b64, 'base64');
      if (buf.length >= 4000) { fs.writeFileSync(f, buf); bytes = buf.length; }
    }
    // Some Flow assets are deliberately protected from direct fetch.  An
    // element screenshot still captures the exact mapped storyboard image,
    // not the surrounding UI and not another gallery tile.
    if (!bytes) {
      const exactImage = pg.locator('img').nth(live.index);
      await exactImage.scrollIntoViewIfNeeded().catch(() => {});
      await exactImage.screenshot({ path: f, type: 'png', animations: 'disabled' }).catch(() => {});
      bytes = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (bytes < 4000) {
        try { fs.unlinkSync(f); } catch { /* nothing usable */ }
        log(`ດຶງແຜ່ນ ${sheetNo} ບໍ່ໄດ້ (HTTP ${download && download.status || 0}, ${download && download.type || 'unknown'})`);
        continue;
      }
      log(`ແຜ່ນ ${sheetNo}: ໃຊ້ exact element capture ເພາະ direct download ບໍ່ພ້ອມ`);
    }
    files.push({ sheet: sheetNo, file: f, kb: Math.round(bytes / 1024) });
    log(`ດຶງແຜ່ນ ${sheetNo} ແລ້ວ (${Math.round(bytes / 1024)} KB)`);
  }
  sendEv('SHEETS_PULLED', { files });
  await b.close();
}

// ແນບຮູບເຂົ້າແຊັດ AI — Claude ມີ input[type=file] ຢູ່ແລ້ວ ສ່ວນ Gemini ສ້າງຕອນກົດປຸ່ມອັບໂຫຼດ
async function attachToChat(pg, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  // Keep a DOM baseline. Gemini may retain the native input value even after
  // rejecting an upload, so input.files alone is not proof of an attachment.
  const before = await pg.evaluate(() => ({
    text: document.body.innerText || '',
    images: Array.from(document.images).map(i => i.currentSrc || i.getAttribute('src') || '').filter(Boolean),
  })).catch(() => ({ text: '', images: [] }));
  const pickInput = async () => {
    const img = pg.locator('input[type="file"][accept*="image"]').first();
    if (await img.count()) return img;
    const any = pg.locator('input[type="file"]').first();
    if (await any.count()) return any;
    return null;
  };
  let input = await pickInput();
  if (!input) {
    for (const t of ['button[aria-label="อัปโหลดและเครื่องมือ"]',
                     'button[aria-label*="อัปโหลด"]',
                     'button[aria-label*="Upload"]',
                     'button[aria-label*="Add files"]']) {
      const el = pg.locator(t).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click().catch(() => {});
        await sleep(2200);
        break;
      }
    }
    input = await pickInput();
  }
  if (!input) { log('ບໍ່ພົບຊ່ອງແນບໄຟລ໌ໃນແຊັດ AI'); return false; }
  try {
    await input.setInputFiles(filePath);
  } catch (e) {
    log(`ແນບຮູບໃຫ້ AI ບໍ່ໄດ້: ${e && e.message || e}`);
    return false;
  }
  // ລໍຈົນເຫັນຊື່ໄຟລ໌ ຫຼື ຮູບຕົວຢ່າງປາກົດໃນແຊັດ — ບໍ່ລໍຕາມໂມງ
  const base = path.basename(filePath);
  const stem = base.replace(/\.[^.]+$/, '');
  let seen = false;
  for (let i = 0; i < 24; i++) {         // ສູງສຸດ 12 ວິ
    await sleep(500);
    seen = await pg.evaluate(({ b, st, beforeText, beforeImages }) => {
      const t = document.body.innerText || '';
      // A filename/stem that appeared only after this upload is accepted.
      if ((t.includes(b) || t.includes(st)) && !(beforeText.includes(b) || beforeText.includes(st))) return true;
      return Array.from(document.images).some(i => {
        const src = i.currentSrc || i.getAttribute('src') || '';
        const r = i.getBoundingClientRect();
        return !beforeImages.includes(src) && r.width > 24 && r.height > 24;
      });
    }, { b: base, st: stem, beforeText: before.text, beforeImages: before.images }).catch(() => false);
    if (seen) break;
  }
  await pg.keyboard.press('Escape').catch(() => {});
  await sleep(400);
  log(seen ? 'ແນບຮູບໃຫ້ AI ແລ້ວ' : 'NOT VERIFIED: ບໍ່ເຫັນຮູບທີ່ Gemini ຮັບ');
  return seen;
}

// ໃຫ້ AI ເບິ່ງຮູບສິນຄ້າຈິງ ແລ້ວຂຽນ "ລັກສະນະກ່ອງ" ໃຫ້ເອງ — ສຳລັບສິນຄ້າໃໝ່ທີ່ຜູ້ໃຊ້ບໍ່ຕ້ອງພິມເອງ
async function cmdDescribePack() {
  const aiKey = process.argv[3] || 'claude';
  const imgPath = process.argv[4];
  const outFile = process.argv[5];
  const lockUrl = process.argv[6] || '';
  const kind = process.argv[7] === 'person' ? 'person' : 'product';
  const fence = kind === 'person' ? 'personlook' : 'packlook';
  if (!imgPath || !fs.existsSync(imgPath)) { log(kind === 'person' ? 'ບໍ່ມີຮູບຄົນ' : 'ບໍ່ມີຮູບສິນຄ້າ'); process.exit(2); }

  const PERSON_ASK = [
    'Inspect the attached photo of a PERSON. Describe ONLY this one person\'s stable visual identity so a video model can recreate the SAME person in every shot. Ignore the background, other people and unrelated objects.',
    'This is a verification record of the real person, not permission to invent features that are not visible.',
    '',
    'Write it this way, in English, under 2500 characters:',
    '- First line: apparent gender, apparent age range, and skin tone.',
    '- Then record: face shape; distinctive facial features (eyes, eyebrows, nose, lips, cheeks, any facial hair, glasses, moles or marks); hair (length, style, color, parting).',
    '- Then record: typical body build and height impression; and the visible clothing, wardrobe colors and accessories (jewellery, watch, hat).',
    '- Last line: a short IDENTITY CHECK listing the 3-5 features that must stay identical in every generated shot.',
    'If something is not clearly visible, write UNCLEAR instead of guessing. Do not invent a name or nationality.',
    `Return ONLY the description inside a \`\`\`${fence} code block, with nothing before or after it.`,
  ];

  const PRODUCT_ASK = [
    'Inspect the attached product photo as a packaging-fidelity analyst. Describe ONLY the photographed product package and its printed front-face artwork. Ignore the table, water bottle, boxes behind it, background, reflections and every other object.',
    'The description will be used as a verification record for the exact real package. It is not permission to redesign the package and it must never invent details that are not visible.',
    'The user-provided canonical product name is authoritative. Do not rename, correct, translate or replace it based on uncertain lettering in the photo. Treat any uncertain printed word as UNCLEAR rather than guessing.',
    '',
    'Write it this way:',
    '- First line: state the package form, orientation, approximate aspect ratio and ONE dominant color. Use a precise color such as DEEP BURGUNDY-MAROON only when visible. Separate the base color from black shadows or red highlights; do not call the package plain black unless it is actually plain black.',
    '- Then give a numbered FRONT-FACE LAYOUT MAP from top to bottom. For every visible element record: position (top/upper-middle/center/lower-middle/bottom; left/center/right), approximate size (small/medium/large), color, shape and what is visibly depicted.',
    '- Record the exact visible package geometry: rectangular carton, height-versus-width, front panel, side edges, top flap, bottom edge, border bands and any diagonal color blocks. Do not invent unseen side or back artwork.',
    '- Describe every visible emblem, badge, logo, animal, rider, cup, bean pattern, herb/ingredient graphic, ribbon, nutrition panel, number or icon. If a word or number is not perfectly readable, write UNCLEAR and describe its shape and position instead of guessing the letters.',
    '- Add a short COLOR AND GEOMETRY CHECK listing the 3-5 features that must remain unchanged in any generated image.',
    '- Last line: state that every listed element is printed artwork on the package itself, not a loose object beside it.',
    '- State whether English words are visibly present. Do not infer a brand name from the user description or from blurry lettering.',
    '',
    'Keep it under 5000 characters, in English. Use the available space for precise visible package geometry and layout details, but never guess unclear text or unseen artwork. Return ONLY the description inside a ```packlook code block, with nothing before or after it.',
  ];
  const ASK = (kind === 'person' ? PERSON_ASK : PRODUCT_ASK).join('\n');

  const b = await connect();
  let pg = await lockedAIPage(b, aiKey, lockUrl);
  if (!pg && lockUrl) { log('NOT VERIFIED: ບໍ່ພົບ AI ແຊັດທີ່ລັອກໄວ້'); await b.close(); process.exit(10); }
  if (!pg) {
    const urls = { claude: 'https://claude.ai/', chatgpt: 'https://chatgpt.com/', gemini: 'https://gemini.google.com/app' };
    const ctx = b.contexts()[0] || await b.newContext();
    pg = await ctx.newPage();
    await pg.goto(urls[aiKey] || urls.claude, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(3500);
  }
  await pg.bringToFront().catch(() => {});

  // ໂໝດປົກກະຕິເປີດແຊັດໃໝ່; ໂໝດອັດໂຕນະມັດໃຊ້ແຊັດທີ່ລັອກໄວ້.
  const fresh = { claude: 'https://claude.ai/new', chatgpt: 'https://chatgpt.com/', gemini: 'https://gemini.google.com/app' };
  if (!lockUrl) await pg.goto(fresh[aiKey] || fresh.claude, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const readySel = aiKey === 'chatgpt' ? '#prompt-textarea, textarea'
    : aiKey === 'gemini' ? 'rich-textarea div[contenteditable="true"], div[contenteditable="true"]'
    : 'div[contenteditable="true"]';
  await pg.locator(readySel).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await sleep(800);
  if (aiKey === 'gemini') {
    const ok = await configureGemini(pg).catch(() => false);
    if (!ok) log('Gemini setting (describe-pack): ຕັ້ງບໍ່ໄດ້ — ໃຊ້ model ປັດຈຸບັນຕໍ່');
  }
  log('ເປີດແຊັດໃໝ່ແລ້ວ (ບໍ່ປົນກັບບົດເກົ່າ)');

  const inputSel = aiKey === 'chatgpt' ? '#prompt-textarea, textarea'
    : aiKey === 'gemini' ? 'rich-textarea div[contenteditable="true"], div[contenteditable="true"]'
    : 'div[contenteditable="true"]';

  const before = await pg.evaluate(() =>
    Array.from(document.querySelectorAll('pre code, code, pre')).map(e => (e.innerText || e.textContent || '').trim())
  ).catch(() => []);

  if (!(await attachToChat(pg, imgPath))) { await b.close(); process.exit(3); }

  await pg.locator(inputSel).first().click({ timeout: 15000 });
  await pg.keyboard.insertText(ASK);
  await sleep(600);
  await pg.keyboard.press('Enter');
  log('ສົ່ງຄຳຖາມແລ້ວ ລໍຄຳຕອບ...');

  let answer = '', stable = 0;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const got = await pg.evaluate(({ prev, fence, minLen }) => {
      const seen = new Set(prev);
      const blocks = Array.from(document.querySelectorAll('pre code, code, pre'))
        .map(e => e.innerText || e.textContent || '');
      const body = document.body.innerText || '';
      const fm = body.match(new RegExp('`{3}' + fence + '[\\s\\S]*?`{3}', 'i'));
      if (fm) blocks.push(fm[0]);
      const stripRe = new RegExp('```' + fence + '|```', 'gi');
      for (let i = blocks.length - 1; i >= 0; i--) {
        const t = blocks[i];
        if (seen.has(t.trim())) continue;
        if (t.replace(stripRe, '').trim().length < minLen) continue;
        if (/Look at the attached product photo/i.test(t)) continue; // ຄຳຖາມຂອງເຮົາເອງ
        if (/^\s*Shot\s+\d|SCENE:|VISUAL DIRECTION|Camera:|Lighting:/im.test(t)) continue; // ບົດ shot ບໍ່ແມ່ນຄຳບັນຍາຍ
        return t;
      }
      return '';
    }, { prev: before, fence, minLen: kind === 'person' ? 60 : 120 }).catch(() => '');
    if (got && got === answer) { if (++stable >= 2) break; } else { answer = got; stable = 0; }
  }

  const clean = String(answer || '').replace(new RegExp('```' + fence, 'gi'), '').replace(/```/g, '').trim();
  const minClean = kind === 'person' ? 60 : 120;
  if (clean.length < minClean) { log('AI ບໍ່ໄດ້ຂຽນຄຳບັນຍາຍມາ'); await b.close(); process.exit(5); }
  // ຮູບຄົນ: ຖ້າ AI ຕອບ UNCLEAR ເກືອບໝົດ = ຮູບນັ້ນບໍ່ແມ່ນຄົນ (ອາດວາງຮູບສະຫຼັບຊ່ອງ)
  if (kind === 'person') {
    const unclear = (clean.match(/UNCLEAR/gi) || []).length;
    const letters = clean.replace(/UNCLEAR|IDENTITY CHECK/gi, '').replace(/[^A-Za-z]/g, '').length;
    if (unclear >= 3 && letters < 60) {
      log('ຮູບນີ້ອ່ານບໍ່ເຫັນຄົນ (ຕອບ UNCLEAR ເກືອບໝົດ) — ອາດບໍ່ແມ່ນຮູບຄົນ ຫຼື ວາງສະຫຼັບຊ່ອງກັບຮູບສິນຄ້າ');
      sendEv('PERSON_UNCLEAR', { unclear, letters });
      await b.close(); process.exit(8);
    }
  }
  fs.writeFileSync(outFile, clean);
  log(`ໄດ້ຄຳບັນຍາຍ${kind === 'person' ? 'ຄົນ' : 'ກ່ອງ'} ${clean.length} ຕົວອັກສອນ`);
  sendEv('PACK_DESC', { kind, chars: clean.length });
  if (lockUrl) sendEv('AI_CHAT_URL', { url: pg.url() });
  await b.close();
}


(async () => {
  try {
    if (CMD === 'status') await cmdStatus();
    else if (CMD === 'login') await cmdLogin();
    else if (CMD === 'open') await cmdOpen();
    else if (CMD === 'gemini-setup') await cmdGeminiSetup();
    else if (CMD === 'ask') await cmdAsk();
    else if (CMD === 'describe-pack') await cmdDescribePack();
    else if (CMD === 'flow') await cmdFlow();
    else if (CMD === 'flow-batch') await cmdFlowBatch();
    else if (CMD === 'combine') await cmdCombine();
    else if (CMD === 'combine-scene') await cmdCombineScene();
    else if (CMD === 'download-scene') await cmdDownloadScene();
    else if (CMD === 'list-clips') await cmdListClips();
    else if (CMD === 'recover-first-sheet') await cmdRecoverFirstSheet();
    else if (CMD === 'prep-tabs') await cmdPrepTabs();
    else if (CMD === 'new-project') await cmdNewProject();
    else if (CMD === 'count-images') await cmdCountImages();
    else if (CMD === 'pull-sheets') await cmdPullSheets();
    else { console.error('ຄຳສັ່ງບໍ່ຮູ້ຈັກ:', CMD); process.exit(2); }
  } catch (e) {
    console.error('ຜິດພາດ:', e && e.message || e);
    process.exit(1);
  }
})();
