// JOD FLOW — ເອີ້ນ Gemini API ກົງ (ແທນການຂັບ web UI) ສຳລັບວຽກ AI: ວິເຄາະຮູບ + ຂຽນ brief/script.
// ສະຖຽນກວ່າ web ຫຼາຍ: ບໍ່ມີ DOM/selector, ບໍ່ຕ້ອງ login, ຜົນລັບແນ່ນອນ.
// Flow (ຮູບ/ວິດີໂອ) ຍັງເປັນ web ຢູ່ ເພາະ Flow ບໍ່ມີ API.
const fs = require('fs');
const path = require('path');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' };
function mimeFromPath(p) { return MIME[String(p || '').split('.').pop().toLowerCase()] || 'image/jpeg'; }
function imageToPart(filePath) {
  const buf = fs.readFileSync(filePath);
  return { inline_data: { mime_type: mimeFromPath(filePath), data: buf.toString('base64') } };
}

// ດຶງຂໍ້ຄວາມໃນ ```fence ... ``` (ຖ້າມີ) ບໍ່ດັ່ງນັ້ນສົ່ງຂໍ້ຄວາມເຕັມ
function extractFence(text, fence) {
  const s = String(text || '');
  const re = new RegExp('```\\s*' + (fence || '[a-z]*') + '?\\s*\\n([\\s\\S]*?)```', 'i');
  const m = s.match(re);
  return (m ? m[1] : s).trim();
}

// ເອີ້ນ generateContent. คืนข้อความคำตอบ. throw ຖ້າຜິດ/ຖືກ block.
async function callGemini({ apiKey, model, prompt, images = [], temperature = 0.7, maxOutputTokens = 8192, json = false, timeoutMs = 180000, thinkingBudget = 0, retries = 2 }) {
  if (!apiKey) throw new Error('ບໍ່ມີ API key');
  const mdl = model || 'gemini-3.1-flash-lite';
  const parts = [{ text: String(prompt || '') }];
  for (const img of images) {
    if (typeof img === 'string') { if (fs.existsSync(img)) parts.push(imageToPart(img)); }
    else if (img && img.mime && img.b64) parts.push({ inline_data: { mime_type: img.mime, data: img.b64 } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature, maxOutputTokens,
      // ປິດ "thinking" ໃຫ້ໄວ (model 3.x ເປີດ default ຊຶ່ງຊ້າ); -1 = auto, 0 = ປິດ
      ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
    // ຍືດ safety ບາງໝວດເທົ່າທີ່ policy ອະນຸຍາດ (ຍັງ block ເນື້ອຫາຮ້າຍແຮງແທ້)
    safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
      .map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let r, data;
  for (let attempt = 0; attempt <= retries; attempt++) {
    r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    try { data = await r.json(); } catch { data = {}; }
    // 503/429 = ແໜ້ນຊົ່ວຄາວ — ລໍແລ້ວລອງໃໝ່
    if ((r.status === 503 || r.status === 429) && attempt < retries) { await new Promise(res => setTimeout(res, 2500 * (attempt + 1))); continue; }
    break;
  }
  if (!r.ok) {
    const msg = (data && data.error && data.error.message) || ('HTTP ' + r.status);
    throw new Error('API ' + r.status + ': ' + String(msg).slice(0, 200));
  }
  const cand = data.candidates && data.candidates[0];
  const blockReason = data.promptFeedback && data.promptFeedback.blockReason;
  if (blockReason) throw new Error('API block (prompt): ' + blockReason);
  if (!cand) throw new Error('API ບໍ່ມີຄຳຕອບ');
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') throw new Error('API block: ' + cand.finishReason);
  const text = (cand.content && cand.content.parts || []).map(p => p.text || '').join('');
  if (!text.trim()) throw new Error('API ຄຳຕອບວ່າງ (' + (cand.finishReason || '') + ')');
  return text;
}

// ກວດ key ໃຊ້ໄດ້ບໍ (ListModels) — ສຳລັບປຸ່ມ "ທົດສອບ key" ໃນ UI
async function verifyKey(apiKey, timeoutMs = 15000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + r.status));
  const models = (data.models || []).map(m => String(m.name || '').replace('models/', '')).filter(n => /generateContent/.test((data.models.find(x => x.name.endsWith(n)) || {}).supportedGenerationMethods || []) || true);
  return models;
}

module.exports = { callGemini, verifyKey, extractFence, mimeFromPath, imageToPart };
