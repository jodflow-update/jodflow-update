// JOD FLOW — HTTP server + state machine (ພາສາລາວ)
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { atomicWriteJson, openExternal, samePath, terminateProcessTree } = require('./platform.js');
const skill = require('./skill');
const { buildHero } = require('./hero.js');

// ຮູບທັງໝົດທີ່ຈະແນບເຂົ້າ Flow ຕາມລຳດັບ: ຮູບສິນຄ້າກ່ອນ, ຮູບຄົນຕາມຫຼັງ (ໃຊ້ Stage 3)
function orderedRefPaths(product) {
  // ຮູບສິນຄ້າຫຼັກ → ຮູບສິນຄ້າເພີ່ມ (ໂໝດສິນຄ້າ) → ຮູບຄົນ (ໂໝດຄົນລິວິວ/ຂາຍຄອດ)
  const list = [
    product && product.refPath,
    ...((product && product.extraRefs) || []),
    ...((product && product.personRefs) || []),
  ];
  return list.filter(p => p && fs.existsSync(p));
}

const APP = __dirname;
// ຮັບທັງ 2 ຊື່ env: ຕົວເປີດ Windows ຕັ້ງ FLOWBOT_DATA, ຕົວເປີດ Mac ຕັ້ງ JODFLOW_DATA.
// ຕ້ອງຕົງກັບ worker.js ແບບເປະໆ ບໍ່ດັ່ງນັ້ນສອງຝ່າຍຂຽນ/ອ່ານຄົນລະໂຟນເດີ.
const DATA = process.env.JODFLOW_DATA || process.env.FLOWBOT_DATA || path.join(APP, '..', 'data');
const CFG = JSON.parse(fs.readFileSync(path.join(APP, 'config.json'), 'utf8'));
let PORT = Number(process.env.JODFLOW_PORT || CFG.httpPort || 3838);
const INITIAL_PORT = PORT;
fs.mkdirSync(DATA, { recursive: true });

// ---------- ຕົວອັບເດດອັດຕະໂນມັດ (ເພີ່ມເຂົ້າ, ບໍ່ແຕະ logic ເກົ່າ) ----------
// ຖ້າບໍ່ມີ update-public.pem ຫຼື updateUrl → updater ປິດຕົວເອງ (enabled=false) ບໍ່ເຮັດຫຍັງ
let upd = { state: { enabled: false, status: 'idle' }, check: async () => {}, apply: () => {}, markHealthy: () => {}, hasPending: () => false };
try { upd = require('./updater').init({ appDir: APP, dataDir: DATA }); } catch (e) { console.error('updater ປິດ:', e && e.message || e); }

const F = n => path.join(DATA, n);
const VERSION = '1.1.7';
const CAPABILITIES = ['expand-brief', 'health', 'restart', 'storyboard-product-video-references'];

// ---------- state ----------
const DEFAULT_SETTINGS = { ai: CFG.aiDefault || 'claude', secondsPerShot: CFG.secondsPerShot, speakerRatio: 0.70, autoNewProject: true, autoUpdate: true };
let settings = DEFAULT_SETTINGS;
try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(F('settings.json'), 'utf8')) }; } catch { /* ຄ່າເລີ່ມຕົ້ນ */ }
function saveSettings() { fs.writeFileSync(F('settings.json'), JSON.stringify(settings, null, 2)); }

function freshJob() {
  return {
    phase: 'home', // home | script | review-script | storyboard | review-sb | video | done | error
    product: { mode: 'product', name: '', desc: '', audience: '', packLook: '', personLook: '', refPath: '', personRefs: [], extraRefs: [] },
    note: '',
    narrationSource: 'manual', // manual | ai-brief
    story: '',
    brief: '', // ຂໍ້ຄວາມສັ້ນໆໃຫ້ AI ແຕກເປັນຊື່/ລາຍລະອຽດ/ເລື່ອງ/ບົດພາກ
    // ເພີ່ມຂຶ້ນທຸກຄັ້ງທີ່ AI ແຍກ brief ສຳເລັດ. UI ໃຊ້ເລກນີ້ເພື່ອຂຽນຜົນ AI ລົງ 4 ຊ່ອງເປົ້າໝາຍໃຫ້ແນ່ນອນ 1 ຄັ້ງ.
    briefRevision: 0,
    briefStatus: 'idle', // idle | generating | done | error
    briefError: '',
    briefWarnings: [],
    autoScriptChatUrl: '',
    script: [], // array of 12 shots
    continuity: '', // ບັດ CAST & WORLD ໃຊ້ຮ່ວມກັນທຸກແຜ່ນ/ທຸກຄລິບ
    continuityErrs: [], // ຄຳເຕືອນ ID/ລາຍລະອຽດຄົນ-ສະຖານ; additive ບໍ່ບລັອກ job ເກົ່າ
    projectUrl: '', // project Flow ທີ່ລັອກໄວ້ ກັນແທັບຍ້າຍເອງ
    scriptErrs: [],
    auto: false, // ໂໝດອັດຕະໂນມັດ: ຮູບຄົບ → ຕໍ່ວິດີໂອເອງ ບໍ່ຕ້ອງລໍຄົນກົດ
    sheetsDone: 0,
    clipsDone: 0,
    policyWaitClip: 0, // rejected Flow clip: watch the same project for a user-made replacement
    policyWaitProject: '',
    clipTitles: [], // ຊື່ທີ່ Flow ຕັ້ງໃຫ້ແຕ່ລະຄລິບ — ໃຊ້ຫາຄລິບຕອນລວມ scene
    clipFps: [],    // ລາຍນິ້ວມືຮູບແຕ່ລະສາກ — ໃຊ້ຢືນຢັນຕົວຕົນຄລິບຕອນລວມ
    sceneUrl: '',
    finalFile: '',
    project: { name: '', clips: [], status: 'not-started' },
    timings: { phases: [], workers: [], events: [] },
    msg: '', error: '', log: [],
    busy: false,
  };
}
let job = freshJob();
let savedJob = null;
try {
  savedJob = JSON.parse(fs.readFileSync(F('job.json'), 'utf8'));
  job = { ...freshJob(), ...savedJob };
} catch { /* ໃໝ່ */ }
if (!job.policyWaitClip && job.phase === 'error' && job.projectUrl) {
  const oldPolicy = String(job.error || '').match(/^Flow ແຈ້ງບັນຫາຄລິບ ([1-3]):/);
  if (oldPolicy) { job.policyWaitClip = Number(oldPolicy[1]); job.policyWaitProject = job.projectUrl; }
}
if (job.phase === 'done' && job.finalFile && !fs.existsSync(job.finalFile)
    && fs.existsSync(F('final-combined.mp4'))) {
  try { fs.copyFileSync(F('final-combined.mp4'), job.finalFile); } catch { /* keep the source file */ }
}
if (job.phase === 'done' && job.finalFile && fs.existsSync(job.finalFile)) job.error = '';
// Remove AI citation chips from persisted dialogue created by older versions,
// so restarting the updated app also repairs the current visible form.
let removedLegacyCitations = false;
if (Array.isArray(job.script)) {
  job.script = job.script.map(s => {
    const text = skill.stripAICitations(s.text);
    const scene = skill.stripAICitations(s.scene);
    if (text !== String(s.text ?? '') || scene !== String(s.scene ?? '')) removedLegacyCitations = true;
    return { ...s, text, scene };
  });
}
const cleanLoadedNote = skill.stripAICitations(job.note);
if (cleanLoadedNote !== String(job.note ?? '')) removedLegacyCitations = true;
job.note = cleanLoadedNote;
// Revalidate persisted scripts with the current rules after every app update/restart.
if (Array.isArray(job.script) && job.script.length) job.scriptErrs = skill.validateScript(job.script, job.product);
if (!job.timings || !Array.isArray(job.timings.phases) || !Array.isArray(job.timings.workers)) {
  job.timings = { phases: [], workers: [], events: [] };
}
if (!Array.isArray(job.timings.events)) job.timings.events = [];
// A completed, downloaded project must not keep an error from an earlier
// recoverable stage (for example a failed first attempt to pull storyboard
// references).  The final MP4 is the authoritative completion signal.
if (job.phase === 'done' && job.finalFile && fs.existsSync(job.finalFile)) job.error = '';
// ຮອງຮັບ job ເກົ່າທີ່ແຍກ brief ສຳເລັດກ່ອນມີ briefRevision ແລ້ວ.
// ບໍ່ໃຫ້ຜົນ AI ທີ່ມີຢູ່ແລ້ວຫາຍຈາກໜ້າຟອມຫຼັງອັບເດດ.
if (!Object.prototype.hasOwnProperty.call(savedJob || {}, 'briefRevision')
    || !Number.isInteger(job.briefRevision) || job.briefRevision < 0) {
  job.briefRevision = job.brief && job.product?.name && job.product?.desc && job.story && job.note ? 1 : 0;
  job.briefStatus = job.briefRevision ? 'done' : 'idle';
  job.briefError = '';
}
let saveTimer = null;
function saveJob() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  atomicWriteJson(F('job.json'), job);
}
if (removedLegacyCitations) saveJob();
function scheduleJobSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveJob(); }, 500);
}
function setPhase(p, msg) {
  const now = Date.now();
  if (!job.timings) job.timings = { phases: [], workers: [], events: [] };
  if (job.phase !== p) {
    if (job.phaseStartedAt && ['script', 'storyboard', 'video'].includes(job.phase)) {
      job.timings.phases.push({ phase: job.phase, startedAt: job.phaseStartedAt, endedAt: now, ms: now - job.phaseStartedAt });
      job.timings.phases = job.timings.phases.slice(-40);
    }
    job.phaseStartedAt = ['script', 'storyboard', 'video'].includes(p) ? now : null;
  }
  job.phase = p; if (msg) job.msg = msg;
  // ຈົບແລ້ວ ຫຼື ລົ້ມແລ້ວ → ປິດໂໝດອັດຕະໂນມັດ ບໍ່ດັ່ງນັ້ນຮອບຕໍ່ໄປຈະຂ້າມການກວດເອງ
  if (p === 'done' || p === 'error') job.auto = false;
  saveJob();
}
function logLn(s) { job.log.push(new Date().toLocaleTimeString() + ' ' + s); if (job.log.length > 300) job.log.shift(); scheduleJobSave(); }

function briefStoryErrors(story) {
  const text = String(story || '').replace(/\r/g, '');
  const errors = [];
  if (!/MASTER IDENTITY\s*&\s*CONTINUITY CARD/i.test(text)) errors.push('story ຂາດ MASTER IDENTITY & CONTINUITY CARD');
  for (const label of ['Target audience', 'Characters', 'Locations', 'Recurring props', 'Continuity path']) {
    if (!new RegExp(label.replace(' ', '\\s+'), 'i').test(text)) errors.push(`Continuity Card ຂາດ ${label}`);
  }
  // Count only actual clip headings. Continuity prose may legitimately say
  // "Clip 1 Shot 4" and must not be counted as another heading.
  const clips = [...text.matchAll(/^\s*CLIP\s*([1-3])\b.*SHOTS\s*\d+/gim)].map(m => Number(m[1]));
  if (clips.length !== 3 || clips.join(',') !== '1,2,3') errors.push(`ຕ້ອງມີ CLIP 1, CLIP 2, CLIP 3 ຕາມລຳດັບ (ພົບ ${clips.length})`);
  const shotMatches = [...text.matchAll(/^\s*SHOT\s*(\d{1,2})\b/gim)];
  const shotNums = shotMatches.map(m => Number(m[1]));
  if (shotNums.length !== 12 || shotNums.join(',') !== '1,2,3,4,5,6,7,8,9,10,11,12') {
    errors.push(`story ຕ້ອງມີ SHOT 1-12 ຕາມລຳດັບ (ພົບ: ${shotNums.join(', ') || '0'})`);
    return errors;
  }
  const required = ['TIME', 'PEOPLE', 'LOCATION', 'ACTION', 'CAMERA', 'LIGHT', 'PRODUCT', 'CONTINUITY IN', 'CONTINUITY OUT'];
  for (let i = 0; i < shotMatches.length; i++) {
    const start = shotMatches[i].index;
    const end = i + 1 < shotMatches.length ? shotMatches[i + 1].index : text.length;
    const block = text.slice(start, end);
    const missing = required.filter(label => !new RegExp(`^\\s*${label.replace(' ', '\\s+')}\\s*:`, 'im').test(block));
    if (missing.length) errors.push(`Shot ${i + 1} ຂາດ: ${missing.join(', ')}`);
  }
  return errors;
}

// The four fields are asked for as labelled plain-text sections. A story of this
// size carries dozens of quotation marks and line breaks, and demanding JSON made
// the model escape every one of them correctly on a single line — one slip lost
// all four fields. Sections need no escaping at all.
function parseBriefSections(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const keys = ['NAME', 'DESC', 'STORY', 'NARRATION'];
  const marker = /^[ \t]*={2,}[ \t]*(NAME|DESC|STORY|NARRATION)[ \t]*={2,}[ \t]*$/gim;
  const found = [];
  for (let m = marker.exec(text); m; m = marker.exec(text)) {
    found.push({ key: m[1].toUpperCase(), from: m.index + m[0].length });
  }
  if (!found.length) return null;
  const out = {};
  found.forEach((sec, i) => {
    const end = i + 1 < found.length ? text.lastIndexOf('\n', found[i + 1].from - 1) : text.length;
    out[sec.key.toLowerCase()] = text.slice(sec.from, end).replace(/^\n+/, '').trim();
  });
  if (keys.some(k => !out[k.toLowerCase()])) return null;
  return out;
}

// Keep complete AI drafts editable; narration quality findings are review warnings.
function parseBriefDraft(raw) {
  // Older saved results are still JSON, and recoverLatestBriefDraft replays them.
  const data = parseBriefSections(raw) || (() => {
    const fenced = String(raw || '').match(/```json\s*([\s\S]*?)```/i);
    return JSON.parse((fenced ? fenced[1] : raw).trim());
  })();
  // Gemini ບາງຄັ້ງສົ່ງ narration ເປັນ JSON array ແທນ string.
  // Normalize ເປັນ 12 ແຖວກ່ອນກວດ ແລະກ່ອນໃສ່ຟອມ.
  if (Array.isArray(data.narration)) {
    data.narration = data.narration.map(x => String(x ?? '').trim()).filter(Boolean).join('\n');
  }
  for (const key of ['name', 'desc', 'story', 'narration']) {
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`AI ບໍ່ໄດ້ສົ່ງ ${key}`);
    // ແປງຕົວໄທ→ລາວ ທັນທີທີ່ຮັບຄຳຕອບ AI ທັງ 4 ຊ່ອງ (ຊື່/ສັບປະຄຸນ/ເລື່ອງ/ບົດພາກ)
    data[key] = skill.thaiToLao(skill.stripAICitations(data[key]));
  }
  const narrationLines = data.narration.split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (narrationLines.length !== 12) throw new Error(`AI ສົ່ງ narration ${narrationLines.length} ແຖວ (ຕ້ອງ 12 ແຖວ)`);
  data.narration = narrationLines.map((line, i) => line.replace(/^\s*\d+[.)៖:]\s*/, `${i + 1}. `)).join('\n');
  const qualityErrors = briefStoryErrors(data.story);
  const qualityWarnings = [];
  const cleanedLines = data.narration.split('\n').map(x => x.replace(/^\s*\d+[.)៖:]\s*/, '').trim());
  cleanedLines.forEach((line, i) => {
    // ຕົວໄທທີ່ແປງບໍ່ໄດ້ (ແປງອັດຕະໂນມັດໄປແລ້ວຂ້າງເທິງ) — ໃຫ້ AI ຂຽນໃໝ່
    const thai = skill.thaiLeftovers(line);
    if (thai.length) {
      const how = `ມີຕົວໜັງສືໄທປົນ (${thai.join(' ')}) — ຕ້ອງເປັນລາວລ້ວນ`;
      qualityWarnings.push(`Narration Shot ${i + 1}: ${how}`);
    }
    const syllables = skill.countLaoSyllables(line);
    if (syllables < 6 || syllables > 14) {
      const how = syllables > 14 ? 'ຍາວເກີນ ຕັດຄຳອອກ' : 'ສັ້ນເກີນ ຕື່ມຄຳ';
      qualityWarnings.push(`Narration Shot ${i + 1}: ${syllables} ພະຍາງ (ຕ້ອງ 6-14, ເປົ້າໝາຍ 8-12) — ${how}`);
    }
  });
  const draftShots = cleanedLines.map((text, i) => ({ shot: i + 1, text, seconds: 2.5 }));
  for (const issue of skill.dialogueIssues(draftShots, { name: data.name })) {
    if (issue.shot <= 11 && /(ບັນຍາຍ|ຫົວຂໍ້|ປະໂຫຍກສົນທະນາ)/.test(issue.reason)) {
      qualityWarnings.push(`Narration Shot ${issue.shot}: ${issue.reason}`);
    }
  }
  const productNamed = cleanedLines.slice(2, 4).some(line => line.toLocaleLowerCase().includes(data.name.toLocaleLowerCase()));
  if (!productNamed) qualityWarnings.push('Narration Shot 3 ຫຼື 4 ຕ້ອງເວົ້າຊື່ສິນຄ້າແທ້');
  if (!/(ທັກ|ແຊັດ|ສັ່ງ|ຊື້|ລອງ|ຮີບ|ໂທ|ຕິດຕໍ່)/u.test(cleanedLines.slice(9).join(' '))) qualityWarnings.push('Narration Shot 10-12 ຂາດ CTA');
  if (qualityErrors.length) {
    const err = new Error(qualityErrors.join(' | '));
    err.qualityErrors = qualityErrors;
    throw err;
  }
  const result = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  result._warnings = qualityWarnings;
  return result;
}

// If Gemini already returned a complete result but an older validator rejected
// it, re-apply that exact saved result after an app restart. This never calls AI
// again and never imports a stale result from an earlier brief.
function recoverLatestBriefDraft() {
  if (job.briefStatus !== 'error' || Number(job.briefRevision || 0) !== 0) return false;
  const candidates = [[F('brief-expand-result.txt'), F('brief-expand-request.txt')]];
  for (const [resultPath, requestPath] of candidates) {
    try {
      const resultStat = fs.statSync(resultPath);
      const requestStat = fs.statSync(requestPath);
      if (!resultStat.isFile() || resultStat.mtimeMs < requestStat.mtimeMs) continue;
      const draft = parseBriefDraft(fs.readFileSync(resultPath, 'utf8'));
      job.product.name = draft.name;
      job.product.desc = draft.desc;
      job.story = draft.story;
      job.note = draft.narration;
      job.narrationSource = 'ai-brief';
      job.briefRevision = 1;
      job.briefStatus = 'done';
      job.briefError = '';
      job.briefWarnings = Array.isArray(draft._warnings) ? draft._warnings : [];
      job.msg = job.briefWarnings.length
        ? `AI ໃສ່ຂໍ້ມູນລົງຟອມແລ້ວ — ກວດບົດພາກ: ${job.briefWarnings.join(' | ')}`
        : 'AI ໃສ່ຂໍ້ມູນລົງຟອມຄົບແລ້ວ';
      saveJob();
      logLn('ກູ້ຄຳຕອບ AI ທີ່ຜ່ານ 12/12 Shot ແລະໃສ່ຟອມແລ້ວ');
      return true;
    } catch { /* try the earlier saved result */ }
  }
  return false;
}

recoverLatestBriefDraft();

// ກູ້ສະພາບ "ຄ້າງ busy": ຖ້າ server ຖືກປິດ/restart ຕອນ worker ກຳລັງແລ່ນ
// worker ຈະຕາຍໄປພ້ອມ ແຕ່ job.busy ຍັງເປັນ true ຕະຫຼອດ ເຮັດໃຫ້ໜ້າຈໍຄ້າງ
// ແລະ ກົດຫຍັງຕໍ່ບໍ່ໄດ້. ຕອນເປີດໃໝ່ບໍ່ມີ worker ແນ່ນອນ ຈຶ່ງລ້າງໄດ້ເລີຍ.
if (job.busy) {
  job.busy = false;
  // ຄລິບສ້າງຄົບ 3 ແລ້ວ ແຕ່ຂັ້ນຕໍ່ຄລິບບໍ່ໄດ້ແລ່ນ (worker ຄ້າງ/ຖືກປິດ) —
  // ບໍ່ຕ້ອງເລີ່ມໃໝ່ທັງໝົດ ສືບຕໍ່ຕໍ່ຄລິບ ແລະ ດາວໂຫຼດໃຫ້ເລີຍ
  const haveAll = (job.clipTitles || []).filter(Boolean).length === 3;
  if (job.phase === 'video' && haveAll) {
    job.error = '';
    saveJob();
    logLn('ພົບຄລິບສ້າງຄົບ 3 ແຕ່ຍັງບໍ່ໄດ້ຕໍ່ຄລິບ — ສືບຕໍ່ຕໍ່ຄລິບ ແລະ ດາວໂຫຼດຕໍ່ເລີຍ');
    setTimeout(() => startCombine(), 1500);
  } else {
    job.error = job.error || 'ໂປຣແກຣມຖືກປິດກາງຄັນ — ວຽກທີ່ຄ້າງຖືກຢຸດ ກົດເລີ່ມໃໝ່ໄດ້';
    if (['script', 'storyboard', 'video'].includes(job.phase)) setPhase('error', 'ວຽກຂາດກາງຄັນ — ກົດເລີ່ມໃໝ່ໄດ້');
    else saveJob();
    logLn('ພົບວຽກຄ້າງຈາກການປິດໂປຣແກຣມກາງຄັນ — ລ້າງສະຖານະໃຫ້ແລ້ວ');
  }
}

// ---------- worker (CLI) ----------
let children = {}; // { workerId: process, ... }
function runWorker(args, onLine, onExit, workerId = 'default') {
  if (children[workerId]) return false;
  const startedAt = Date.now();
  // ສົ່ງ DATA ທີ່ຄຳນວນແລ້ວລົງໄປໃຫ້ລູກຕົງໆ — ຢ່າປ່ອຍໃຫ້ລູກຄຳນວນເອງ
  const w = spawn(process.execPath, [path.join(APP, 'worker.js'), ...args], { cwd: APP, env: { ...process.env, JODFLOW_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  children[workerId] = w;
  // AI ອາດລໍຄຳຕອບດົນ, ແຕ່ບໍ່ຄວນຄ້າງຕະຫຼອດໄປ.
  // ໃຊ້ timeout ເຉພາະຂັ້ນວິເຄາະ/ຂຽນສະຄຣິບ; Flow video ປ່ອຍໃຫ້ worker ຄວບຄຸມ timeout ເອງ.
  const timeoutMs = args[0] === 'describe' ? 210000
    : args[0] === 'ask' && /ask-fix-policy/i.test(String(args[2] || '')) ? 180000
    : args[0] === 'ask' && /ask-fix/i.test(String(args[2] || '')) ? 40000
    // worker.js ລໍຄຳຕອບສະຄຣິບໄດ້ເຖິງ 300 ວິນາທີ. Server ຕ້ອງບໍ່ຂ້າມັນກ່ອນ.
    // brief-expand ຂໍບົດເລື່ອງຍາວເທົ່າກັບສະຄຣິບ ຈຶ່ງຕ້ອງໄດ້ເວລາເທົ່າກັນ.
    : args[0] === 'ask' && /ask-script|brief-expand/i.test(String(args[2] || '')) ? 330000
    : args[0] === 'ask' ? 240000
    : 0;
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => {
    if (!children[workerId]) return;
    timedOut = true;
    logLn(`worker ${workerId} ໃຊ້ເວລາເກີນ ${Math.round(timeoutMs / 1000)} ວິ — ຢຸດແລະໃຫ້ລອງໃໝ່`);
    terminateProcessTree(w);
  }, timeoutMs) : null;
  job.busy = Object.keys(children).length > 0; saveJob();
  const recordLine = line => {
    const event = line.match(/@@(JOB_SUBMITTED|CLIP_TITLE|BATCH_DONE|SHEETS_PULLED|COMBINE_DONE|ASK_DONE|PACK_DESC|POLICY_ERROR|NOT_VERIFIED)\s/);
    if (event) {
      if (!job.timings) job.timings = { phases: [], workers: [], events: [] };
      if (!Array.isArray(job.timings.events)) job.timings.events = [];
      job.timings.events.push({ event: event[1], workerId, at: Date.now() });
      job.timings.events = job.timings.events.slice(-100);
    }
    logLn(line);
    if (!w.jodCanceled && onLine) onLine(line);
  };
  const frameLines = stream => {
    let pending = '';
    stream.on('data', buf => {
      pending += buf.toString();
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
        if (!line) continue;
        recordLine(line);
      }
    });
    return () => {
      const line = pending.trim();
      if (line) recordLine(line);
      pending = '';
    };
  };
  const flushStdout = frameLines(w.stdout), flushStderr = frameLines(w.stderr);
  w.on('close', code => {
    flushStdout(); flushStderr();
    if (timer) clearTimeout(timer);
    if (children[workerId] === w) delete children[workerId];
    job.busy = Object.keys(children).length > 0; saveJob();
    if (!job.timings) job.timings = { phases: [], workers: [], events: [] };
    const endedAt = Date.now();
    job.timings.workers.push({ task: args[0], workerId, startedAt, endedAt, ms: endedAt - startedAt, code: timedOut ? 124 : code });
    job.timings.workers = job.timings.workers.slice(-80);
    logLn(`worker ສິ້ນສຸດ code=${code}`);
    saveJob();
    if (!w.jodCanceled && onExit) onExit(timedOut ? 124 : code);
  });
  return true;
}
function isBusy() { return Object.keys(children).length > 0; }
function killWorker(workerId = null) {
  if (workerId) {
    if (!children[workerId]) return;
    children[workerId].jodCanceled = true;
    terminateProcessTree(children[workerId]);
    delete children[workerId]; job.busy = Object.keys(children).length > 0; saveJob();
  } else {
    for (const id in children) {
      children[id].jodCanceled = true;
      terminateProcessTree(children[id]);
    }
    children = {}; job.busy = false; saveJob();
  }
}

// ---------- ອັບເດດ: ນຳມາໃຊ້ຕອນບັອດຫວ່າງ ແລ້ວ restart ຖ້າຈຳເປັນ ----------
function doApply() {
  try {
    const r = upd.apply();
    logLn(`ອັບເດດເປັນລຸ້ນ ${r.rev} ແລ້ວ${r.notes ? ': ' + r.notes : ''}`);
    if (r.restart) { logLn('ກຳລັງ restart ເພື່ອໃຫ້ອັບເດດມີຜົນ...'); killWorker(); setTimeout(() => process.exit(75), 300); }
  } catch (e) { logLn('ນຳອັບເດດມາໃຊ້ບໍ່ສຳເລັດ: ' + (e && e.message || e)); }
}
// ນຳມາໃຊ້ສະເພາະຕອນບໍ່ມີວຽກແລ່ນ ແລະ job ຢູ່ຂັ້ນທີ່ປອດໄພ (ບໍ່ຂັດຈັງຫວະການສ້າງວິດີໂອ)
function tryApply() {
  if (!upd.hasPending() || settings.autoUpdate === false || isBusy()) return;
  if (!['home', 'done', 'error', 'review-script', 'review-sb'].includes(job.phase)) return;
  doApply();
}

// ---------- orchestration ----------
async function stepScript(retry = 0, lockUrl = '') {
  job.error = '';
  setPhase('script', 'ຂຽນສະຄຣິບລາວ 12 shot...');
  const req = skill.buildScriptRequest(job.product, job.note, settings.ai, job.story);
  const reqFile = F('ask-script.txt'), outFile = F('ask-script-out.txt');
  fs.writeFileSync(reqFile, req);
  // ຫ້າມໃຫ້ຜົນເກົ່າຖືກອ່ານເປັນຄຳຕອບຂອງຮອບໃໝ່.
  try { fs.unlinkSync(outFile); } catch { /* ບໍ່ມີຜົນເກົ່າ */ }
  // ບໍ່ແນບຮູບສິນຄ້າໃນຂັ້ນຂຽນບົດ: ຂັ້ນ "describe-pack" ອ່ານຮູບມາເປັນ packLook
  // (ຂໍ້ຄວາມ) ໃຫ້ແລ້ວ ແລະ prompt ນີ້ໃຊ້ packLook ບໍ່ໄດ້ອ້າງເຖິງຮູບທີ່ແນບ.
  // ການແນບຊ້ຳເສຍເວລາ ແລະ ຖ້າ Gemini ບໍ່ຮັບຮູບ ຈະລົ້ມທັງຂັ້ນ (code 8) ໂດຍບໍ່ຈຳເປັນ.
  runWorker(['ask', settings.ai, reqFile, outFile, '', lockUrl], line => {
    const m = line.match(/@@AI_CHAT_URL (.+)$/);
    if (m) { try { job.autoScriptChatUrl = JSON.parse(m[1]).url || lockUrl; saveJob(); } catch { /* ignore */ } }
  }, code => {
    if ((code === 5 || code === 6 || code === 124) && retry < 1) {
      logLn(`AI ຕອບບໍ່ສຳເລັດ (code ${code}) — ລອງຖາມໃໝ່ອັດຕະໂນມັດ 1 ຄັ້ງ`);
      setTimeout(() => stepScript(retry + 1, lockUrl), 4000);
      return;
    }
    if (code === 6) { job.error = `AI ຂຶ້ນ error ສອງຄັ້ງຕິດ (${settings.ai}) — ລອງໃໝ່ພາຍຫຼັງ ຫຼື ປ່ຽນໄປໃຊ້ Claude ໃນຊ່ອງ "AI ທີ່ໃຊ້"`; setPhase('error'); return; }
    if (code === 5) { job.error = 'AI ຍັງຂຽນບົດບໍ່ຄົບ 12 shot — ກົດ "ຂຽນໃໝ່ຈາກ AI" ອີກຄັ້ງ ຫຼື ປ່ຽນໄປໃຊ້ Claude'; setPhase('error'); return; }
    if (code === 8) { job.error = 'NOT VERIFIED: Gemini ບໍ່ໄດ້ຮັບຮູບສິນຄ້າຈິງ — ຢຸດກ່ອນບໍ່ໃຫ້ຂຽນບົດຈາກຮູບທີ່ເດົາ'; setPhase('error'); return; }
    if (code === 124) { job.error = 'Gemini ຕອບຊ້າເກີນ 330 ວິນາທີ 2 ຄັ້ງຕິດ — ກວດແທັບ Gemini/ອິນເຕີເນັດ ແລ້ວກົດຂຽນໃໝ່'; setPhase('error'); return; }
    if (code !== 0) { job.error = 'ຖາມ AI ບໍ່ສຳເລັດ (code ' + code + ')'; setPhase('error'); return; }
    const raw = fs.readFileSync(outFile, 'utf8');
    const shots = skill.parseScript(raw);
    job.script = shots;
    job.continuity = skill.parseContinuity(raw);
    job.continuityErrs = skill.continuityIssues(job.continuity);
    logLn(job.continuity ? `ໄດ້ບັດ CONTINUITY (${job.continuity.split('\n').length} ແຖວ)` : 'ເຕືອນ: AI ບໍ່ໄດ້ຂຽນບັດ CONTINUITY — ສາກອາດບໍ່ຕໍ່ເນື່ອງ');
    if (job.continuityErrs.length) logLn(`CONTINUITY QA: ${job.continuityErrs.join('; ')} — ຍັງບໍ່ບລັອກ workflow ເກົ່າ`);
    job.scriptErrs = skill.validateScript(shots, job.product);
    setPhase('review-script', job.scriptErrs.length ? 'ສະຄຣິບມີຂໍ້ຜິດ ກະລຸນາແກ້' : 'ສະຄຣິບພ້ອມ ກວດແລ້ວຕົກລົງ');
  });
}

function startAutoScriptPipeline(lockUrl) {
  const ref = job.product.refPath;
  if (!ref || !fs.existsSync(ref) || !lockUrl) {
    job.error = 'NOT VERIFIED: ຂາດຮູບສິນຄ້າ ຫຼື AI ແຊັດທີ່ລັອກໄວ້';
    setPhase('error'); return;
  }
  const st = fs.statSync(ref);
  const refSig = `${st.size}-${Math.round(st.mtimeMs)}`;
  if (job.product.packLook && job.product.packLook.length > 120 && job.packLookFor === refSig) {
    stepScript(0, lockUrl); return;
  }
  const outFile = F('packlook-ai.txt');
  try { fs.unlinkSync(outFile); } catch { /* no stale output */ }
  setPhase('script', 'ອ່ານຮູບສິນຄ້າໃນ AI ແຊັດດຽວ...');
  let nextUrl = lockUrl;
  runWorker(['describe-pack', settings.ai, ref, outFile, lockUrl], line => {
    const m = line.match(/@@AI_CHAT_URL (.+)$/);
    if (m) { try { nextUrl = JSON.parse(m[1]).url || nextUrl; job.autoScriptChatUrl = nextUrl; saveJob(); } catch { /* ignore */ } }
  }, code => {
    if (code !== 0 || !fs.existsSync(outFile)) {
      job.error = `ອ່ານຮູບສິນຄ້າໃນ AI ແຊັດດຽວບໍ່ສຳເລັດ (code ${code})`;
      setPhase('error'); return;
    }
    const packLook = fs.readFileSync(outFile, 'utf8').trim();
    if (packLook.length < 120) { job.error = 'ລາຍລະອຽດຮູບສິນຄ້າສັ້ນເກີນ'; setPhase('error'); return; }
    job.product.packLook = packLook;
    job.packLookFor = refSig;
    saveJob();
    stepScript(0, nextUrl);
  }, 'describe');
}

const MAX_POLICY_RETRIES = 2;

// ຂຽນໃໝ່ shot ທີ່ຖືກ Flow block ດ້ວຍ policy, ຜ່ານ AI — synchronous-style ດ້ວຍ callback
function rewriteShotsAndRetry(shots4, reason, onDone) {
  // ຂຽນໃໝ່ສະເພາະ shot ທຳອິດຂອງກຸ່ມ (ມັກເປັນຕົວທີ່ trigger filter) — ຂຽນທຸກ shot ຖ້າຢາກໃຫ້ແໜ້ນກວ່ານີ້ໄດ້
  const target = shots4[0];
  const req = skill.buildRewriteRequest(target.text, target.scene, reason);
  const reqFile = F('ask-rewrite.txt'), outFile = F('ask-rewrite-out.txt');
  fs.writeFileSync(reqFile, req);
  // ຂຽນແຖວລາວໃໝ່ 1 ແຖວ — ບໍ່ຕ້ອງເຫັນຮູບສິນຄ້າ
  runWorker(['ask', settings.ai, reqFile, outFile], null, code => {
    if (code !== 0) { onDone(false); return; }
    const raw = fs.readFileSync(outFile, 'utf8');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    // ແກ້ແຕ່ພາບ (SCENE) — ບົດເວົ້າລາວຂອງຜູ້ໃຊ້ຕ້ອງຢູ່ຄືເກົ່າທຸກຄຳ.
    // ບົດເວົ້າບໍ່ເຄີຍຖືກສົ່ງໄປໃຫ້ Flow ສ້າງພາບ ຈຶ່ງບໍ່ແມ່ນຕົ້ນເຫດຂອງການບລັອກ.
    const sceneMatch = raw.match(/SCENE:\s*(.+)/i);
    const newScene = sceneMatch ? skill.thaiToLao(skill.stripAICitations(sceneMatch[1])) : '';
    if (newScene) {
      target.scene = newScene;
      const idx = job.script.findIndex(s => s.shot === target.shot);
      if (idx >= 0) job.script[idx] = { ...job.script[idx], scene: target.scene };
      saveJob();
      logLn(`ປ່ຽນພາບ Shot ${target.shot} ຍ້ອນ policy (ບົດເວົ້າຄືເກົ່າ): "${target.scene.slice(0, 70)}"`);
      onDone(true);
    } else { logLn(`AI ບໍ່ໄດ້ສົ່ງ SCENE ໃໝ່ມາ — ບໍ່ແກ້ຫຍັງ`); onDone(false); }
  });
}

async function stepStoryboard(resumeFrom = 1) {
  const requiredDialogueErrors = skill.requiredDialogueErrors(job.script);
  if (requiredDialogueErrors.length) {
    job.scriptErrs = skill.validateScript(job.script, job.product);
    job.error = `ສ້າງ Storyboard ບໍ່ໄດ້: ບົດພາກຕ້ອງຄົບ 12/12 — ${requiredDialogueErrors.join('; ')}`;
    setPhase('review-script', 'ກະລຸນາໃສ່ບົດພາກໃຫ້ຄົບທຸກ Shot 1-12');
    return;
  }
  setPhase('storyboard', 'ສ້າງ Storyboard 3 ແຜ່ນ (ເທື່ອລະແຜ່ນ) ໃນ Flow...');
  if (resumeFrom === 1) {
    job.sheetsDone = 0; job.sheetFiles = []; job.heroPath = ''; job.videoSubmitted = {};
  }
  job.error = ''; saveJob();
  // A new storyboard run must never inherit URL-to-sheet mappings from an
  // older project. Retries inside this run preserve already completed sheets.
  if (resumeFrom === 1) try { fs.rmSync(F('storyboard-assets.json')); } catch { /* no previous mapping */ }

  let failed = [], baseline = 0, finalCount = 0;
  // ຮູບອ້າງອີງທັງໝົດຕາມລຳດັບ (ສິນຄ້າກ່ອນ, ຄົນຕາມຫຼັງ) ຄັ່ນດ້ວຍ , ສຳລັບ worker
  const refPath = orderedRefPaths(job.product).join(',');

  // ຫຼັງ worker ຈົບໝົດ ຈຶ່ງນັບຮູບໃນ Flow ຈິງ — ບໍ່ເຊື່ອ worker ຢ່າງດຽວ
  const verifyAll = () => {
    logLn('ກວດຜົນຈິງໃນ Flow...');
    runWorker(['count-images'], line => {
      const m = line.match(/@@IMAGE_COUNT (.+)$/);
      if (m) { try { finalCount = JSON.parse(m[1]).count; } catch { /* ignore */ } }
    }, () => {
      let mapped = 0;
      try {
        const manifest = JSON.parse(fs.readFileSync(F('storyboard-assets.json'), 'utf8'));
        if (manifest.projectUrl === job.projectUrl) {
          mapped = [1, 2, 3].filter(n => manifest.assets.some(a => a.sheet === n && a.url && fs.existsSync(F(`sb-sheet-${n}.png`)))).length;
        }
      } catch { /* use gallery count when no verified sheet mapping exists */ }
      const made = Math.max(mapped, Math.max(0, finalCount - baseline));
      job.sheetsDone = Math.min(3, made); saveJob();
      if (made >= 3) {
        const ref = job.product.refPath || '';
        const heroReady = ref ? buildHero(ref, F('hero-shot12.png'))
          .then(() => { job.heroPath = F('hero-shot12.png'); saveJob(); logLn('ສ້າງຮູບສິນຄ້າຊັອດ 12 ຈາກຮູບຈິງແລ້ວ'); return true; })
          .catch(e => { logLn('ສ້າງຮູບສິນຄ້າຊັອດ 12 ບໍ່ສຳເລັດ: ' + (e && e.message || e)); return false; })
          : Promise.resolve(false);
        // ດຶງແຜ່ນລົງເຄື່ອງ ເພື່ອໃຫ້ຂັ້ນວິດີໂອແນບກັບຄືນເປັນ Image 1 ໄດ້
        runWorker(['pull-sheets', '3', DATA, job.projectUrl || ''], line => {
          const m = line.match(/@@SHEETS_PULLED (.+)$/);
          if (m) { try { job.sheetFiles = JSON.parse(m[1]).files || []; saveJob(); } catch { /* ignore */ } }
        }, async () => {
          let got = (job.sheetFiles || []).filter(p => fs.existsSync(p)).length;
          if (got !== 3 && mapped === 3) {
            job.sheetFiles = [1, 2, 3].map(n => F(`sb-sheet-${n}.png`));
            got = 3; saveJob();
          }
          const heroOk = await heroReady;
          logLn(got ? `ດຶງແຜ່ນລົງເຄື່ອງ ${got}/3 — ຂັ້ນວິດີໂອຈະແນບເປັນ Image 1` : 'ດຶງແຜ່ນລົງເຄື່ອງບໍ່ໄດ້');
          if (got !== 3) {
            job.error = `NOT VERIFIED: storyboard reference ${got}/3; hero ${heroOk ? 'ready' : 'missing'}`;
            setPhase('error'); return;
          }
          if (job.auto) {
            // ໂໝດອັດຕະໂນມັດ: ບໍ່ຢຸດໃຫ້ກວດແຜ່ນ ຕໍ່ໄປສ້າງວິດີໂອເລີຍ
            logLn('ໂໝດອັດຕະໂນມັດ — ບໍ່ຢຸດໃຫ້ກວດ Storyboard ຕໍ່ໄປສ້າງ 3 ວິດີໂອເລີຍ');
            stepVideos();
            return;
          }
          setPhase('review-sb', `ສ້າງຄົບ 3 ແຜ່ນ (ນັບຮູບໃນ Flow ແລ້ວ) — ກວດແລ້ວຕົກລົງ`);
        }, 'pull');
        return;
      } else {
        job.error = `ສ້າງໄດ້ແທ້ ${made}/3 ແຜ່ນ` + (failed.length ? ` — ແຜ່ນທີ່ລົ້ມ: ${failed.join(', ')}` : '');
        setPhase('error');
      }
    }, 'verify');
  };

  // ທັງ 3 ແຜ່ນໃນ worker ດຽວ: ເປີດ node/ຕໍ່ CDP/ຫາແທັບ/ຕັ້ງຄ່າ ເທື່ອດຽວແທນ 3 ເທື່ອ
  const runBatch = (fromN, retries = 0) => {
    const files = [];
    for (let n = fromN; n <= 3; n++) {
      const shots4 = job.script.slice((n - 1) * 4, n * 4);
      const prompt = skill.buildFlowStoryboardPrompt(n, shots4, job.product, job.continuity);
      const file = F(`sb-prompt-${n}.txt`);
      fs.writeFileSync(file, prompt);
      files.push(file);
    }
    let policyReason = null, policyN = 0, notVerifiedReason = '';
    runWorker(['flow-batch', 'image', files.join(','), refPath, job.projectUrl || '', String(fromN)], line => {
      let m = line.match(/@@POLICY_ERROR (.+)$/);
      if (m) { try { const o = JSON.parse(m[1]); policyReason = o.reason; policyN = o.n || fromN; } catch { policyReason = 'policy'; policyN = fromN; } }
      m = line.match(/@@NOT_VERIFIED (.+)$/);
      if (m) { try { notVerifiedReason = JSON.parse(m[1]).reason || 'Flow verification failed'; } catch { notVerifiedReason = 'Flow verification failed'; } }
      m = line.match(/@@SHEET_DONE (.+)$/);
      if (m) { try { job.sheetsDone = JSON.parse(m[1]).n; saveJob(); } catch { /* ignore */ } }
    }, code => {
      if (code === 3 && policyReason && retries < MAX_POLICY_RETRIES) {
        const shots4 = job.script.slice((policyN - 1) * 4, policyN * 4);
        logLn(`Storyboard ${policyN} ຖືກ Flow ບລັອກ (${policyReason}) — ຂຽນໃໝ່ ແລະ ລອງອີກ (${retries + 1}/${MAX_POLICY_RETRIES})`);
        rewriteShotsAndRetry(shots4, policyReason, () => runBatch(policyN, retries + 1));
        return;
      }
      if (code === 4) logLn('ລໍແລ້ວບໍ່ເຫັນຮູບໃໝ່ — ຢຸດຊຸດນີ້');
      if (code === 7) { job.error = `NOT VERIFIED: ${notVerifiedReason || 'Flow verification failed'} — ບໍ່ສ້າງຮູບ`; setPhase('error'); return; }
      if (code !== 0) failed.push(`ຢຸດຫຼັງແຜ່ນ ${job.sheetsDone}`);
      verifyAll();
    }, 'sb-batch');
  };

  // ຕ້ອງການແທັບ project ອັນດຽວ — ກວດວ່າມີ ແລະ ເກັບຈຳນວນຮູບຕັ້ງຕົ້ນ
  logLn('ກຽມແທັບ Flow...');
  runWorker(['prep-tabs', '1'], line => {
    const m = line.match(/@@TABS_READY (.+)$/);
    if (m) {
      try {
        const o = JSON.parse(m[1]);
        baseline = o.baseline || 0;
        if (o.projectUrl) { job.projectUrl = o.projectUrl; saveJob(); }
      } catch { /* ignore */ }
    }
  }, code => {
    if (code === 2) { job.error = 'ເປີດ project ໃນ Flow ກ່ອນ (flow.google.com/project/...) ແລ້ວກົດສ້າງ Storyboard ອີກຄັ້ງ'; setPhase('error'); return; }
    if (code !== 0) { job.error = 'ກຽມແທັບ Flow ບໍ່ສຳເລັດ'; setPhase('error'); return; }
    logLn(`ເລີ່ມແຜ່ນ ${resumeFrom} (ຮູບທີ່ມີຢູ່ແລ້ວ ${baseline})`);
    runBatch(resumeFrom);
  });
}

function repairVideoPolicy(clipNo, reason, policyStage, onDone) {
  const shots = job.script.slice((clipNo - 1) * 4, clipNo * 4);
  const originalPrompt = fs.readFileSync(F(`clip-prompt-${clipNo}.txt`), 'utf8');
  const mode = policyStage === 0 ? 'scene' : 'dialogue';
  const reqFile = F(`ask-fix-policy-${mode}-${clipNo}.txt`);
  const outFile = F(`ask-fix-policy-${mode}-${clipNo}-out.txt`);
  if (!fs.existsSync(F(`policy-original-clip-${clipNo}.txt`))) fs.writeFileSync(F(`policy-original-clip-${clipNo}.txt`), originalPrompt);
  const instruction = mode === 'scene'
    ? 'Revise only the four VISUAL DIRECTION scene descriptions for this rejected clip. Keep the original Lao dialogue exactly unchanged. Return only changed scene lines in the form Shot N: <new English visual scene>. Do not change the product identity, people, location, story order, or CTA.'
    : 'The visual-only revision was also rejected. Inspect whether any spoken Lao line is likely contributing. Change only the minimum necessary line or lines, keeping the same meaning, speaker, product name and CTA. Return only changed dialogue lines in the form Shot N: <new Lao spoken line>. If dialogue is not the likely issue, return NO_DIALOGUE_CHANGE.';
  fs.writeFileSync(reqFile, `Flow rejected Clip ${clipNo} with this message: ${reason}\n\n${instruction}\nPut the proposed Shot N: lines inside ONE plain code block, with no other text. Do not try to bypass Flow policy; propose a compliant version. The full rejected prompt follows:\n\n${originalPrompt}`);
  try { fs.unlinkSync(outFile); } catch { /* no stale answer */ }
  logLn(`ຄລິບ ${clipNo}: ສົ່ງ prompt ທີ່ Flow ປະຕິເສດໃຫ້ AI ແກ້ ${mode}`);
  runWorker(['ask', settings.ai, reqFile, outFile, '', job.autoScriptChatUrl || ''], null, code => {
    if (code !== 0 || !fs.existsSync(outFile)) { onDone(false); return; }
    const raw = fs.readFileSync(outFile, 'utf8');
    const proposed = [...raw.matchAll(/^\s*Shot\s+(\d{1,2})\s*:\s*([^\r\n]+)$/gmi)]
      .map(m => ({ n: Number(m[1]), value: m[2].trim() }))
      .filter(x => shots.some(s => s.shot === x.n) && x.value && x.value.length < 1200);
    if (!proposed.length) { onDone(false); return; }
    let changed = 0;
    for (const { n, value } of proposed) {
      const shot = job.script.find(s => s.shot === n);
      if (!shot) continue;
      if (mode === 'scene' && value !== shot.scene) { shot.scene = value; changed++; }
      if (mode === 'dialogue' && value !== shot.text && /[\u0E80-\u0EFF]/u.test(value)
          && !skill.thaiLeftovers(value).length && skill.fits(value, shot.seconds).ok) {
        if (!job.policyOriginalDialogue) job.policyOriginalDialogue = {};
        if (!job.policyOriginalDialogue[n]) job.policyOriginalDialogue[n] = shot.text;
        shot.text = value; changed++;
      }
    }
    if (changed) { saveJob(); logLn(`ຄລິບ ${clipNo}: AI ແກ້ ${mode} ${changed} shot; ບົດເດີມຖືກເກັບໄວ້`); }
    onDone(changed > 0);
  }, 'policy-repair');
}

async function stepVideos(startNo = 1, policyStage = 0) {
  if ((job.videoSubmitted || {})[startNo] === job.projectUrl) {
    job.error = `ຄລິບ ${startNo} ຖືກສົ່ງໃຫ້ Flow ແລ້ວ — ກວດຜົນໃນ project ກ່ອນ ເພື່ອບໍ່ສ້າງຊ້ຳ`;
    setPhase('error'); return;
  }
  const requiredDialogueErrors = skill.requiredDialogueErrors(job.script);
  if (requiredDialogueErrors.length) {
    job.scriptErrs = skill.validateScript(job.script, job.product);
    job.error = `ສ້າງວິດີໂອບໍ່ໄດ້: ບົດພາກຕ້ອງຄົບ 12/12 — ${requiredDialogueErrors.join('; ')}`;
    setPhase('review-script', 'ກະລຸນາໃສ່ບົດພາກໃຫ້ຄົບທຸກ Shot 1-12');
    return;
  }
  if (!/^https:\/\/flow\.google\.com\/project\/[^/?#]+/i.test(String(job.projectUrl || ''))) {
    job.error = 'NOT VERIFIED: ບໍ່ພົບ URL project ເດີມທີ່ສ້າງ Storyboard — ບໍ່ເປີດແທັບເປົ່າ ແລະບໍ່ສ້າງວິດີໂອຜິດ project';
    setPhase('error'); return;
  }
  logLn(`ສ້າງວິດີໂອໃນ project Storyboard ເດີມ: ${job.projectUrl}`);
  setPhase('video', 'ສ້າງ 3 ຄລິບວິດີໂອໃນ Flow...');
  job.error = '';
  if (startNo === 1) { job.clipsDone = 0; job.clipTitles = []; job.clipFps = []; }
  else job.clipsDone = startNo - 1;
  job.project = {
    name: `${job.product.name || 'JOD FLOW'} — Close Sale`,
    status: 'generating',
    clips: [1, 2, 3].map(n => ({ order: n, shots: `${(n - 1) * 4 + 1}-${n * 4}`, status: n < startNo ? 'generated' : 'pending', promptFile: F(`clip-prompt-${n}.txt`) })),
  };
  saveJob();
  const files = [], sheets = [];
  for (let n = 1; n <= 3; n++) {
    const file = F(`clip-prompt-${n}.txt`);
    const sheetFile = F(`sb-sheet-${n}.png`);
    fs.writeFileSync(file, skill.buildFlowClipPrompt(n, job.script.slice((n - 1) * 4, n * 4), job.product, job.continuity));
    if (!fs.existsSync(sheetFile)) { job.error = `NOT VERIFIED: ບໍ່ມີ storyboard reference ສຳລັບຄລິບ ${n}`; setPhase('error'); return; }
    if (n >= startNo) { files.push(file); sheets.push(sheetFile); }
  }

  let policyReason = '', policyN = 0, notVerifiedReason = '';
  const clipTitlesByScene = (job.clipTitles || []).slice(0, startNo - 1);
  const clipFpByScene = (job.clipFps || []).slice(0, startNo - 1);
  runWorker(['flow-batch', 'video', files.join(','), orderedRefPaths(job.product).join(','), job.projectUrl || '', String(startNo), sheets.join(',')], line => {
    let submitted = line.match(/@@JOB_SUBMITTED (.+)$/);
    if (submitted) {
      try { const o = JSON.parse(submitted[1]); if (o.kind === 'video' && o.n >= 1 && o.n <= 3) { job.videoSubmitted ||= {}; job.videoSubmitted[o.n] = job.projectUrl; saveJob(); } } catch {}
    }
    let m = line.match(/@@CLIP_TITLE (.+)$/);
    if (m) {
      try {
        const o = JSON.parse(m[1]);
        if (o.n >= 1 && o.n <= 3 && o.title) {
          clipTitlesByScene[o.n - 1] = o.title;
          // ລາຍນິ້ວມືຮູບ — ຕອນລວມໃຊ້ຢືນຢັນວ່າຄລິບແມ່ນສາກນີ້ແທ້
          if (o.fp) clipFpByScene[o.n - 1] = o.fp;
          // ບັນທຶກລົງ job ທັນທີ — ຢ່າເກັບໄວ້ແຕ່ໃນໂປຣເຊັສ. ຮອບກ່ອນ worker
          // ຄ້າງຢູ່ຂັ້ນລໍຜົນ ແລ້ວຊື່ຄລິບທັງ 3 ຫາຍໄປພ້ອມ ຈຶ່ງສືບຕໍ່ບໍ່ໄດ້.
          job.clipTitles = clipTitlesByScene.slice();
          job.clipFps = clipFpByScene.slice();
          saveJob();
        }
      } catch { /* ignore */ }
    }
    m = line.match(/@@POLICY_ERROR (.+)$/);
    if (m) { try { const o = JSON.parse(m[1]); policyReason = o.reason || 'policy'; policyN = Number(o.n) || startNo; } catch { policyReason = 'policy'; policyN = startNo; } }
    m = line.match(/@@NOT_VERIFIED (.+)$/);
    if (m) { try { notVerifiedReason = JSON.parse(m[1]).reason || ''; } catch { notVerifiedReason = ''; } }
  }, code => {
    // A submitted clip must never be sent a second time automatically. Leave
    // the Flow result in place for review, even when policy detection fires.
    if (code === 3) {
      job.policyWaitClip = policyN || startNo;
      job.policyWaitProject = job.projectUrl;
      job.error = `Flow ປະຕິເສດຄລິບ ${job.policyWaitClip}: ${policyReason || 'ກວດໃນ Flow'}`;
      setPhase('waiting-video-repair', `ລໍໃຫ້ເຈົ້າແກ້ຄລິບ ${job.policyWaitClip} ໃນ Flow; ບັອດຈະກວດແລະສືບຕໍ່ເອງ`);
      return;
    }
    if (code === 7) { job.error = 'NOT VERIFIED: ' + (notVerifiedReason || 'ວິດີໂອບໍ່ມີ reference ທີ່ Flow ຮັບ'); setPhase('error'); return; }
    if (code !== 0) { job.error = `ສ້າງ batch ວິດີໂອບໍ່ສຳເລັດ${policyReason ? ` (${policyReason})` : ''}`; setPhase('error'); return; }
    if (clipTitlesByScene.length !== 3 || clipTitlesByScene.some(t => !t)) { job.error = 'NOT VERIFIED: ຊື່ຄລິບບໍ່ຄົບ 3 ສາກ'; setPhase('error'); return; }
    job.clipsDone = 3;
    job.project.clips.forEach(c => { c.status = 'generated'; });
    saveJob();
    logLn('ຄລິບ 1–3 ສ້າງຄົບແລ້ວ — ກວດຊື່ຕາມສາກແລະລວມ 1→2→3');
    startCombine();
  }, 'video-batch');
}

// ຂັ້ນຕໍ່ຄລິບ + ດາວໂຫຼດ — ແຍກອອກມາເພື່ອໃຫ້ "ສືບຕໍ່" ໄດ້ ເມື່ອຄລິບສ້າງຄົບແລ້ວ
// ແຕ່ຂັ້ນຕໍ່ຄລິບບໍ່ໄດ້ແລ່ນ (worker ຄ້າງ/ຕາຍ). ກ່ອນນີ້ຊື່ຄລິບຢູ່ແຕ່ໃນ closure
// ຂອງ worker ຈຶ່ງຫາຍໄປພ້ອມ ແລະ ບໍ່ມີທາງສືບຕໍ່ ນອກຈາກສ້າງວິດີໂອໃໝ່ທັງໝົດ.
function startCombine() {
  const titles = job.clipTitles || [];
  const fps = job.clipFps || [];
  // Flow may assign the same display title to multiple distinct clips.
  if (titles.length !== 3 || titles.some(t => !t)) {
    job.error = 'NOT VERIFIED: ຈັບຄູ່ຊື່ຄລິບກັບ 3 ສາກບໍ່ໄດ້'; setPhase('error'); return;
  }
  // Preserve the scene number with its Flow title.  A pipe-delimited list
  // loses that identity when a title is blank or duplicated and was the
  // source of 1→3→2 assemblies.
  const combineManifest = F('combine-manifest.json');
  const scenes = titles.map((title, i) => ({ scene: i + 1, title, fp: fps[i] || '' }));
  const fpCount = scenes.filter(s => s.fp).length;
  logLn(fpCount === 3
    ? 'ມີລາຍນິ້ວມືຮູບຄົບ 3 ສາກ — ຕອນລວມຈະຢືນຢັນຮູບທຸກຄລິບ'
    : `ມີລາຍນິ້ວມືຮູບ ${fpCount}/3 — ສາກທີ່ບໍ່ມີຈະກວດໄດ້ແຕ່ຊື່`);
  fs.writeFileSync(combineManifest, JSON.stringify({ version: 1, scenes }, null, 2));
  job.combineManifest = combineManifest;
  saveJob();
  {
      const outFile = F('final-combined.mp4'); let sceneUrl = '', gotFile = '', manualReason = '', orderUnverified = false;
      // ສົ່ງຊື່ສິນຄ້າໄປນຳ ເພື່ອໃຫ້ໄຟລ໌ໃນ Downloads ມີຊື່ບອກວ່າແມ່ນວິດີໂອຂອງຫຍັງ
      runWorker(['combine-scene', job.projectUrl || '', combineManifest, outFile, job.product.name || ''], line => {
        const m = line.match(/@@COMBINE_DONE (.+)$/);
        if (m) { try { const o = JSON.parse(m[1]); sceneUrl = o.url || ''; gotFile = o.file || ''; } catch { /* ignore */ } }
        const mm = line.match(/@@COMBINE_MANUAL (.+)$/);
        if (mm) { try { manualReason = JSON.parse(mm[1]).reason || ''; } catch { /* ignore */ } }
        if (/@@COMBINE_ORDER_UNVERIFIED /.test(line)) orderUnverified = true;
      }, code => {
        job.sceneUrl = sceneUrl; job.finalFile = gotFile;
        const exported = code === 0 && gotFile && fs.existsSync(gotFile);
        job.project.status = exported ? 'combined' : 'ready-to-assemble';
        if (!exported) {
          const wrongClip = manualReason.match(/clip at position (\d+) is scene (\d+)/);
          job.error = wrongClip
            ? `NOT VERIFIED: ຮູບຄລິບທີ່ຕຳແໜ່ງ ${wrongClip[1]} ແມ່ນຂອງສາກ ${wrongClip[2]} — ຢຸດກ່ອນລວມ ບໍ່ດາວໂຫຼດວິດີໂອທີ່ລຳດັບຜິດ`
            : /scene order wrong/.test(manualReason)
            ? `NOT VERIFIED: ລຳດັບຄລິບໃນ scene ຜິດ (${manualReason}) — ບໍ່ດາວໂຫຼດ`
            : `NOT VERIFIED: ມີ 3 ຄລິບ ແຕ່ຍັງບໍ່ຢືນຢັນການຕໍ່ຄລິບ/ດາວໂຫຼດ MP4${manualReason ? ` (${manualReason})` : ''}`;
          setPhase('error'); return;
        }
        job.error = '';
        // ດາວໂຫຼດສຳເລັດ ແຕ່ຖ້າອ່ານຊື່ຄລິບບໍ່ໄດ້ ຕ້ອງບອກຜູ້ໃຊ້ຕາມຈິງວ່າບັອດກວດ
        // ລຳດັບ 1→2→3 ດ້ວຍຕາບໍ່ໄດ້ — ຢ່າອ້າງວ່າຢືນຢັນແລ້ວ
        if (orderUnverified) {
          logLn('ເຕືອນ: ອ່ານຊື່ຄລິບໃນ timeline ບໍ່ໄດ້ — ດາວໂຫຼດແລ້ວ ແຕ່ບໍ່ໄດ້ກວດລຳດັບ ກະລຸນາເປີດເບິ່ງເອງ');
          setPhase('done', 'ລວມ 3 ຄລິບ ແລະດາວໂຫຼດ MP4 ແລ້ວ — ແຕ່ບໍ່ໄດ້ກວດລຳດັບ ກະລຸນາເປີດເບິ່ງ');
          rotateProjectAfterDownload();
          return;
        }
        setPhase('done', 'ລວມ 3 ຄລິບຕາມ 1→2→3 ແລະດາວໂຫຼດ MP4 ແລ້ວ');
        rotateProjectAfterDownload();
      }, 'combine');
  }
}

function resetFlowProjectOutputs(nextUrl) {
  job.projectUrl = nextUrl;
  // ຂໍ້ມູນຊຸດນີ້ຜູກກັບ project ເກົ່າ. ຖ້າປ່ອຍ 3/3 ໄວ້ UI ຈະຄິດວ່າ
  // project ໃໝ່ມີ storyboard/video ຄົບແລ້ວ ແລະສົ່ງວຽກໄປຜິດ project.
  // ເກັບ form/script ໄວ້ໃຫ້ໃຊ້ຊ້ຳໄດ້ ແຕ່ reset ສະເພາະ output ຈາກ Flow.
  job.sheetsDone = 0;
  job.sheetFiles = [];
  job.heroPath = '';
  job.clipsDone = 0;
  job.clipTitles = [];
  job.clipFps = [];
  job.videoSubmitted = {};
  job.policyWaitClip = 0;
  job.policyWaitProject = '';
  job.project = { name: '', clips: [], status: 'not-started' };
  for (const f of ['storyboard-assets.json', 'combine-manifest.json']) {
    try { fs.unlinkSync(F(f)); } catch { /* ບໍ່ມີກໍບໍ່ເປັນຫຍັງ */ }
  }
  job.sceneUrl = '';
  job.combineManifest = '';
  job.error = '';
  job.phase = 'home';
  job.msg = 'ສ້າງ Project ໃໝ່ແລ້ວ — ເລີ່ມຮອບຕໍ່ໄປໄດ້';
}

// ຫຼັງດາວໂຫຼດຈົບ: ປິດ project ເກົ່າ (ກັບ home) ແລ້ວສ້າງ project ໃໝ່ ເພື່ອໃຫ້ຮອບ
// ຕໍ່ໄປເລີ່ມໃນ project ສະອາດໂດຍບໍ່ຕ້ອງໃຫ້ຜູ້ໃຊ້ມາເປີດເອງ. ເປີດ/ປິດໄດ້ທີ່ settings.
function rotateProjectAfterDownload() {
  if (settings.autoNewProject === false) return;
  if (isBusy()) return;   // ຢ່າຊ້ອນກັບວຽກທີ່ກຳລັງແລ່ນ
  const oldUrl = job.projectUrl || '';
  logLn('ກຳລັງປິດ project ເກົ່າ ແລະ ສ້າງ project ໃໝ່ສຳລັບຮອບຕໍ່ໄປ...');
  let newUrl = '';
  let newProjectReason = '';
  runWorker(['new-project', oldUrl], line => {
    const m = line.match(/@@NEW_PROJECT (.+)$/);
    if (m) {
      try {
        const o = JSON.parse(m[1]);
        if (o.ok && o.url) newUrl = o.url;
        else if (o.reason) newProjectReason = String(o.reason);
      } catch { /* ignore */ }
    }
  }, () => {
    if (!newUrl) {
      logLn(`ສ້າງ project ໃໝ່ບໍ່ສຳເລັດ${newProjectReason ? `: ${newProjectReason}` : ''} — ຮອບໜ້າໃຫ້ເປີດ project ໃນ Flow ເອງ`);
      return;
    }
    resetFlowProjectOutputs(newUrl);
    saveJob();
    logLn('ພ້ອມຮອບຕໍ່ໄປ: project ໃໝ່ ' + newUrl);
  }, 'new-project');
}

// ---------- HTTP ----------
function send(res, code, body, ct) {
  if (typeof body === 'object' && !Buffer.isBuffer(body)) { body = JSON.stringify(body); ct = ct || 'application/json; charset=utf-8'; }
  res.writeHead(code, { 'Content-Type': ct || 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function publicState() {
  if ((job.sheetsDone || 0) === 3 && /ສ້າງໄດ້ແທ້ 0\/3 ແຜ່ນ/.test(job.error || '')) {
    job.error = ''; setPhase('review-sb', 'ຮູບ Storyboard ຄົບ 3 ແຜ່ນ — ສາມາດສ້າງວິດີໂອຕໍ່ໄດ້');
  }
  if ((job.sheetsDone || 0) < 3) {
    try {
      const manifest = JSON.parse(fs.readFileSync(F('storyboard-assets.json'), 'utf8'));
      if (manifest.projectUrl === job.projectUrl && [1, 2, 3].every(n =>
        manifest.assets.some(a => a.sheet === n && a.url && fs.existsSync(F(`sb-sheet-${n}.png`))))) {
        job.sheetsDone = 3; job.sheetFiles = [1, 2, 3].map(n => F(`sb-sheet-${n}.png`));
        if (/ສ້າງໄດ້ແທ້ 0\/3 ແຜ່ນ/.test(job.error || '')) job.error = '';
        saveJob();
      }
    } catch { /* no complete storyboard in the current project */ }
  }
  const ref = job.product.refPath;
  const refStat = ref ? (() => { try { return fs.statSync(ref); } catch { return null; } })() : null;
  return {
    version: VERSION, phase: job.phase, msg: job.msg, error: job.error,
    product: job.product, hasRef: !!refStat, refVersion: refStat ? `${refStat.size}-${refStat.mtimeMs}` : '', note: job.note, story: job.story, brief: job.brief || '',
    briefRevision: job.briefRevision || 0, briefStatus: job.briefStatus || 'idle', briefError: job.briefError || '',
    briefWarnings: Array.isArray(job.briefWarnings) ? job.briefWarnings : [],
    script: job.script, scriptErrs: job.scriptErrs,
    sheetsDone: job.sheetsDone, clipsDone: job.clipsDone,
    policyWaitClip: job.policyWaitClip || 0,
    project: job.project, projectUrl: job.projectUrl || '',
    settings, busy: job.busy || isBusy(), continuity: job.continuity || '', continuityErrs: job.continuityErrs || [], auto: !!job.auto,
    clipTitles: job.clipTitles || [], sceneUrl: job.sceneUrl || '', finalFile: job.finalFile || '',
    hasHero: !!(job.heroPath && fs.existsSync(job.heroPath)),
    update: { ...upd.state, auto: settings.autoUpdate !== false },
    log: job.log.slice(-80),
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (req.method === 'GET' && p === '/') return send(res, 200, fs.readFileSync(path.join(APP, 'ui.html')), 'text/html; charset=utf-8');
    // ລາຍການສິນຄ້າ + ກຸ່ມເປົ້າໝາຍ — ແກ້ເພີ່ມ/ລຶບໄດ້ທີ່ໄຟລ໌ products.json ໂດຍບໍ່ແຕະໂຄ້ດ
    if (req.method === 'GET' && p === '/api/products') {
      try { return send(res, 200, fs.readFileSync(path.join(APP, 'products.json')), 'application/json; charset=utf-8'); }
      catch { return send(res, 200, { products: [], audiences: [] }); }
    }
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: VERSION, capabilities: CAPABILITIES, appPath: APP });
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, publicState());
    if (req.method === 'GET' && p === '/api/timings') return send(res, 200, {
      ...job.timings,
      current: job.phaseStartedAt ? { phase: job.phase, startedAt: job.phaseStartedAt, elapsedMs: Date.now() - job.phaseStartedAt } : null,
    });
    if (req.method === 'GET' && p === '/hero-image') {
      const hp = job.heroPath;
      if (!hp || !fs.existsSync(hp)) return send(res, 404, 'no hero');
      return send(res, 200, fs.readFileSync(hp), 'image/png');
    }
    if (req.method === 'GET' && p === '/ref-image') {
      const rp = job.product.refPath;
      if (!rp || !fs.existsSync(rp)) return send(res, 404, 'no ref');
      const ct = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[rp.split('.').pop().toLowerCase()] || 'application/octet-stream';
      return send(res, 200, fs.readFileSync(rp), ct);
    }

    // Browser pages on other sites can submit simple cross-origin form requests
    // to loopback services even when they cannot read the response. Mutations
    // must come from this UI's own loopback origin.
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const origin = req.headers.origin;
    const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
    if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'origin not allowed' });

    // POST
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20000000) req.destroy(); });
    req.on('end', async () => {
      let b = {}; try { b = JSON.parse(body || '{}'); } catch { /* empty */ }
      if (p === '/api/update-check') {
        await upd.check();
        if (upd.state.status === 'available' && settings.autoUpdate !== false) tryApply();
        return send(res, 200, { ok: true, update: upd.state });
      }
      if (p === '/api/restart') {
        // ຂ້າ worker ກ່ອນ restart — ບໍ່ດັ່ງນັ້ນມັນກາຍເປັນ process ກຳພ້າ
        // ທີ່ຍັງຄຸມ Chrome ຢູ່ ແລະ job ຈະຄ້າງ busy ຕະຫຼອດ
        if (isBusy()) logLn('restart: ຢຸດວຽກທີ່ກຳລັງແລ່ນກ່ອນ');
        killWorker();
        send(res, 200, { ok: true, restarting: true, version: VERSION });
        setTimeout(() => process.exit(75), 150);
        return;
      }
      // Recover when the user has made/opened a different Flow project while
      // the dashboard is idle.  This is intentionally a preflight action: it
      // reads the single open Flow tab, never clicks Generate, then clears only
      // output state that belongs to the old project.
      if (p === '/api/sync-flow-project') {
        if (isBusy()) return send(res, 409, { ok: false, error: 'ມີວຽກກຳລັງແລ່ນຢູ່' });
        let activeUrl = '';
        runWorker(['prep-tabs', '1'], line => {
          const m = line.match(/@@TABS_READY (.+)$/);
          if (m) { try { activeUrl = JSON.parse(m[1]).projectUrl || ''; } catch { /* ignore */ } }
        }, code => {
          if (code !== 0 || !activeUrl) { logLn('ກວດ Project Flow ປັດຈຸບັນບໍ່ສຳເລັດ'); return; }
          if (activeUrl !== job.projectUrl) {
            resetFlowProjectOutputs(activeUrl);
            saveJob();
            logLn('ພົບ Project Flow ໃໝ່ — reset ສະຖານະຂອງ Project ເກົ່າໃຫ້ແລ້ວ');
          } else logLn('Project Flow ປັດຈຸບັນຕົງກັບ dashboard ແລ້ວ');
        }, 'sync-project');
        return send(res, 202, { ok: true, started: true });
      }
      if (p === '/api/settings') { settings = { ...settings, ...b }; saveSettings(); return send(res, 200, { ok: true }); }
      if (p === '/api/resume-combine') {
        // ຄລິບສ້າງຄົບແລ້ວ ແຕ່ຍັງບໍ່ໄດ້ຕໍ່ — ສືບຕໍ່ ບໍ່ຕ້ອງສ້າງວິດີໂອໃໝ່
        if (isBusy()) return send(res, 409, { ok: false, error: 'ມີວຽກກຳລັງແລ່ນຢູ່' });
        if ((job.clipTitles || []).filter(Boolean).length !== 3) {
          return send(res, 400, { ok: false, error: 'ຍັງບໍ່ມີຊື່ຄລິບຄົບ 3 ສາກ — ສືບຕໍ່ບໍ່ໄດ້' });
        }
        job.error = '';
        logLn('ສືບຕໍ່ຂັ້ນຕໍ່ຄລິບ ແລະ ດາວໂຫຼດ (ຄລິບມີຄົບແລ້ວ)');
        startCombine();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/recover-combined') {
        // Recover a scene that Flow exported successfully after an older worker
        // got stuck counting duplicate clip titles.
        const file = String(b.file || '');
        let stat = null, header = null;
        try { stat = fs.statSync(file); header = fs.readFileSync(file).subarray(0, 12); } catch { /* invalid file */ }
        const isMp4 = !!(stat && stat.isFile() && stat.size > 1000000 && header && header.subarray(4, 8).toString('ascii') === 'ftyp');
        if (!isMp4) return send(res, 400, { ok: false, error: 'MP4 export not verified' });
        job.clipsDone = 3;
        job.clipTitles = Array.isArray(b.titles) ? b.titles.slice(0, 3) : (job.clipTitles || []);
        job.sceneUrl = String(b.url || job.sceneUrl || '');
        job.finalFile = file;
        job.error = '';
        if (!job.project) job.project = { name: `${job.product.name || 'JOD FLOW'} — Close Sale`, clips: [] };
        job.project.status = 'combined';
        setPhase('done', 'ລວມ 3 ຄລິບຕາມ 1→2→3 ແລະດາວໂຫຼດ MP4 ແລ້ວ');
        return send(res, 200, { ok: true, file, bytes: stat.size });
      }
      if (p === '/api/describe-pack') {
        // ໃຫ້ AI ອ່ານຮູບແລ້ວຂຽນ "ລັກສະນະ" ໃຫ້ເອງ — ຕາມໂໝດ: ສິນຄ້າ ແລະ/ຫຼື ຄົນ
        if (isBusy()) return send(res, 409, { ok: false, error: 'ບັອດກຳລັງເຮັດວຽກຢູ່' });
        const mode = job.product.mode || 'product';
        const productRef = job.product.refPath || '';
        const personRef = (job.product.personRefs || []).find(x => fs.existsSync(x)) || '';
        const needProduct = mode !== 'course';
        const needPerson = mode === 'review' || mode === 'course';
        if (needProduct && (!productRef || !fs.existsSync(productRef))) return send(res, 400, { ok: false, error: 'ອັບຮູບສິນຄ້າກ່ອນ' });
        if (needPerson && !personRef) return send(res, 400, { ok: false, error: 'ອັບຮູບຄົນກ່ອນ' });
        const describeProduct = (done) => {
          if (!needProduct) return done();
          const outFile = F('packlook-ai.txt');
          try { fs.unlinkSync(outFile); } catch { /* ok */ }
          logLn('ໃຫ້ AI ອ່ານຮູບສິນຄ້າແລ້ວຂຽນລັກສະນະກ່ອງ...');
          runWorker(['describe-pack', settings.ai, productRef, outFile], null, code => {
            if (code === 0 && fs.existsSync(outFile)) {
              const txt = fs.readFileSync(outFile, 'utf8').trim();
              job.product.packLook = txt; saveJob();
              logLn(`ໄດ້ລັກສະນະກ່ອງຈາກ AI ${txt.length} ຕົວອັກສອນ`);
            } else logLn('AI ຂຽນລັກສະນະກ່ອງບໍ່ສຳເລັດ (code ' + code + ')');
            done();
          }, 'describe');
        };
        const describePerson = (done) => {
          if (!needPerson) return done();
          const outFile = F('personlook-ai.txt');
          try { fs.unlinkSync(outFile); } catch { /* ok */ }
          logLn('ໃຫ້ AI ອ່ານຮູບຄົນແລ້ວຂຽນລັກສະນະຄົນ...');
          runWorker(['describe-pack', settings.ai, personRef, outFile, '', 'person'], null, code => {
            if (code === 0 && fs.existsSync(outFile)) {
              const txt = fs.readFileSync(outFile, 'utf8').trim();
              job.product.personLook = txt; saveJob();
              logLn(`ໄດ້ລັກສະນະຄົນຈາກ AI ${txt.length} ຕົວອັກສອນ`);
            } else if (code === 8) {
              job.descWarn = 'ຮູບໃນຊ່ອງ "ຮູບຄົນ" ອ່ານບໍ່ເຫັນຄົນ — ອາດວາງສະຫຼັບກັບຮູບສິນຄ້າ'; saveJob();
              logLn('ຮູບຄົນອ່ານບໍ່ເຫັນຄົນ (ອາດວາງສະຫຼັບຊ່ອງ)');
            } else logLn('AI ຂຽນລັກສະນະຄົນບໍ່ສຳເລັດ (code ' + code + ')');
            done();
          }, 'describe-person');
        };
        // ສິນຄ້າກ່ອນ ແລ້ວຄົນ (ຕາມລຳດັບ ເພາະໃຊ້ແຊັດ AI ດຽວກັນ)
        describeProduct(() => describePerson(() => {}));
        return send(res, 200, { ok: true, started: true });
      }
      if (p === '/api/product') {
        job.product = { ...job.product, ...b };
        // ກວດ mode ແລະ ລ້າງຮູບທີ່ບໍ່ກ່ຽວຂ້ອງຕາມໂໝດ (ກັນ buildHero ຍິງຜິດ/ຮູບຕົກຄ້າງ)
        if (b.mode !== undefined) {
          const mode = ['product', 'review', 'course'].includes(b.mode) ? b.mode : 'product';
          job.product.mode = mode;
          if (mode === 'course') { job.product.refPath = ''; job.product.refName = ''; job.product.packLook = ''; }
          if (mode === 'product') { job.product.personRefs = []; }
          // ຮູບສິນຄ້າເພີ່ມ (extraRefs) ມີແຕ່ໂໝດສິນຄ້າ — ໂໝດອື່ນລ້າງ
          if (mode !== 'product') { job.product.extraRefs = []; }
        }
        if (!Array.isArray(job.product.personRefs)) job.product.personRefs = [];
        if (!Array.isArray(job.product.extraRefs)) job.product.extraRefs = [];
        if (b.note !== undefined && b.note !== job.note) { job.note = skill.thaiToLao(skill.stripAICitations(b.note)); job.narrationSource = 'manual'; }
        job.story = b.story !== undefined ? skill.thaiToLao(skill.stripAICitations(b.story)) : job.story;
        job.brief = b.brief ?? job.brief; saveJob(); return send(res, 200, { ok: true });
      }
      if (p === '/api/expand-brief' || p === '/api/auto-script') {
        const autoScript = p === '/api/auto-script';
        if (isBusy()) return send(res, 200, { ok: false, error: 'ບັອດກຳລັງເຮັດວຽກຢູ່' });
        const brief = String(b.brief ?? job.brief ?? '').trim();
        if (!brief) return send(res, 200, { ok: false, error: 'ກະລຸນາພິມ brief ກ່ອນ' });
        if (autoScript && (job.product.mode || 'product') !== 'course' && (!job.product.refPath || !fs.existsSync(job.product.refPath))) {
          return send(res, 200, { ok: false, error: 'ກະລຸນາເລືອກຮູບສິນຄ້າກ່ອນ' });
        }
        job.brief = brief;
        if (autoScript) job.autoScriptChatUrl = '';
        job.briefStatus = 'generating';
        job.briefError = '';
        saveJob();
        const reqFile = F('brief-expand-request.txt'), outFile = F('brief-expand-result.txt');
        fs.writeFileSync(reqFile, skill.buildBriefExpansionRequest(brief));
        logLn('ສົ່ງ brief ໃຫ້ AI ແຍກເປັນຂໍ້ມູນຟອມ, Storyboard ແລະບົດພາກ...');
        const acceptDraft = draft => {
          job.product.name = draft.name;
          job.product.desc = draft.desc;
          job.story = draft.story;
          job.note = draft.narration;
          job.narrationSource = 'ai-brief';
          job.briefRevision = Number(job.briefRevision || 0) + 1;
          job.briefStatus = 'done';
          job.briefError = '';
          job.briefWarnings = Array.isArray(draft._warnings) ? draft._warnings : [];
          job.msg = job.briefWarnings.length
            ? `AI ໃສ່ຂໍ້ມູນລົງຟອມແລ້ວ — ກວດບົດພາກ: ${job.briefWarnings.join(' | ')}`
            : 'AI ໃສ່ຂໍ້ມູນລົງຟອມຄົບແລ້ວ';
          saveJob();
          logLn('AI ແຍກ brief ຜ່ານການກວດ 12/12 Shot ແລະໃສ່ຟອມໃຫ້ແລ້ວ');
        };
        const failDraft = message => {
          job.briefStatus = 'error';
          job.briefError = message;
          saveJob();
          logLn(message);
        };
        let chatUrl = '';
        runWorker(autoScript
          ? ['ask', settings.ai, reqFile, outFile, '', '', 'auto-new-chat']
          : ['ask', settings.ai, reqFile, outFile], line => {
          if (!autoScript) return;
          const m = line.match(/@@AI_CHAT_URL (.+)$/);
          if (m) { try { chatUrl = JSON.parse(m[1]).url || ''; job.autoScriptChatUrl = chatUrl; saveJob(); } catch { /* ignore */ } }
        }, code => {
          if (code !== 0 || !fs.existsSync(outFile)) {
            failDraft(code === 9
              ? 'ຕັ້ງ Gemini 3.5 Flash-Lite ແລະລະດັບຄິດຕ່ຳບໍ່ສຳເລັດ — ຍັງບໍ່ໄດ້ສົ່ງ brief'
              : `AI ຂະຫຍາຍ brief ບໍ່ສຳເລັດ (code ${code})`);
            return;
          }
          try {
            acceptDraft(parseBriefDraft(fs.readFileSync(outFile, 'utf8')));
            if (autoScript) startAutoScriptPipeline(chatUrl);
          } catch (e) {
            const errors = Array.isArray(e.qualityErrors) ? e.qualityErrors : [e && e.message || String(e)];
            failDraft('AI ຕອບ brief ບໍ່ຜ່ານການກວດ 1 ເທື່ອ: ' + errors.join(' | '));
          }
        }, 'expand-brief');
        return send(res, 200, { ok: true, started: true });
      }
      if (p === '/api/upload-ref') {
        // b: { dataUrl, filename }  — ຮູບສິນຄ້າຕົ້ນສະບັບ
        const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(b.dataUrl || '');
        if (!m) return send(res, 200, { ok: false, error: 'ຮູບບໍ່ຖືກຕ້ອງ (ຮອງຮັບ PNG/JPG/WEBP)' });
        const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        const safeBase = (b.filename || 'product').replace(/[^a-z0-9_.-]/gi, '_').replace(/\.[^.]+$/, '').slice(0, 40) || 'product';
        const outPath = F(`product-ref.${ext}`);
        fs.writeFileSync(outPath, Buffer.from(m[2], 'base64'));
        job.product.refPath = outPath;
        job.product.refName = safeBase;
        saveJob();
        return send(res, 200, { ok: true, path: outPath, bytes: fs.statSync(outPath).size });
      }
      if (p === '/api/upload-person-refs') {
        // b: { images: [{dataUrl, filename}] } — ຮູບຄົນ (ແທນລາຍເກົ່າທັງໝົດ), ສູງສຸດ 5 ຮູບ
        const imgs = Array.isArray(b.images) ? b.images.slice(0, 5) : [];
        // ລຶບຮູບຄົນເກົ່າກ່ອນ ເພື່ອບໍ່ໃຫ້ຮູບຕົກຄ້າງ
        for (const old of (job.product.personRefs || [])) { try { fs.rmSync(old); } catch { /* ignore */ } }
        const paths = [];
        for (let i = 0; i < imgs.length; i++) {
          const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec((imgs[i] && imgs[i].dataUrl) || '');
          if (!m) return send(res, 200, { ok: false, error: `ຮູບຄົນລຳດັບ ${i + 1} ບໍ່ຖືກຕ້ອງ (PNG/JPG/WEBP)` });
          const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
          const outPath = F(`person-ref-${i + 1}.${ext}`);
          fs.writeFileSync(outPath, Buffer.from(m[2], 'base64'));
          paths.push(outPath);
        }
        job.product.personRefs = paths;
        saveJob();
        return send(res, 200, { ok: true, count: paths.length, paths });
      }
      if (p === '/api/upload-extra-refs') {
        // b: { images: [{dataUrl, filename}] } — ຮູບສິນຄ້າເພີ່ມ (ໂໝດສິນຄ້າ), ແທນລາຍເກົ່າ, ສູງສຸດ 4 (ຮວມຮູບຫຼັກ = 5)
        const imgs = Array.isArray(b.images) ? b.images.slice(0, 4) : [];
        for (const old of (job.product.extraRefs || [])) { try { fs.rmSync(old); } catch { /* ignore */ } }
        const paths = [];
        for (let i = 0; i < imgs.length; i++) {
          const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec((imgs[i] && imgs[i].dataUrl) || '');
          if (!m) return send(res, 200, { ok: false, error: `ຮູບສິນຄ້າເພີ່ມລຳດັບ ${i + 1} ບໍ່ຖືກຕ້ອງ (PNG/JPG/WEBP)` });
          const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
          const outPath = F(`product-extra-${i + 1}.${ext}`);
          fs.writeFileSync(outPath, Buffer.from(m[2], 'base64'));
          paths.push(outPath);
        }
        job.product.extraRefs = paths;
        saveJob();
        return send(res, 200, { ok: true, count: paths.length, paths });
      }
      if (p === '/api/ref-info') return send(res, 200, { path: job.product.refPath || '', name: job.product.refName || '', personRefs: job.product.personRefs || [], extraRefs: job.product.extraRefs || [], mode: job.product.mode || 'product' });
      if (p === '/api/start') {
        if (isBusy()) return send(res, 200, { ok: false, error: 'ຍັງບໍ່ວ່າງ' });
        {
          const mode = job.product.mode || 'product';
          const persons = (job.product.personRefs || []).filter(x => fs.existsSync(x));
          const hasProduct = job.product.refPath && fs.existsSync(job.product.refPath);
          if (!job.product.name) return send(res, 200, { ok: false, error: mode === 'course' ? 'ຍັງບໍ່ມີຊື່ຄອດ' : 'ຍັງບໍ່ມີຊື່ສິນຄ້າ' });
          if (mode === 'course') {
            if (!persons.length) return send(res, 200, { ok: false, error: 'ຍັງບໍ່ມີຮູບຄົນ/ຜູ້ສອນ ອັບໂຫຼດກ່ອນ' });
          } else {
            if (!hasProduct) return send(res, 200, { ok: false, error: 'ຍັງບໍ່ມີຮູບສິນຄ້າຈິງ ອັບໂຫຼດກ່ອນ (SKILL ບັງຄັບ)' });
            if (mode === 'review' && !persons.length) return send(res, 200, { ok: false, error: 'ຍັງບໍ່ມີຮູບຄົນ ອັບໂຫຼດກ່ອນ' });
          }
        }
        job.error = '';
        const startMode = job.product.mode || 'product';
        const needProductDesc = startMode !== 'course';
        const needPersonDesc = startMode === 'review' || startMode === 'course';
        const productRef = job.product.refPath || '';
        const personRef = (job.product.personRefs || []).find(x => fs.existsSync(x)) || '';
        const sigOf = (p) => { try { const st = fs.statSync(p); return `${st.size}-${Math.round(st.mtimeMs)}`; } catch { return ''; } };
        const refSig = productRef ? sigOf(productRef) : '';
        const personSig = personRef ? sigOf(personRef) : '';
        if (startMode === 'course') job.product.packLook = '';

        // ຂັ້ນ A: ໃຫ້ AI ອ່ານຮູບສິນຄ້າ → packLook (ໂໝດສິນຄ້າ/ຄົນລິວິວ)
        const describeProduct = (next) => {
          if (!needProductDesc || !productRef) return next();
          if (job.product.packLook && job.product.packLook.length > 120 && job.packLookFor === refSig) {
            logLn('ມີລັກສະນະກ່ອງຢູ່ແລ້ວ ແລະ ຮູບບໍ່ປ່ຽນ — ຂ້າມຂັ້ນອ່ານຮູບສິນຄ້າ');
            return next();
          }
          const outFile = F('packlook-ai.txt');
          try { fs.unlinkSync(outFile); } catch { /* ok */ }
          setPhase('script', 'ຂັ້ນ 1/2 — ໃຫ້ AI ອ່ານຮູບສິນຄ້າ...');
          logLn('ຂັ້ນ 1/2 — ໃຫ້ AI ອ່ານຮູບສິນຄ້າແລ້ວຂຽນລັກສະນະກ່ອງ');
          runWorker(['describe-pack', settings.ai, productRef, outFile], null, code => {
            if (code === 0 && fs.existsSync(outFile)) {
              const txt = fs.readFileSync(outFile, 'utf8').trim();
              if (txt.length > 120) { job.product.packLook = txt; job.packLookFor = refSig; saveJob(); logLn(`ໄດ້ລັກສະນະກ່ອງ ${txt.length} ຕົວອັກສອນ — ໃສ່ຊ່ອງໃຫ້ແລ້ວ`); }
            } else {
              logLn('ຂຽນລັກສະນະກ່ອງບໍ່ສຳເລັດ — ຂຽນບົດຕໍ່' + (job.product.packLook ? ' ດ້ວຍລາຍກ່ອງເກົ່າ' : ' ໂດຍບໍ່ມີລາຍກ່ອງ'));
              if (code === 124) { job.error = 'AI ອ່ານຮູບດົນເກີນໄປ — ກວດອິນເຕີເນັດ/ແຊັດ AI ແລ້ວກົດໃໝ່'; setPhase('error'); return; }
            }
            next();
          }, 'describe');
        };

        // ຂັ້ນ B: ໃຫ້ AI ອ່ານຮູບຄົນ → personLook (ໂໝດຄົນລິວິວ/ຂາຍຄອດ)
        const describePerson = (next) => {
          if (!needPersonDesc || !personRef) return next();
          if (job.product.personLook && job.product.personLook.length > 60 && job.personLookFor === personSig) {
            logLn('ມີລັກສະນະຄົນຢູ່ແລ້ວ ແລະ ຮູບບໍ່ປ່ຽນ — ຂ້າມຂັ້ນອ່ານຮູບຄົນ');
            return next();
          }
          const outP = F('personlook-ai.txt');
          try { fs.unlinkSync(outP); } catch { /* ok */ }
          setPhase('script', 'ໃຫ້ AI ອ່ານຮູບຄົນ...');
          logLn('ໃຫ້ AI ອ່ານຮູບຄົນແລ້ວຂຽນລັກສະນະຄົນ');
          runWorker(['describe-pack', settings.ai, personRef, outP, '', 'person'], null, code => {
            if (code === 0 && fs.existsSync(outP)) {
              const txt = fs.readFileSync(outP, 'utf8').trim();
              if (txt.length > 60) { job.product.personLook = txt; job.personLookFor = personSig; saveJob(); logLn(`ໄດ້ລັກສະນະຄົນ ${txt.length} ຕົວອັກສອນ — ໃສ່ຊ່ອງໃຫ້ແລ້ວ`); }
            } else if (code === 8) {
              // ຮູບຄົນອ່ານບໍ່ເຫັນຄົນ — ອາດວາງຮູບສະຫຼັບຊ່ອງ → ຢຸດ ບອກຜູ້ໃຊ້
              job.error = 'ຮູບໃນຊ່ອງ "ຮູບຄົນ" ອ່ານບໍ່ເຫັນຄົນ — ກວດວ່າວາງຮູບຖືກຊ່ອງບໍ (ອາດສະຫຼັບ ຮູບຄົນ ↔ ຮູບສິນຄ້າ). ແກ້ແລ້ວອັບໃໝ່';
              setPhase('error');
              logLn('ຢຸດ: ຮູບຄົນອ່ານບໍ່ເຫັນຄົນ (ອາດວາງສະຫຼັບຊ່ອງ)');
              return;
            } else {
              logLn('ຂຽນລັກສະນະຄົນບໍ່ສຳເລັດ — ຂຽນບົດຕໍ່');
              if (code === 124) { job.error = 'AI ອ່ານຮູບຄົນດົນເກີນໄປ — ກວດອິນເຕີເນັດ/ແຊັດ AI ແລ້ວກົດໃໝ່'; setPhase('error'); return; }
            }
            next();
          }, 'describe-person');
        };

        // ຕາມລຳດັບ (ແຊັດ AI ດຽວ): ສິນຄ້າ → ຄົນ → ຂຽນບົດ
        describeProduct(() => describePerson(() => {
          logLn('ຂັ້ນ 2/2 — ຂຽນບົດເລື່ອງ ແລະ ບົດພາກ 12 shot');
          stepScript();
        }));
        return send(res, 200, { ok: true, chained: true });
      }
      if (p === '/api/edit-script') {
        // ກັນບົດຫາຍ: ຖ້າສົ່ງບົດຫວ່າງມາທັງທີ່ມີບົດຢູ່ແລ້ວ ຖືວ່າໜ້າຈໍຍັງບໍ່ທັນໂຫຼດ — ບໍ່ລຶບທັບ
        const incoming = Array.isArray(b.script) ? b.script : [];
        if (!incoming.length && (job.script || []).length) {
          logLn('ປະຕິເສດການບັນທຶກບົດຫວ່າງ — ເກັບບົດເກົ່າ ' + job.script.length + ' shot ໄວ້');
          return send(res, 200, { ok: false, error: 'ບົດຫວ່າງ ບໍ່ບັນທຶກທັບ', errs: job.scriptErrs || [] });
        }
        job.script = incoming;
        job.scriptErrs = skill.validateScript(job.script, job.product);
        saveJob();
        return send(res, 200, { ok: true, errs: job.scriptErrs });
      }
      if (p === '/api/fix-script') {
        if (isBusy()) return send(res, 200, { ok: false, error: 'ຍັງບໍ່ວ່າງ' });
        const semanticIssues = skill.dialogueIssues(job.script, job.product);
        const semanticBad = new Set(semanticIssues.map(x => x.shot));
        const allBad = job.script.filter(s => !skill.fits(s.text, s.seconds).ok || semanticBad.has(s.shot));
        if (!allBad.length) {
          job.scriptErrs = skill.validateScript(job.script, job.product);
          saveJob();
          return send(res, 200, { ok: true, fixed: 0, errs: job.scriptErrs });
        }
        job.error = '';
        saveJob();
        let targets = allBad.slice(0, 3); // Keep each Gemini request small enough for the 40-second dialogue timeout.
        const req = skill.buildSyllableFixRequest(targets, job.product, semanticIssues);
        const reqFile = F('ask-fix.txt'), outFile = F('ask-fix-out.txt');
        fs.writeFileSync(reqFile, req);
        // ລົບຜົນຮອບກ່ອນກ່ອນສົ່ງຮອບໃໝ່ — ບໍ່ໃຫ້ callback ເອົາບົດເກົ່າມາອ່ານຊ້ຳ.
        try { fs.unlinkSync(outFile); } catch { /* ບໍ່ມີຜົນເກົ່າ */ }
        const runFixAttempt = (attempt = 1) => runWorker(['ask', settings.ai, reqFile, outFile, job.product.refPath || ''], null, code => {
          if (code !== 0) {
            if (attempt < 3) {
              logLn(`AI ຍັງບໍ່ຕອບຊຸດນີ້ (code ${code}) — ລອງໃໝ່ ${attempt + 1}/3`);
              try { fs.unlinkSync(outFile); } catch { /* no stale output */ }
              return runFixAttempt(attempt + 1);
            }
            // Gemini/Chrome ອາດບໍ່ຕອບກ່ອນ timeout. ສຳລັບການແກ້ຄວາມຍາວ
            // ໃຫ້ມີ safe fallback ຈາກຂໍ້ຄວາມເດີມ: ຕັດໃຫ້ຢູ່ໃນງົບ 6-14 ພະຍາງສຳລັບ shot 2.5 ວິນາທີ
            // ແລ້ວ validate ກ່ອນຂຽນລົງຟອມ; ບໍ່ຂຽນທັບຖ້າຍັງບໍ່ຜ່ານ.
            let fallbackFixed = 0;
            for (const target of job.script.filter(s => !semanticBad.has(s.shot) && !skill.fits(s.text, s.seconds).ok)) {
              const safe = target.shot === 11
                  ? 'ສຸຂະພາບດີ ຊີວິດສົດໃສ'
                  : '';
              if (safe && skill.fits(safe, target.seconds).ok) {
                target.text = safe;
                fallbackFixed++;
                continue;
              }
              const max = skill.syllableBudget(target.seconds).max;
              const words = String(target.text || '').trim().split(/\s+/);
              let candidate = '';
              for (const word of words) {
                const next = candidate ? `${candidate} ${word}` : word;
                if (skill.countLaoSyllables(next) > max) break;
                candidate = next;
              }
              if (candidate && skill.fits(candidate, target.seconds).ok) {
                candidate = skill.stripAICitations(candidate);
                target.text = candidate.replace(/[\s,;:]+$/, '') + (/[.!?]$/.test(candidate) ? '' : '.');
                fallbackFixed++;
              }
            }
            job.scriptErrs = skill.validateScript(job.script, job.product);
            if (!job.scriptErrs.length) job.error = '';
            job.error = fallbackFixed
              ? (job.scriptErrs.length
                ? `AI ບໍ່ຕອບທັນ (code ${code}) — ແກ້ໄດ້ ${fallbackFixed} shot, ເຫຼືອ ${job.scriptErrs.length} ຂໍ້ຜິດ`
                : '')
              : `AI ແກ້ບົດພາກບໍ່ສຳເລັດ (code ${code})`;
            logLn(job.error);
            saveJob();
            return;
          }
          const raw = fs.readFileSync(outFile, 'utf8');
          const lines = raw.split('\n');
          let fixed = 0;
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li].trim();
            // ຮອງຮັບທັງ "Shot 2: ຂໍ້ຄວາມ" ແລະ
            // "Shot 2 | customer | 2.5s\nຂໍ້ຄວາມ" ທີ່ AI ອາດສົ່ງກັບມາ.
            let m = line.match(/^Shot\s+(\d{1,2})\s*:\s*(.+)$/i);
            if (m) {
              const idx = job.script.findIndex(s => s.shot === Number(m[1]));
              const replacement = skill.thaiToLao(skill.stripAICitations(m[2]));
              const target = idx >= 0 ? job.script[idx] : null;
              if (target && targets.some(s => s.shot === Number(m[1])) && skill.fits(replacement, target.seconds).ok) {
                target.text = replacement; fixed++;
              }
              continue;
            }
            m = line.match(/^Shot\s+(\d{1,2})\s*\|[^\n]*$/i);
            if (m) {
              const shotNo = Number(m[1]);
              const next = lines[li + 1] || '';
              const text = next.trim();
              const idx = job.script.findIndex(s => s.shot === shotNo);
              const replacement = skill.thaiToLao(skill.stripAICitations(text.replace(/^[-*]\s*/, '')));
              const target = idx >= 0 ? job.script[idx] : null;
              if (target && targets.some(s => s.shot === shotNo) && replacement && !/^SCENE\s*:/i.test(replacement)
                  && skill.fits(replacement, target.seconds).ok) {
                target.text = replacement; fixed++;
              }
            }
          }
          job.scriptErrs = skill.validateScript(job.script, job.product);
          saveJob();
          logLn(`ແກ້ອັດຕະໂນມັດ ${fixed} shot — ເຫຼືອ ${job.scriptErrs.length} ຂໍ້ຜິດ`);
          if (!fixed) {
            job.error = 'AI ຕອບກັບມາ ແຕ່ບໍ່ມີຄຳແທນທີ່ຖືກຮູບແບບ/ພະຍາງ — ຢຸດເພື່ອບໍ່ໃຫ້ວົນຊ້ຳ';
            saveJob();
            return;
          }
          const semanticRemaining = new Set(skill.dialogueIssues(job.script, job.product).map(x => x.shot));
          const remaining = job.script.filter(s => !skill.fits(s.text, s.seconds).ok || semanticRemaining.has(s.shot));
          if (remaining.length) {
            targets = remaining.slice(0, 3);
            logLn(`ຍັງເຫຼືອ ${remaining.length} shot — ແກ້ຊຸດຕໍ່ໄປ ${targets.map(s => s.shot).join(', ')}`);
            const nextIssues = skill.dialogueIssues(job.script, job.product);
            const nextReq = skill.buildSyllableFixRequest(targets, job.product, nextIssues);
            fs.writeFileSync(reqFile, nextReq);
            try { fs.unlinkSync(outFile); } catch { /* no stale output */ }
            return runFixAttempt(1);
          }
        }, 'fix-script');
        runFixAttempt();
        return send(res, 200, { ok: true, fixing: allBad.length });
      }
      if (p === '/api/approve-script') {
        const requiredDialogueErrors = skill.requiredDialogueErrors(job.script);
        if (requiredDialogueErrors.length) {
          job.scriptErrs = skill.validateScript(job.script, job.product); saveJob();
          return send(res, 200, { ok: false, error: `ບົດພາກຕ້ອງຄົບ 12/12 — ${requiredDialogueErrors.join('; ')}` });
        }
        if (job.scriptErrs && job.scriptErrs.length) {
          logLn(`ສ້າງຕໍ່ໂດຍມີ ${job.scriptErrs.length} ຄຳເຕືອນ: ${job.scriptErrs.slice(0, 4).join('; ')}`);
        }
        job.auto = !!b.auto; saveJob();
        if (job.auto) logLn('ເລີ່ມໂໝດອັດຕະໂນມັດ: ສ້າງ 3 ແຜ່ນ → ຕໍ່ 3 ວິດີໂອເອງ ບໍ່ຢຸດກາງທາງ');
        stepStoryboard();
        return send(res, 200, { ok: true, auto: job.auto });
      }
      if (p === '/api/resume-storyboard') {
        if (isBusy()) return send(res, 200, { ok: false, error: 'ມີວຽກກຳລັງແລ່ນຢູ່' });
        if (job.sheetsDone !== 1 || !/^https:\/\/flow\.google\.com\/project\//.test(job.projectUrl || ''))
          return send(res, 200, { ok: false, error: 'ຕ້ອງມີແຜ່ນ 1 ໃນ project ເດີມກ່ອນ' });
        runWorker(['recover-first-sheet', job.projectUrl], null, code => {
          if (code !== 0) { job.error = 'ກູ້ແຜ່ນ 1 ຈາກ Flow ບໍ່ໄດ້ — ບໍ່ສ້າງຊ້ຳ'; setPhase('error'); return; }
          job.auto = true; saveJob();
          logLn('ກູ້ແຜ່ນ 1 ໄດ້ແລ້ວ — ສືບຕໍ່ແຜ່ນ 2, 3 ແລະວິດີໂອ');
          stepStoryboard(2);
        }, 'recover-sheet');
        return send(res, 200, { ok: true, recovering: true });
      }
      if (p === '/api/approve-sb') {
        if (isBusy()) return send(res, 200, { ok: false, error: 'ມີວຽກກຳລັງແລ່ນຢູ່' });
        if (job.sheetsDone !== 3) return send(res, 200, { ok: false, error: `Storyboard ຍັງບໍ່ຄົບ 3 ແຜ່ນ (ສຳເລັດ ${job.sheetsDone || 0}/3)` });
        const oldScript = JSON.stringify(job.script || []);
        // Atomic save-before-video: the review page may contain dialogue edits
        // made after storyboard generation. Persist exactly those 12 current
        // shots before stepVideos builds clip-prompt-1..3.
        if (b.script !== undefined) {
          const incoming = Array.isArray(b.script) ? b.script : [];
          const ordered = incoming.slice().sort((a, z) => Number(a.shot) - Number(z.shot));
          const ids = ordered.map(s => Number(s.shot));
          if (ordered.length !== 12 || ids.join(',') !== '1,2,3,4,5,6,7,8,9,10,11,12') {
            return send(res, 200, { ok: false, error: `ບົດທີ່ຈະສ້າງວິດີໂອບໍ່ຄົບ Shot 1-12 (ພົບ ${ordered.length})` });
          }
          const missing = skill.requiredDialogueErrors(ordered);
          if (missing.length) return send(res, 200, { ok: false, error: `ບົດພາກຕ້ອງຄົບ 12/12 — ${missing.join('; ')}` });
          job.script = ordered.map(s => ({
            ...s,
            text: skill.stripAICitations(String(s.text || '').trim()),
            scene: skill.stripAICitations(String(s.scene || '').trim()),
          }));
          job.scriptErrs = skill.validateScript(job.script, job.product);
          saveJob();
          logLn('ບັນທຶກບົດເວົ້າຫຼ້າສຸດ 12/12 ກ່ອນສ້າງ prompt ວິດີໂອ');
        }
        const sameScript = JSON.stringify(job.script || []) === oldScript;
        const completedPrefix = sameScript ? [0, 1, 2].filter(i => (job.clipTitles || [])[i]).length : 0;
        const resumeFrom = completedPrefix > 0 && completedPrefix < 3 ? completedPrefix + 1 : 1;
        stepVideos(resumeFrom); return send(res, 200, { ok: true, resumeFrom });
      }
      if (p === '/api/check-video-clips') {
        if (isBusy()) return send(res, 200, { ok: false, error: 'ມີວຽກກຳລັງແລ່ນຢູ່' });
        if (job.sheetsDone !== 3 || !/^https:\/\/flow\.google\.com\/project\//.test(job.projectUrl || ''))
          return send(res, 200, { ok: false, error: 'ບໍ່ມີ 3 ແຜ່ນ ຫຼື URL project ທີ່ຖືກຕ້ອງ' });
        let found = null;
        runWorker(['list-clips', job.projectUrl], line => {
          const m = line.match(/@@CLIP_LIST (.+)$/);
          if (m) { try { found = JSON.parse(m[1]); } catch {} }
        }, code => {
          const waiting = job.policyWaitClip > 0 && job.policyWaitProject === job.projectUrl;
          const keepWaiting = () => {
            setPhase('waiting-video-repair', `ກຳລັງລໍຄລິບ ${job.policyWaitClip} ໃນ Flow — ແກ້ແລ້ວບັອດຈະສືບຕໍ່ເອງ`);
          };
          const repairFound = () => {
            job.policyWaitClip = 0; job.policyWaitProject = ''; job.error = '';
            saveJob();
          };
          if (code !== 0 || !found || found.error) {
            if (waiting) { keepWaiting(); return; }
            job.error = found?.error || 'ອ່ານຄລິບໃນ Flow ບໍ່ໄດ້'; setPhase('error'); return;
          }
          const clips = found.clips || [];
          const historicalFp = label => {
            for (const line of (job.log || []).slice().reverse()) {
              const marker = line.indexOf('@@CLIP_LIST ');
              if (marker < 0) continue;
              try {
                const old = JSON.parse(line.slice(marker + 12));
                const match = (old.clips || []).find(c => c.label === label && c.fp?.length === 64);
                if (match) return match.fp;
              } catch { /* older log entry */ }
            }
            return '';
          };
          if (clips.length === 3 && [1, 2, 3].every(n => job.videoSubmitted?.[n] === job.projectUrl)) {
            const prior = (job.clipTitles || []).slice(0, 2);
            const unique = prior.length === 2 && prior.every(title =>
              title && clips.filter(c => c.label === title).length === 1);
            const remaining = unique ? clips.filter(c => !prior.includes(c.label)) : [];
            if (remaining.length === 1 && remaining[0].label) {
              repairFound();
              job.clipTitles = [...prior, remaining[0].label];
              job.clipFps = job.clipTitles.map((title, i) =>
                clips.find(c => c.label === title)?.fp || (job.clipFps || [])[i] || historicalFp(title));
              job.clipsDone = 3;
              job.error = '';
              setPhase('video', 'ກຳລັງຕໍ່ 3 ຄລິບ ແລະດາວໂຫຼດ');
              logLn('ກວດ Flow ຢືນຢັນ 3 ຄລິບຕາມສາກ 1→2→3 — ຕໍ່ແລະດາວໂຫຼດ');
              startCombine(); return;
            }
          }
          // Flow lists newest first. Match the previously recorded scene by its
          // thumbnail, never by gallery position, before assigning a new tile.
          const fpDistance = (a, b) => a && b && a.length === 64 && b.length === 64
            ? [...a].reduce((n, bit, i) => n + (bit !== b[i]), 0) : Infinity;
          const known = (job.clipFps || [])[0];
          const scene1Matches = clips.filter(c => fpDistance(known, c.fp) <= 11
            || (!c.fp && c.label && c.label === (job.clipTitles || [])[0]
              && clips.filter(other => other.label === c.label).length === 1));
          if (clips.length === 2 && job.videoSubmitted?.[1] === job.projectUrl
              && job.videoSubmitted?.[2] === job.projectUrl && scene1Matches.length === 1) {
            const first = scene1Matches[0];
            const second = clips.find(c => c !== first);
            // Flow sometimes returns an empty thumbnail while its video tile
            // and distinct title remain visible. The submission journal plus
            // exact scene-1 fingerprint still identify the sole remaining tile.
            if ((!second.fp || !first.fp || fpDistance(first.fp, second.fp) > 11)
                && second.label && second.label !== first.label) {
              if (waiting && job.policyWaitClip === 2) repairFound();
              job.clipTitles = [first.label, second.label];
              job.clipFps = [first.fp || (job.clipFps || [])[0] || historicalFp(first.label),
                second.fp || (job.clipFps || [])[1] || historicalFp(second.label)];
              job.clipsDone = 2;
              saveJob();
              logLn(`ກວດ Flow ເຫັນຄລິບ 1 ແລະ 2 ຄົບ; ຄລິບ 3 ຍັງບໍ່ມີ`);
              // ຜູ້ໃຊ້ກຳລັງແກ້ຄລິບ 3 ເອງໃນ Flow — ຢ່າສົ່ງທັບ
              if (waiting && job.policyWaitClip === 3) { keepWaiting(); return; }
              // Flow ສະແດງ 2 ຄລິບແທ້ (ground truth). ຖ້າ journal ວ່າຄລິບ 3 "ສົ່ງແລ້ວ"
              // ແຕ່ Flow ບໍ່ມີ — ແປວ່າບໍ່ໄດ້ສ້າງຈິງ (worker ຄ້າງ/timeout ຫຼື Flow ຕົກ).
              // ລຶບບັນທຶກນັ້ນອອກແລ້ວສ້າງຄລິບ 3 ຄືນ — ບໍ່ແມ່ນການສົ່ງຊ້ຳ ເພາະໃນ Flow
              // ບໍ່ມີຄລິບ 3 ຢູ່ ຈຶ່ງເປັນໄປບໍ່ໄດ້ທີ່ຈະໄດ້ຄລິບຊ້ຳ.
              if (job.videoSubmitted) delete job.videoSubmitted[3];
              saveJob();
              logLn('ຕໍ່ສ້າງຄລິບ 3 (ລຶບບັນທຶກສົ່ງຄ້າງ ເພາະ Flow ບໍ່ມີຄລິບ 3 ຈິງ)');
              stepVideos(3); return;
            }
          }
          if (clips.length === 1) {
            if (waiting && job.policyWaitClip !== 1) { keepWaiting(); return; }
            const clip = clips[0];
            if (waiting) repairFound();
            job.clipTitles = [clip.label || found.titles[0]];
            job.clipFps = [clip.fp || ''];
            job.videoSubmitted ||= {}; job.videoSubmitted[1] = job.projectUrl;
            saveJob(); stepVideos(2); return;
          }
          if (waiting) { keepWaiting(); return; }
          if (clips.length === 0 && !Object.keys(job.videoSubmitted || {}).length) { stepVideos(1); return; }
          job.error = `ພົບ ${clips.length} ຄລິບ — ລຳດັບສາກຍັງຢືນຢັນບໍ່ໄດ້; ບັອດຈະບໍ່ສົ່ງຊ້ຳ`;
          setPhase('error');
        }, 'check-video-clips');
        return send(res, 200, { ok: true, checking: true });
      }
      if (p === '/api/resume-video-policy') {
        return send(res, 200, { ok: false, error: 'ປິດການແກ້ prompt ຜ່ານ AI ອັດຕະໂນມັດແລ້ວ' });
        if (isBusy()) return send(res, 200, { ok: false, error: 'ມີວຽກກຳລັງແລ່ນຢູ່' });
        if (job.sheetsDone !== 3 || !(job.clipTitles || [])[0] || !(job.clipTitles || [])[1] || (job.clipTitles || [])[2]) {
          return send(res, 200, { ok: false, error: 'ຄລິບ 1-2 ຕ້ອງສຳເລັດ ແລະຄລິບ 3 ຍັງບໍ່ສຳເລັດ' });
        }
        repairVideoPolicy(3, String(b.reason || 'Flow policy rejection').slice(0, 300), 0, ok => {
          if (ok) stepVideos(3, 1);
          else { job.error = 'AI ແກ້ prompt ຄລິບ 3 ບໍ່ສຳເລັດ'; setPhase('error'); }
        });
        return send(res, 200, { ok: true, repairingClip: 3 });
      }
      if (p === '/api/redo-script') { stepScript(); return send(res, 200, { ok: true }); }
      if (p === '/api/open-ai') {
        const aiUrls = { claude: 'https://claude.ai', gemini: 'https://gemini.google.com', chatgpt: 'https://chatgpt.com' };
        const url = aiUrls[settings.ai] || 'https://claude.ai';
        runWorker(['open', url]); return send(res, 200, { ok: true });
      }
      if (p === '/api/open-flow') { runWorker(['open', 'https://flow.google.com/']); return send(res, 200, { ok: true }); }
      if (p === '/api/login') { runWorker(['login']); return send(res, 200, { ok: true }); }
      if (p === '/api/stop') {
        const wasBusy = isBusy();
        job.auto = false; job.policyWaitClip = 0; job.policyWaitProject = ''; saveJob(); // ກົດຢຸດ = ຢຸດແທ້
        killWorker();
        if (wasBusy) {
          job.error = 'ຢຸດວຽກຕາມຄຳສັ່ງຜູ້ໃຊ້';
          setPhase('error', 'ຢຸດວຽກແລ້ວ — ສາມາດກົດເລີ່ມໃໝ່ໄດ້');
        }
        return send(res, 200, { ok: true, stopped: wasBusy });
      }
      if (p === '/api/reset') {
        // ລ້າງບົດ/ແຜ່ນ/ຄລິບ ແຕ່ເກັບຂໍ້ມູນສິນຄ້າໄວ້ (ຊື່ ຄຳບັນຍາຍ ລັກສະນະກ່ອງ ຮູບອ້າງອີງ)
        // ເພາະສິນຄ້າເປັນອັນເກົ່າທຸກຮອບ — ບໍ່ດັ່ງນັ້ນຕ້ອງພິມໃໝ່ ແລະ ອັບຮູບໃໝ່ທຸກເທື່ອ
        killWorker();
        const keepProduct = job.product;
        job = freshJob();
        job.product = { ...job.product, ...keepProduct };
        saveJob();
        return send(res, 200, { ok: true, keptProduct: true });
      }
      return send(res, 404, { error: 'not found' });
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

const openUrl = u => openExternal(u);
server.on('error', async e => {
  if (e.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${PORT}/`;
    // Only reuse a healthy server from this installation. An old copy may
    // still own the port after its folder has been moved or deleted.
    try {
      const health = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1500) });
      const info = await health.json();
      const page = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (info.ok && samePath(info.appPath, APP) && page.ok && (await page.text()).includes('<html')) {
        console.log(`JOD FLOW ເປີດຢູ່ແລ້ວທີ່ ${url}`);
        openUrl(url);
        process.exit(0);
      }
    } catch { /* Occupied by another app or an unhealthy old copy. */ }
    if (PORT < INITIAL_PORT + 20) {
      PORT += 1;
      server.listen(PORT, '127.0.0.1');
      return;
    }
  }
  console.error('ຜິດພາດ server:', e.message); process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`JOD FLOW ${VERSION} ພ້ອມແລ້ວທີ່ http://127.0.0.1:${PORT}  (ປິດໜ້າຕ່າງນີ້ = ປິດໂປຣແກຣມ)`);
  openUrl(`http://127.0.0.1:${PORT}/`);
  // ອັບເດດ: ຢືນຢັນວ່າລຸ້ນທີ່ຫາກໍອັບ "ແລ່ນໄດ້" (boot.js ຍ້ອນກັບຖ້າພັງ), ແລ້ວກວດອັບເດດ
  if (upd.state.enabled) {
    upd.markHealthy();
    const everyMs = Number(process.env.JODFLOW_UPDATE_EVERY || 3 * 3600 * 1000);
    setTimeout(async () => { await upd.check(); tryApply(); }, 8000).unref();
    setInterval(async () => { await upd.check(); tryApply(); }, everyMs).unref();
  }
});

// A policy rejection leaves the submitted job in Flow. Watch for a manual
// replacement in that same project, then the normal check route resumes only
// the next missing clip. Polling never submits the rejected clip again.
setInterval(() => {
  if (!job.policyWaitClip || job.policyWaitProject !== job.projectUrl || isBusy()) return;
  fetch(`http://127.0.0.1:${PORT}/api/check-video-clips`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).catch(() => {});
}, 15000);
