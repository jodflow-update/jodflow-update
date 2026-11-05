// JOD FLOW — SKILL ແລະ ຕົວຊ່ວຍພາສາລາວ
// ອ້າງອີງ: storyboard-close-sale (12 shot, 3 ແຜ່ນ, 70/30, 3-4 ພະຍາງ/ວິ, locks ຄົບ)

// ນັບພະຍາງລາວຢ່າງງ່າຍ: ຕົວໜັງສືພື້ນຖານ (U+0E80-U+0EFF) ແຍກຕາມສະຫຼະ
// ຫຼັກການ: 1 "ຄຳ" ລາວ = 1 ພະຍາງ (ປະມານ). ບໍ່ແມ່ນຕົວເລກຕາຍຕົວ ແຕ່ພໍເຮັດ budget ໄດ້.
function countLaoSyllables(s) {
  if (!s) return 0;
  // ລາວ combining vowels: EB1-EB9, EBB, EBC, EBD, ECD
  const isCombining = c => (c >= 0x0EB1 && c <= 0x0EB9) || c === 0x0EBB || c === 0x0EBC || c === 0x0EBD || c === 0x0ECD;
  // ລາວ leading vowels: ເແໂໃໄ (EC0-EC4)
  const isLeading = c => c >= 0x0EC0 && c <= 0x0EC4;

  let count = 0;
  const cs = String(s);
  for (let i = 0; i < cs.length; i++) {
    const c = cs.charCodeAt(i);
    // Leading vowel: ນັບ ຖ້າ ບໍ່ມີ combining vowel ຕາມ (ຫຼີກລ່ຽງນັບ 2 ຄັ້ງ ເຊັ່ນ ເ...ັ)
    if (isLeading(c)) {
      let hasCombining = false;
      for (let j = i + 1; j < Math.min(i + 5, cs.length); j++) {
        if (isCombining(cs.charCodeAt(j))) { hasCombining = true; break; }
      }
      if (!hasCombining) count++;
      continue;
    }
    // Combining vowel: ນັບ 1 ສະເໝີ
    if (isCombining(c)) { count++; continue; }
    // ອ (EAD) ເປັນ vowel carrier: ນັບ ຖ້າ ບໍ່ມີ combining vowel ຕາມທັນທີ
    if (c === 0x0EAD) {
      if (!isCombining(cs.charCodeAt(i + 1))) count++;
      continue;
    }
  }
  return count || 1;
}

// ຂີດຈຳກັດພະຍາງ: 2.5 ວິນາທີເປົ້າໝາຍ 8-12, ຍອມຮັບ 6-14.
function syllableBudget(seconds) {
  // Scale the accepted 6-14 range for non-standard shot durations.
  const duration = Math.max(0, Number(seconds) || 0);
  return {
    min: Math.max(1, Math.round(duration * 2.4)),
    max: Math.max(1, Math.round(duration * 5.6)),
  };
}

function fits(line, seconds) {
  const n = countLaoSyllables(line);
  const b = syllableBudget(seconds);
  return { ok: n >= b.min && n <= b.max, n, min: b.min, max: b.max };
}

// ແບ່ງສ່ວນຜູ້ເວົ້າ 70/30 (ຜູ້ນຳສະເໜີ/ລູກຄ້າ) — ໃຊ້ຕອນບໍ່ມີສະຄຣິບສຳເລັດຮູບ
// ສຳລັບ 12 shot: ຜູ້ນຳສະເໜີ ~8-9 shot, ລູກຄ້າ ~3-4 shot
const DEFAULT_SPEAKERS = [
  { shot: 1,  role: 'presenter', beat: 'hook' },
  { shot: 2,  role: 'customer',  beat: 'problem' },
  { shot: 3,  role: 'presenter', beat: 'problem-context' },
  { shot: 4,  role: 'presenter', beat: 'benefit-1' },
  { shot: 5,  role: 'customer',  beat: 'personal-experience' },
  { shot: 6,  role: 'presenter', beat: 'benefit-2' },
  { shot: 7,  role: 'presenter', beat: 'proof' },
  { shot: 8,  role: 'customer',  beat: 'satisfaction' },
  { shot: 9,  role: 'presenter', beat: 'use-context' },
  { shot: 10, role: 'presenter', beat: 'cta-soft' },
  { shot: 11, role: 'presenter', beat: 'cta-strong' },
  { shot: 12, role: 'presenter', beat: 'product-only hero with off-screen brand voice CTA' },
];

const AD_SEQUENCE_LOCK = 'AD SEQUENCE LOCK: Build the commercial in this exact order: Hook / problem or desire → Product introduction → Supported highlights that are grounded in the supplied brief → Experience or use context → CTA → Shot 12 Hero. Assign every shot to one stage, preserve this causal progression, and do not jump directly from the problem to the hero.';

const LOCATION_PROVENANCE_LOCK = `LOCATION PROVENANCE LOCK — HIGHEST PRIORITY:
- A named city, province, country, district, street, building, monument, temple, landmark or recognizable civic architecture may be used ONLY when the user explicitly supplied that exact place in the source brief/story.
- Never infer a location from the language, audience, brand, vehicle, crowd, product or nationality. Never choose a famous landmark merely to make the scene look local.
- If the user did not explicitly name a place, LocationSource MUST be NEUTRAL_UNNAMED and Location L01 MUST be an unnamed neutral commercial/open area that fits the stated action. It must contain no identifiable skyline, monument, temple, landmark, civic building, city/province/country name or location sign. For an outdoor TC-vehicle crowd story, use: "unnamed neutral open commercial lot beside the specified TC vehicle; generic surrounding buildings; no identifiable geography or landmark".
- Once selected from these rules, keep the same L01 for Shots 1-11. Shot 12 may use a neutral product-only studio as a technical hero set, never as a newly invented story location.`;

// Citation chips copied from an AI response are metadata, not dialogue.
// AI ມັກພິມຕົວໜັງສືໄທປົນເຂົ້າໃນຂໍ້ຄວາມລາວ ເພາະສອງພາສາຕົວຄ້າຍກັນຫຼາຍ
// (ເຊັ່ນ ไทย ด ี ↔ ລາວ ດ ີ). ໂປຣແກຣມນີ້ເປັນລາວລ້ວນ ສະນັ້ນຕົວໄທໃນບົດ
// ແມ່ນຄວາມຜິດພາດສະເໝີ. ແປງຕົວທີ່ "ຈັບຄູ່ໄດ້ແນ່ນອນ" ໃຫ້ອັດຕະໂນມັດ
// ສ່ວນຕົວທີ່ບໍ່ແນ່ນອນປ່ອຍໄວ້ໃຫ້ hasThai() ຈັບ ແລ້ວໃຫ້ AI ຂຽນໃໝ່.
const THAI_TO_LAO = {
  // ສະຫຼະ ແລະ ວັນນະຍຸດ — ຈັບຄູ່ 1:1 ແນ່ນອນ ເປັນຕົວທີ່ພາດເລື້ອຍສຸດ
  'ะ': 'ະ', 'ั': 'ັ', 'า': 'າ', 'ิ': 'ິ', 'ี': 'ີ', 'ึ': 'ຶ', 'ื': 'ື',
  'ุ': 'ຸ', 'ู': 'ູ', 'เ': 'ເ', 'แ': 'ແ', 'โ': 'ໂ', 'ใ': 'ໃ', 'ไ': 'ໄ',
  'ำ': 'ຳ', '็': 'ົ', '่': '່', '้': '້', '๊': '໊', '๋': '໋', '์': '໌',
  // ພະຍັນຊະນະທີ່ຮູບ ແລະ ສຽງກົງກັນ
  'ก': 'ກ', 'ข': 'ຂ', 'ค': 'ຄ', 'ง': 'ງ', 'จ': 'ຈ', 'ช': 'ຊ', 'ซ': 'ຊ',
  'ด': 'ດ', 'ต': 'ຕ', 'ถ': 'ຖ', 'ท': 'ທ', 'น': 'ນ', 'บ': 'ບ', 'ป': 'ປ',
  'ผ': 'ຜ', 'ฝ': 'ຝ', 'พ': 'ພ', 'ฟ': 'ຟ', 'ภ': 'ພ', 'ม': 'ມ', 'ร': 'ຣ',
  'ล': 'ລ', 'ว': 'ວ', 'ส': 'ສ', 'ห': 'ຫ', 'อ': 'ອ', 'ฮ': 'ຮ',
};
const THAI_RE = /[฀-๿]/g;

function thaiToLao(value) {
  const text = String(value ?? '');
  if (!THAI_RE.test(text)) { THAI_RE.lastIndex = 0; return text; }
  THAI_RE.lastIndex = 0;
  return [...text].map(ch => THAI_TO_LAO[ch] || ch).join('');
}

// ຕົວໄທທີ່ຍັງເຫຼືອຫຼັງແປງແລ້ວ (ແປງບໍ່ໄດ້ຢ່າງແນ່ນອນ) — ຕ້ອງໃຫ້ AI ຂຽນໃໝ່
function thaiLeftovers(value) {
  const m = String(value ?? '').match(THAI_RE);
  return m ? [...new Set(m)] : [];
}

function stripAICitations(value) {
  return String(value ?? '')
    .replace(/\s*\[\s*cite\s*:\s*[^\]]+\]/gi, '')
    .replace(/\s*\[\s*citation\s*:\s*[^\]]+\]/gi, '')
    .replace(/[ \t]+(?=\n|$)/g, '')
    .trim();
}

// ຄຳສັ່ງຫຼັກທີ່ສົ່ງໃຫ້ AI ຂຽນສະຄຣິບລາວ
function buildScriptRequest(product, note, aiName, story) {
  const name = product.name || '(ບໍ່ມີຊື່)';
  const desc = product.desc || '';
  const audience = product.audience || 'ຜູ້ໃຫຍ່ທົ່ວໄປ';
  const storyBlock = (story && story.trim())
    ? `\n*** ແນວເລື່ອງທີ່ຜູ້ໃຊ້ບັງຄັບ (STORY AUTHORITY LOCK — ຫ້າມປ່ຽນ, ຫ້າມຕັດ, ຫ້າມສະຫຼັບ, ຫ້າມແທນທີ່ດ້ວຍເລື່ອງທົ່ວໄປ) ***\n${story.trim()}\n*** ຈົບແນວເລື່ອງ ***\n\nເຈົ້າຕ້ອງແບ່ງແນວເລື່ອງນີ້ອອກເປັນ 12 shot ຕາມລຳດັບທີ່ຜູ້ໃຊ້ບອກ. ຕົວລະຄອນ, ສະຖານທີ່, ການກະທຳ, ຕອນຈົບ, ແລະ CTA ຕ້ອງຢູ່ຕາມທີ່ຂຽນໄວ້. ຖ້າເລື່ອງຫຍ້ອຍເກີນ 12 shot ໃຫ້ຍືດ, ຖ້າຍາວເກີນ 12 shot ໃຫ້ຫຍໍ້ແຕ່ຮັກສາທຸກ beat. ບໍ່ມີຂໍ້ຍົກເວັ້ນ. ສຳຄັນ: ຂໍ້ບັງຄັບນີ້ໃຊ້ກັບ **ແຖວ SCENE** ນຳ ບໍ່ແມ່ນແຕ່ບົດພາກລາວ — ແຕ່ລະແຖວ SCENE ຕ້ອງເປັນພາບຂອງຈັງຫວະນັ້ນໃນເລື່ອງຂອງຜູ້ໃຊ້ແທ້ໆ. ກ່ອນຂຽນ SCENE ແຕ່ລະແຖວ ໃຫ້ຖາມຕົວເອງວ່າ "ຈັງຫວະນີ້ຂອງເລື່ອງທີ່ລາວຂຽນ ຖ້າຖ່າຍອອກມາຈະເຫັນຫຍັງ" ແລ້ວຂຽນສິ່ງນັ້ນ ຫ້າມແທນດ້ວຍພາບໂຄສະນາທົ່ວໄປທີ່ເບິ່ງຄືດີແຕ່ບໍ່ແມ່ນເລື່ອງຂອງລາວ.\n`
    : `\n(ຜູ້ໃຊ້ບໍ່ໄດ້ບັງຄັບແນວເລື່ອງ — ເຈົ້າຄິດເລື່ອງປິດການຂາຍແບບທົ່ວໄປໄດ້)\n`;
  const dialogueBlock = (note && note.trim())
    ? `\n*** ບົດເວົ້າທີ່ຜູ້ໃຊ້ໃຫ້ມາ (DIALOGUE AUTHORITY LOCK — ຮັກສາຄຳ ແລະຄວາມໝາຍ; ຫ້າມປ່ຽນເປັນບົດບັນລະຍາຍ) ***\n${note.trim()}\n*** ຈົບບົດເວົ້າ ***\n\nແບ່ງເນື້ອຫາເປັນບົດສົນທະນາຂອງຄົນໃນສາກສຳລັບ Shot 1-11. ແຕ່ລະ shot ມີປະໂຫຍກສົມບູນ: ເປົ້າໝາຍ 8-12 ພະຍາງ, ຍອມຮັບ 6-14. Shot 12 ຍັງເປັນພາບ Hero ສິນຄ້າລ້ວນບໍ່ມີຄົນ ແຕ່ອະນຸຍາດສຽງ brand voice CTA ໃນເກນດຽວກັນ. CTA ປິດການຂາຍຢູ່ Shot 11 ຫຼື Shot 12 ໄດ້. ຮັກສາລຳດັບ ແລະຄວາມໝາຍເດີມ.\n`
    : `\n(ຜູ້ໃຊ້ບໍ່ໄດ້ໃຫ້ບົດເວົ້າ — ນຳຈຸດຂາຍ/ສັບພະຄຸນທີ່ຜູ້ໃຊ້ໃຫ້ມາສ້າງເປັນບົດສົນທະນາສຳລັບ Shot 1-11; ເປົ້າໝາຍ 8-12 ພະຍາງ, ຍອມຮັບ 6-14. Shot 12 ເປັນພາບ Hero ສິນຄ້າລ້ວນ ແຕ່ມີສຽງ brand voice CTA ໄດ້.)\n`;
  return `ຕອບເປັນໂຄດ markdown ບລັອກດຽວຕາມແບບທີ່ບອກ. ຂຽນສະຄຣິບສິນຄ້າ 12 shot, 3 ຄລິບ (ຄລິບລະ 4 shot, shot ລະ 2.5 ວິນາທີ, ຄລິບລະ 10 ວິ). Shot 1-11 ເປັນບົດສົນທະນາທີ່ຄົນເຫັນໃນສາກເວົ້າຈິງ; Shot 12 ເປັນພາບ Hero ສິນຄ້າລ້ວນບໍ່ມີຄົນ ແຕ່ມີສຽງ brand voice CTA ໄດ້. ຫ້າມ narrator/voice-over ໃນ Shot 1-11; ຍົກເວັ້ນສຽງ brand CTA ຂອງ Shot 12:

ສິນຄ້າ: ${name}
ລາຍລະອຽດ: ${desc}
ກຸ່ມເປົ້າໝາຍ: ${audience}
${product.packLook ? `\n*** ບັນຈຸພັນຕາມຮູບຈິງ (ອ່ານຈາກຮູບຈິງ — ໃຊ້ຮູບຮ່າງທີ່ລະບຸນີ້ໃນແຖວ SCENE; ຖ້າຮູບມີພຽງກະປຸກ/ຂວດ ໃຫ້ຂຽນເປັນກະປຸກ/ຂວດອັນດຽວ, ຫ້າມເພີ່ມກ່ອງ, ຊອງ ຫຼືແຜງແຄັບຊູນຖ້າບໍ່ມີໃນຮູບ) ***\n${product.packLook}\n` : ''}
${dialogueBlock}${storyBlock}
${LOCATION_PROVENANCE_LOCK}

ກົດທີ່ຕ້ອງປະຕິບັດທຸກຂໍ້:
1) ແຕ່ງເປັນພາສາລາວທັງໝົດ (ຍົກເວັ້ນ metadata ໃນເຄື່ອງໝາຍ []).
2) ${AD_SEQUENCE_LOCK} ຖ້າຜູ້ໃຊ້ບັງຄັບ Story ເອງ ໃຫ້ຮັກສາ Story Authority ແຕ່ຈັດຈັງຫວະໃຫ້ກົງລຳດັບນີ້ເທົ່າທີ່ Story ອະນຸຍາດ.
3) ທຸກ Shot 1-12 ຕ້ອງມີບົດເວົ້າລາວເປັນປະໂຫຍກສົມບູນ: ເປົ້າໝາຍ 8-12 ພະຍາງ, ຍອມຮັບ 6-14. ຫ້າມຄຳສັ້ນແບບຫົວຂໍ້, ຫ້າມບັນຍາຍພາບ/ເຫດການ, ຫ້າມ narrator. Shot 1-11 ຕ້ອງເປັນຄົນທີ່ເຫັນໃນພາບເວົ້າກັບຄົນອື່ນ ຫຼືເວົ້າກັບກ້ອງ. ນຳລາຍລະອຽດ/ສັບພະຄຸນທີ່ຜູ້ໃຊ້ໃຫ້ມາກະຈາຍເປັນຄຳເວົ້າໃນ Shots 3-10 ໂດຍບໍ່ປະດິດຄຳອ້າງໃໝ່. Shot 12 ເປັນຂໍ້ຍົກເວັ້ນ: ໃຊ້ສຽງ brand voice CTA ທັບພາບ Hero ໄດ້ ໂດຍຮູບຍັງຫ້າມມີຄົນ/ມື/ຮ່າງກາຍ.
4) ສັດສ່ວນ presenter/customer 70/30 ເປັນພຽງຄ່າແນະນຳ, ບໍ່ແມ່ນເກນບລັອກ. ໃຫ້ຮັກສາ role ແລະບົດພາກຕາມ STORY AUTHORITY LOCK; ຖ້າສັດສ່ວນຕ່າງຈາກ 70/30 ກໍຫ້າມປ່ຽນ, ຕັດ, ຫຼື reject ບົດ.
5) ຫ້າມອ້າງວ່າ ສິນຄ້ານີ້ຮັກສາ/ປິ່ນປົວ/ຮັບປະກັນຜົນ 100%. ໃຊ້ແບບ "ປະສົບການສ່ວນຕົວ" ແລະ "ຮູ້ສຶກດີຂຶ້ນ" ແທນ.
6) Shot 1-11 ຕ້ອງມີຄົນ/ການກະທຳ ແລະຫ້າມ narrator/off-screen voice-over. Shot 11 ຫຼື Shot 12 ຮັບ CTA ປິດການຂາຍ. Shot 12 ແມ່ນພາບ hero ສິນຄ້າຢ່າງດຽວ ບໍ່ມີຄົນ ຫຼືມື, ແຕ່ມີສຽງ brand voice CTA ໄດ້.
7) ບໍ່ຄວນມີຄຳສັບ "ສະບາຍດີ", "ຂອບໃຈ" ຫຼື ຄຳ filler.
7.1) *** CONTINUITY / ID MANIFEST ***: ຕ້ອງຂຽນບລັອກ CONTINUITY ຢູ່ຕອນຕົ້ນກ່ອນ Shot 1 ໃຫ້ຄົບທຸກແຖວ. ຕົວລະຄອນ recurring ທຸກຄົນຕ້ອງມີ ID ຕາຍຕົວ C01, C02... ແລະທຸກສະຖານທີ່ຕ້ອງມີ ID L01, L02. ທຸກແຖວ SCENE ຕ້ອງອ້າງ ID ເຫຼົ່ານີ້ແທນການຂຽນກວ້າງໆວ່າ man, woman, shop ຫຼື street. ນີ້ຄືບັດປະຈຳຕົວຂອງໜັງທັງເລື່ອງ — ຄົນຄົນດຽວ, ເສື້ອຜ້າຊຸດດຽວ, ສະຖານທີ່ດຽວ, ແສງແບບດຽວ ຕະຫຼອດ 12 shot. ຫ້າມປ່ຽນຕົວລະຄອນ ຫຼື ຍ້າຍສະຖານທີ່ກາງເລື່ອງ.
7.2) *** ແຖວ SCENE ຄືສິ່ງດຽວທີ່ Flow ເອົາໄປແຕ້ມ *** ຕ້ອງຂຽນເປັນພາສາອັງກິດ ແລະ ລະບຸໃຫ້ຄົບທັງ 7 ຢ່າງທຸກ shot:
   (1) ການກະທຳ — ຈັງຫວະນີ້ຂອງແນວເລື່ອງທີ່ຜູ້ໃຊ້ໃຫ້ມາ ກຳລັງເກີດຫຍັງຂຶ້ນແທ້ ບໍ່ແມ່ນພາບທົ່ວໄປ
   (2) ຕົວລະຄອນ — ຊື່ ອາຍຸ ເສື້ອຜ້າ ສີເສື້ອ ແລະ ສີໜ້າ/ອາລົມ ຂອງຄົນໃນເຟຣມ ຕາມບັດ CONTINUITY; Shot 1-11 ທີ່ມີຄຳເວົ້າ ຕ້ອງເຫັນໜ້າ/ປາກຜູ້ເວົ້າໃນຈັງຫວະເວົ້າ
   (3) ສະຖານທີ່ — ບ່ອນດຽວກັບບັດ CONTINUITY ພ້ອມສິ່ງທີ່ເຫັນອ້ອມຂ້າງ ແລະ ຈຳນວນຄົນເປັນຕົວເລກ
   (4) ມຸມກ້ອງ — ຂະໜາດພາບ (wide/medium/close-up/macro) + ລະດັບສາຍຕາ + ການເຄື່ອນກ້ອງ
   (5) ແສງ — ທິດທາງ ຄວາມແຂງ-ນຸ້ມ ແລະ ເວລາຂອງມື້ ຕາມບັດ CONTINUITY
   (6) ໂທນສີ — ສີລວມຂອງເຟຣມ ຕາມ Palette ໃນບັດ CONTINUITY
   (7) ສິນຄ້າ — ຖ້າບັນຈຸພັນປາກົດ ບອກຮູບຮ່າງຕາມຮູບຈິງ, ຖືແນວໃດ, ຫັນດ້ານໃດ ແລະໃຫຍ່ປານໃດໃນເຟຣມ. ຫ້າມໃຊ້ box, carton, blister pack, pill strip ຫຼື sachet ຖ້າຮູບຈິງມີພຽງກະປຸກ/ຂວດ; ຂໍ້ຄວາມເທິງສະຫຼາກບໍ່ແມ່ນຫຼັກຖານວ່າມີບັນຈຸພັນ ຫຼືສິ່ງບັນຈຸຂ້າງໃນອີກຮູບແບບໜຶ່ງ
   ແຖວ SCENE ທີ່ສັ້ນກວ່າ 25 ຄຳ ຫຼື ຂາດຂໍ້ໃດຂໍ້ໜຶ່ງໃນ 7 ຂໍ້ ຖືວ່າໃຊ້ບໍ່ໄດ້. ຫ້າມຂຽນລອຍໆເຊັ່ນ "man holding product" ຫຼື "nice lighting".
7.25) *** ພາບທີ່ Flow ຈະບລັອກ — ຫ້າມຂຽນລົງແຖວ SCENE ເດັດຂາດ ***
   ບົດເວົ້າລາວບໍ່ເຄີຍຖືກສົ່ງໄປໃຫ້ Flow ສ້າງພາບ ມີແຕ່ແຖວ SCENE ເທົ່ານັ້ນທີ່ໄປ.
   ສະນັ້ນ ຄຳຂາຍ/ສັບປະຄຸນຂຽນແຮງໄດ້ເຕັມທີ່ໃນບົດເວົ້າ ແຕ່ **ແຖວ SCENE ຕ້ອງເປັນພາບທຳມະດາ**
   ບໍ່ດັ່ງນັ້ນ Flow ຈະປະຕິເສດທັງແຜ່ນ ແລ້ວວຽກຈະຊ້າລົງ.
   ຫ້າມຂຽນໃນ SCENE:
   - ອາການເຈັບປວດທີ່ເຫັນຊັດ: crawling, writhing, screaming/crying in pain, collapsing, clutching in agony
   - ຮ່າງກາຍບາດເຈັບ: swollen, inflamed, bleeding, wound, bruise, rash, bandage, needle, syringe, IV drip
   - ບ່ອນ/ຄົນທາງການແພດ: hospital, clinic, ward, doctor, nurse, lab coat, stethoscope, X-ray, medical chart
   - ການປິ່ນປົວ: taking pills, swallowing medicine, injection, treatment, before/after recovery comparison
   ໃຫ້ຂຽນແທນດ້ວຍພາບທຳມະດາທີ່ຍັງສື່ອາລົມດຽວກັນ:
   - ນັ່ງພັກ, ຢຽດຂາຊ້າໆ, ຖູບ່າ/ຖູເຂົ່າເບົາໆ, ລຸກຊ້າໆ, ຍ່າງຊ້າ, ສີໜ້າອິດເມື່ອຍ ຫຼື ບໍ່ສະບາຍເລັກນ້ອຍ
   - ສະຖານທີ່ທຳມະດາ: ເຮືອນ, ຮ້ານ, ຕະຫຼາດ, ສວນ, ຖະໜົນ — ບໍ່ແມ່ນສະຖານທີ່ທາງການແພດ
   ຕົວຢ່າງ: ແທນ "man crawling on floor crying from severe nerve pain"
   ໃຫ້ຂຽນ "man sitting on a wooden chair at home, slowly stretching his leg, tired expression"
   ຈັງຫວະເລື່ອງ (Hook ບັນຫາ) ຍັງຄົງເດີມ ແຕ່ພາບຜ່ານ Flow ໄດ້.

7.3) *** ຍ້າຍລາຍລະອຽດຈາກແນວເລື່ອງເຂົ້າແຖວ SCENE ໃຫ້ຄົບທຸກຕົວ ***
   ຖ້າຜູ້ໃຊ້ຂຽນລາຍລະອຽດທາງເທັກນິກໄວ້ໃນແນວເລື່ອງແລ້ວ ເຈົ້າຕ້ອງເອົາເຂົ້າແຖວ SCENE ທຸກຕົວ ຫ້າມຖິ້ມ ຫ້າມຫຍໍ້:
   - ເລນ ແລະ ຮູຮັບແສງ: 24mm, 35mm, 50mm f/2.8, 85mm, 100mm macro → ຂຽນເປັນ "24mm lens", "50mm lens at f/2.8"
   - ຄວາມເລິກຂອງພາບ: ສາກຫຼັງລະລາຍ/Bokeh → "shallow depth of field, background bokeh"
   - ຈຳນວນຄົນເປັນຕົວເລກ: 35-40 ຄົນ, 20-25 ຄົນ → "35-40 people", "20-25 people" ຫ້າມຂຽນແຕ່ "a crowd"
   - ເພດ ແລະ ອາຍຸ, ສີເສື້ອຜ້າທຸກຊິ້ນ, ການເຄື່ອນກ້ອງ, ທິດແສງ ແລະ ເວລາຂອງມື້
   ກົດ: **ທຸກຕົວເລກ ແລະ ທຸກຄຳສັບເທັກນິກທີ່ຜູ້ໃຊ້ຂຽນ ຕ້ອງປາກົດເປັນພາສາອັງກິດໃນແຖວ SCENE**.
   ຜິດ: ຜູ້ໃຊ້ຂຽນ "ເລນ 85mm ສາກຫຼັງລະລາຍ" ແລ້ວເຈົ້າຂຽນແຕ່ "Close-up shot" — ນີ້ຖືວ່າຖິ້ມຂໍ້ມູນຂອງລາວ.
   ຖືກ: "Close-up at shoulder-to-head height, 85mm lens, shallow depth of field with soft background bokeh".
   ແຖວ SCENE ແມ່ນບ່ອນດຽວທີ່ຂໍ້ມູນເຫຼົ່ານີ້ຈະໄປເຖິງ Flow — ຖິ້ມໄປແລ້ວຄືເສຍຖິ້ມເລີຍ.

8) *** ສຳຄັນທີ່ສຸດ ***: ວົງເລັບ [...] ໃນຕົວຢ່າງລຸ່ມນີ້ແມ່ນບອກວ່າ "ຮູບແບບ" ເທົ່ານັ້ນ — ຫ້າມ copy ຂໍ້ຄວາມໃນວົງເລັບໄປໃຊ້ຕາມຕົວເດັດຂາດ. ຕ້ອງຂຽນ Shot 1 ຫາ Shot 12 ແຍກ ຄົບທັງ 12 shot ຕົວຈິງ ຫ້າມຂຽນ "..." ຫຼື "(ຕໍ່ຈົນຮອດ)" ແທນ shot ທີ່ຍັງເຫຼືອ.

ຕົວຢ່າງ 1 shot ທີ່ຂຽນຖືກຕ້ອງ (ສິນຄ້າສົມມຸດ "ຢານ້ຳ XYZ"):
Shot 1 | presenter | 2.5s
ເຊົ້ານີ້ເມື່ອຍຫຼາຍ ລອງຢານ້ຳໃໝ່ເບິ່ງ
SCENE: Medium close-up at eye level, slow push-in. Nang Mali, woman 32, in a pale yellow blouse, sits at the wooden table of her own kitchen with the kettle and two mugs behind her, rubbing her temple with a tired frown, then lifts the XYZ bottle to chest height with the front label turned square to camera, the bottle filling about a quarter of the frame. Soft morning light from the window at camera-left, gentle shadows, warm cream and pale-wood tones throughout.

ຕອນນີ້ຂຽນແບບດຽວກັນນີ້ໃຫ້ຄົບ 12 shot ຈິງ (ບໍ່ແມ່ນຕົວຢ່າງຂ້າງເທິງ — ຕ້ອງເປັນເນື້ອຫາໃໝ່ຕາມສິນຄ້າ/ເລື່ອງຂ້າງເທິງ):

ຮູບແບບຜົນ (ຕອບບລັອກນີ້ຢ່າງດຽວ ບໍ່ຕ້ອງອະທິບາຍເພີ່ມ ຂຽນຄົບ 12 shot ຫ້າມຫຍໍ້):
\`\`\`jodflow
# JOD FLOW SCRIPT
Product: ${name}
CONTINUITY
Character C01: (ຊື່, role, gender, ອາຍຸ, face/skin tone, ຮູບຮ່າງ, ຜົມ, wardrobe ຫົວຮອດຕີນ, accessories/prop, shot numbers — ລະອຽດ ແລະ ຕາຍຕົວ)
Character C02: (ຂຽນແບບດຽວກັນສຳລັບຕົວລະຄອນ recurring ຄົນຕໍ່ໄປ; ຖ້າບໍ່ມີໃຫ້ລະເວັ້ນແຖວນີ້)
LocationSource: (USER_SPECIFIED ຖ້າຜູ້ໃຊ້ລະບຸຊື່ສະຖານທີ່ແທ້; ຖ້າບໍ່ໄດ້ລະບຸ ຕ້ອງຂຽນ NEUTRAL_UNNAMED)
Location L01: (ຖ້າ USER_SPECIFIED ໃຫ້ຄັດລອກສະຖານທີ່ຈາກເລື່ອງ; ຖ້າ NEUTRAL_UNNAMED ໃຫ້ໃຊ້ບ່ອນທົ່ວໄປບໍ່ມີຊື່ ແລະຫ້າມເມືອງ/ແຂວງ/ປະເທດ/landmark/ອະນຸສາວະລີ/ວັດ/ປ້າຍບອກສະຖານທີ່; ລະບຸ exterior/interior, layout, generic architecture, doors/windows/tables/shelves/vehicle/props, shot numbers)
Location L02: (ຂຽນແບບດຽວກັນຖ້າເລື່ອງບັງຄັບສະຖານທີ່ທີສອງ; ຫ້າມປະດິດບ່ອນໃໝ່)
TimeOfDay: (ເຊົ້າ / ສວາຍ / ແລງ — ເລືອກອັນດຽວ)
Lighting: (ທິດທາງ ແລະ ອາລົມແສງ — ອັນດຽວໃຊ້ທັງເລື່ອງ)
Props: (ລົດ, ເຄື່ອງປະກອບ ທີ່ປາກົດຊ້ຳ)
Palette: (ໂທນສີລວມ)
---
Shot 1 | presenter | 2.5s
(ຂຽນປະໂຫຍກລາວຈິງ ເປົ້າໝາຍ 8-12 ພະຍາງ, ຍອມຮັບ 6-14 ຕາມສິນຄ້າ/ເລື່ອງ)
SCENE: (ຂຽນ English scene ຈິງ)
---
Shot 2 | customer | 2.5s
(ຂຽນປະໂຫຍກລາວຈິງ ເປົ້າໝາຍ 8-12 ພະຍາງ, ຍອມຮັບ 6-14)
SCENE: (ຂຽນ English scene ຈິງ)
---
(ຂຽນ Shot 3, Shot 4, Shot 5 ... ຕໍ່ໄປຮອດ Shot 12 ແບບດຽວກັນ ແຕ່ລະ shot ຄັ່ນດ້ວຍ --- ຫ້າມຂ້າມ ຫ້າມຫຍໍ້)
Shot 12 | presenter | 2.5s

SCENE: macro hero product-only shot, no humans, slow linear push-in, dark premium background
\`\`\``;
}

// ຮັບ brief ສັ້ນໆແຖວດຽວ/ຫຼາຍແຖວ ແລ້ວຂະຫຍາຍເປັນບົດເລື່ອງ + ບົດພາກທີ່ຟອມໃຊ້ໄດ້ທັນທີ.
function buildBriefExpansionRequest(brief) {
  return `You are preparing editable fields for a Lao product-video workflow. Read the user's brief below. Return ONE code block (three backticks, no language name) containing exactly these four labelled sections, in this order:

===NAME===
<product name on one line>
===DESC===
<short product purpose/benefit>
===STORY===
<the full master production story plan, written over as many lines as it needs>
===NARRATION===
1. <Lao line>
2. <Lao line>
...
12. <Lao line>

OUTPUT FORMAT LOCK — read carefully:
- Put the whole answer inside ONE code block so the text is preserved exactly. Open with three backticks on their own line and close with three backticks on their own line. Do not write a language name after the backticks.
- Inside the block write plain text, NOT JSON. Write quotation marks, apostrophes, backslashes and line breaks normally; nothing is escaped and nothing needs escaping.
- Write each of the four marker lines exactly as shown: three equals signs, the upper-case label, three equals signs, alone on its own line. All four markers are required even when a section is short.
- The STORY section keeps its real line breaks. Never collapse it onto one line and never write the characters \\n to mean a new line.
- Do not use Markdown headings, bullets or numbered lists for the narration. Type the twelve lines yourself as plain text beginning "1. " through "12. ".
- The NARRATION section is exactly 12 numbered lines, one per line. Lines 1-11 are natural on-camera Lao dialogue spoken by visible characters. Line 12 is a short Lao brand-voice CTA over the product-only Hero image.
- Write nothing before ===NAME=== and nothing after the twelfth narration line.

USER BRIEF:
${brief.trim()}

DIRECT-RESPONSE CREATIVE ROLE:
Act as a professional direct-response copywriter and video ad director. Turn the supplied product name, supported benefits and situation brief into a compelling 12-shot sales storyboard across three sheets. Open with a strong visual and spoken hook in the first seconds, make the customer's problem or desire clear, show why the supplied product matters, and end with a direct, actionable sales CTA. Aim for persuasive clarity and efficient ad pacing; do not promise a low CPA, conversion rate or result.

CREATIVE RULES FOR THIS FOUR-SECTION FORM OUTPUT:
- Shots 1-11 use 100% direct, natural Lao dialogue spoken by a visible character in the scene, including a direct-to-camera line where appropriate. Never write an outside narrator describing the action. Shot 12 has zero people and is the required product-only macro hero; its short CTA is an off-screen brand voice because no person may appear in that shot.
- Keep each spoken line within 6-14 Lao syllables, inside the requested 5-15 range and the bot's 2.5-second validation budget. Use one brief, meaningful spoken clause per shot.
- Treat the 12 shots as a concise sales ad, not a meandering short film. Build a clear problem or desire, a product response grounded in the supplied details, and a direct CTA.
- WHEN THE USER ASKS YOU TO DEVELOP THE AD CONCEPT YOURSELF: Analyze the specific product category, the supplied purpose and benefits, the target customer, and the real problem or desire those supplied facts address. Choose the ad approach, story situation, emotional tone and spoken dialogue that fit that product best; do not reuse one generic sales story for every product. Make the relevant problem concrete in the opening dialogue and show a believable path from that problem to the product and CTA. In the STORY continuity card, briefly state the product problem, the chosen ad approach and why it fits; then turn that analysis into filmable shot actions and natural Lao dialogue rather than writing a separate analysis section.
- In the continuity card, state the core concept, target audience, stable character identities and wardrobe, exact product-reference identity and location provenance. The actual supplied product image is the only authority for its package. If no image is supplied yet, do not invent package details.
- For every shot, make its panel position on a 2x2 sheet clear (top-left, top-right, bottom-left, bottom-right), and describe the camera angle, people count, wardrobe, expression, hands/action, product state, background and lighting through the mandatory shot fields below.
- Use the existing three-clip sales progression and preserve the user's specific story beats. Introduce the exact product name in Shot 3 or 4 as required by the form validator; develop supported highlights in Shots 5-8; place the direct-to-camera CTA in Shot 10 or 11; finish with the product-only Shot 12 hero and short brand-voice CTA.
- PRODUCT REVEAL DEADLINE: The actual product must be visibly recognizable in the scene no later than Shot 3. In Shot 3 at the latest, show it naturally in a character's hand or as a clearly visible prop involved in the action; specify its scale, placement and orientation in PRODUCT. Preserve the brief's earlier reveal if it occurs in Shot 1 or 2. Use the real attached product image as the identity reference and never invent or redesign its package. This is an in-scene reveal, not an isolated beauty packshot; the standalone product-only hero remains Shot 12.
- Return the ONE four-section code block specified above. The form parser reads NAME, DESC, STORY and NARRATION from that single block; do not split the visual plan and narration into two blocks.

RULES:
1. name: extract only the product name supplied by the user; do not invent or rename it.
2. desc: extract the supplied short product purpose/benefit. Do not add a claim that is not present in the brief.
3. story: this is the MASTER PRODUCTION STORY PLAN, not a short summary. Write it in Lao with English camera terms where useful. It must be detailed enough that a video creator can make all three 10-second clips without guessing. Match the requested story, cast, location, actions, sequence and ending exactly.

${LOCATION_PROVENANCE_LOCK}

${AD_SEQUENCE_LOCK}
The story must explicitly label or clearly demonstrate these stages: Shots 1-2 Hook/problem or desire; Shots 3-4 Product introduction; Shots 5-7 supported highlights; Shots 8-9 experience/use context; Shots 10-11 CTA; Shot 12 Hero. If the user's story specifies a different beat allocation, preserve the user's order and explain the stage through the shot action rather than deleting a required beat.

The STORY section MUST use this exact, fully written structure:

MASTER IDENTITY & CONTINUITY CARD
- Target audience: include the supplied audience.
- Characters: give every recurring character a stable name, gender, apparent age, hair/face, build, complete wardrobe colours, accessories and prop. Keep the same identity in every later shot.
- Location provenance: write "LocationSource: USER_SPECIFIED" only when the USER BRIEF explicitly names a place; otherwise write "LocationSource: NEUTRAL_UNNAMED". Never promote an inferred place into a user-specified fact.
- Locations: for USER_SPECIFIED, preserve only the requested location and its supplied landmarks/signage. For NEUTRAL_UNNAMED, use an unnamed neutral setting suited to the action and explicitly state "no identifiable geography or landmark"; do not add any city, province, country, monument, temple, landmark, civic architecture or location signage.
- Recurring props and product rule: the product must be part of the causal story plan and appear visibly in the scene by Shot 3 at the latest. It may also appear naturally in other Shots 1-11 when the action requires discovery, explanation, holding, purchase or use-context; it must never be an isolated beauty/packshot insert before Shot 12. Shot 12 is the only standalone product-only hero. Whenever it appears, use the actual product image as the identity authority and describe its role, scale and placement precisely.
- Continuity path: explain the causal movement from Clip 1 to Clip 2 to Clip 3 so characters, props, direction and emotional state do not reset.

CLIP 1 — SHOTS 1–4 — 10 seconds
CLIP 2 — SHOTS 5–8 — 10 seconds
CLIP 3 — SHOTS 9–12 — 10 seconds

Under each clip, write all four shots explicitly; never summarize or write ellipses. Every Shot 1 through Shot 12 must be a separate detailed paragraph and include ALL of the following:
- time range (0.0–2.5s, 2.5–5.0s, 5.0–7.5s, or 7.5–10.0s within its clip)
- exact people in frame, exact count, identity, wardrobe and expression
- exact location and visible background/props
- one visible action with action speed and movement direction
- camera framing, camera height, lens/point of view when appropriate, and camera movement
- lighting direction/quality and palette
- product state, scale, placement/orientation in frame, or an explicit statement that it is absent
- continuity in/out: what must carry forward from the previous shot and what state the next shot begins with

FORMAT LOCK FOR EVERY SHOT: use these exact field labels so the bot can verify completeness. Do not merge, rename or omit a field:
SHOT <number>
TIME: <range within its 10-second clip>
PEOPLE: <exact count, stable character IDs, appearance, wardrobe, expression>
LOCATION: <stable location ID, layout, visible background and props>
ACTION: <one visible action, speed and direction — keep it filmable by a general-purpose video model: no crawling/writhing/screaming in pain, no wounds, blood, swelling, needles or IV, no hospital/clinic/doctor/nurse/X-ray setting, no pill-taking or injection, no before/after medical recovery. Show ordinary behaviour instead — sitting down to rest, slowly stretching a leg, rubbing a shoulder, standing up slowly, walking slowly, a mildly tired or uncomfortable expression — in everyday places such as a home, shop, market, garden or street. The spoken Lao line carries the health message; the picture stays ordinary.>
CAMERA: <framing, height, lens/POV and movement>
LIGHT: <direction, quality and palette>
PRODUCT: <state, scale, placement and orientation, or ABSENT>
CONTINUITY IN: <state inherited from the previous shot, or START for Shot 1>
CONTINUITY OUT: <state handed to the next shot, or END for Shot 12>

Use concrete information from the user brief: retain names, numeric crowd counts, landmarks, clothing colours, camera terms, movements and ending. Do not replace them with vague phrases such as “nice lighting”, “a crowd”, “a reporter”, “a shop”, “shows product”, or “people are happy”. A large crowd needs its exact count/range and where it fills the frame. A television scene must state what is visible on the television and the viewer's pose/props. Shot 12 is a product-only macro hero, with zero people, hands, or body parts.

4. narration: write exactly 12 numbered Lao lines. SCRIPT LOCK: write them in Lao letters only (Unicode Lao block). Thai and Lao letters look alike and are easy to confuse — never type Thai ด ี ท ร ล in place of Lao ດ ີ ທ ຣ ລ. A single Thai character anywhere in a line makes that line wrong. LENGTH LIMIT — the single most common failure, read it twice: every line is spoken inside a 2.5-second shot, so each line is ONE short clause of roughly 5 to 9 Lao words and must be sayable in one calm breath. Never join two sentences. Never open with a greeting plus an announcement in the same line. Drop filler such as ທ່ານຜູ້ຊົມ, ມື້ນີ້ຂ້ອຍພາທຸກຄົນມາພົບກັບ, ທີ່ສຸດ, ຍອດຮິດ. These are the right length: "ທັກມາທາງເພຈໄດ້ເລີຍ" / "ເຈົ້າເປັນຫຍັງຈຶ່ງເຈັບທ້ອງເລື້ອຍໆ" / "ຢາເບັກຊ່ວຍເລື່ອງກະເພາະໄດ້ແທ້" . This is FAR TOO LONG and must never be produced: "ສະບາຍດີທ່ານຜູ້ຊົມ! ມື້ນີ້ຂ້ອຍພາທຸກຄົນມາພົບກັບສິນຄ້າຍອດຮິດທີ່ສຸດຄື ຢາເບັກ ນີ້ເອງ!" — it is three sentences and about three times the allowed length. Before you write each line, say it aloud in your head against a 2.5-second clock; if it does not finish in time, cut words until it does. Each line must still be one complete, meaningful spoken sentence. Never output a short label, slogan fragment, scene description, event narration, action direction, or narrator voice. Shots 1-11 are only natural dialogue spoken by a visible person to another visible person or directly to camera. DIALOGUE TEST: every Shots 1-11 line must contain at least one spoken-language word such as ຂ້ອຍ, ເຈົ້າ, ທ່ານ, ພວກເຮົາ, ນີ້, ນັ້ນ, ແມ່ນ, ມີ, ບໍ່, ແນ່, ເລີຍ, ເດີ, ລອງ, ຢາກ, ຮູ້ສຶກ, ຂໍ, ເຊີນ, ແນະນຳ, ຊ່ວຍ, ເໝາະ, ດີ, ສະດວກ, or ສົນໃຈ — a line with none of these words is always rejected, no exceptions. These are REJECTED narrator-voice lines (describing the scene from outside it, no one is "saying" them) and the correct spoken rewrite next to each: "ຄົນປະມານໜຶ່ງຮ້ອຍຄົນແລ່ນເຂົ້ານຮ້ານ." → "ເບິ່ງແມ, ຄົນແຫ່ກັນມາຫຼາຍແທ້ເນາະ!"; "ບັນຍາກາດໃນຮ້ານວຸ້ນວາຍຕື່ນເຕັ້ນກົນລະຫົນ." → "ເປັນຫຍັງມື້ນີ້ວຸ້ນວາຍແທ້ເດ?"; "ຝູງຊົນຍາດກັນຈ່າຍເງິນຊື້ຢ່າງຄຶກຄື້ນ." → "ທຸກຄົນແຍ່ງກັນຊື້ຍ້ອນມັນດີແທ້ໆ."; "ທຸກຄົນພໍໃຈກັບ SD PIUS ຫຼາຍ." → "ຂ້ອຍກໍພໍໃຈກັບ SD PIUS ຫຼາຍເດີ." Rewrite every line this way: someone in frame is talking, not a camera narrator summarizing the action. Convert ALL supplied product purposes/benefits from desc into truthful spoken dialogue distributed across Shots 3-10; do not merely describe what the picture shows and do not invent a new claim. Shots 3-4 introduce the exact product name. At least one adjacent pair is a real question-and-answer exchange. The sales CTA may be in Shot 11 or Shot 12 and must contain an action such as ທັກ, ແຊັດ, ສັ່ງ, ຊື້, ລອງ, ຮີບ, ໂທ or ຕິດຕໍ່. Shot 12 remains a zero-person product-only Hero visually, but its line is spoken as a clean off-screen brand voice, for example “ທັກມາທາງເພຈໄດ້ເລີຍ” or “[brand] ດູແລທ່ານ”. Never append citations, source markers, footnotes, references, [cite: ...], or [citation: ...] to any value or narration line.
5. ONE-PASS SELF-CHECK BEFORE REPLYING — the bot sends this request once and validates the answer once; there is no automatic repair request. Silently check every item and fix your draft before submitting it:
- Output exactly one unlabelled fenced code block with exactly four nonempty sections in this order: ===NAME===, ===DESC===, ===STORY===, ===NARRATION===. No preface or afterword.
- STORY contains MASTER IDENTITY & CONTINUITY CARD with Target audience, Characters, Locations, Recurring props and Continuity path; then exactly CLIP 1, CLIP 2, CLIP 3 headings and SHOT 1 through SHOT 12 once each, in order.
- Every SHOT has separate TIME, PEOPLE, LOCATION, ACTION, CAMERA, LIGHT, PRODUCT, CONTINUITY IN and CONTINUITY OUT fields with concrete, consistent details. The real product is visible in the scene by Shot 3; Shot 12 is product-only with no people or hands.
- NARRATION has exactly 12 numbered Lao lines. Each line is one natural spoken clause of 6-14 Lao syllables, with no Thai characters or citation markers. Shots 1-11 are spoken by a visible person, not an outside narrator. Shot 12 is the short brand-voice CTA over the zero-person hero.
- The exact product name is spoken in Shot 3 or 4; at least one adjacent pair forms a real question and answer; a clear action CTA appears in Shots 10-12. Preserve the supplied story, cast, location and ending.
If any item fails, correct it internally and check the complete answer again before sending. Do not output the checklist or an explanation.

FINAL OUTPUT CONTRACT — this decides whether the answer is accepted at all:
Your reply is one code block and nothing else. The first line inside it is exactly ===NAME===. The block also contains the lines ===DESC===, ===STORY=== and ===NARRATION===, each alone on its own line, in that order. The last line inside it is narration line 12, written as plain text starting with "12. ". An answer that omits any of the four marker lines is rejected and wasted, however good the writing is.`;
}

function buildBriefRepairRequest(brief, priorAnswer, errors) {
  return `${buildBriefExpansionRequest(brief)}

QUALITY GATE REPAIR: The previous answer failed the bot's strict validation. Return all four complete sections again in the same plain-text format, not a patch and not an explanation. Preserve every correct user-supplied fact and narration meaning; repair only missing or inconsistent structure/details.

An error reading "Narration Shot N: <number> ພະຍາງ ... ຍາວເກີນ" means that spoken line is far too long for its 2.5-second shot. Rewrite that line much shorter — one short clause of about 5 to 9 Lao words, keeping the same meaning and speaker — instead of re-sending it at its old length.

An error reading "ມີຕົວໜັງສືໄທປົນ" means that line mixes Thai letters into Lao text (the scripts look alike, for example Thai ด ี instead of Lao ດ ີ). Rewrite that line using Lao letters only — every character must be in the Lao block, never Thai.

An error reading "ຍັງເປັນຄຳສັ້ນ/ຫົວຂໍ້" or "ເປັນຄຳບັນຍາຍເຫດການ" means that line is narrator voice, describing the scene from outside it — it is not something a person in frame would actually say. Rewrite it as one person speaking: add a spoken-language word such as ຂ້ອຍ, ເຈົ້າ, ທ່ານ, ນີ້, ແມ່ນ, ບໍ່, ແນ່, ເດີ, ດີ, ຢາກ, ຮູ້ສຶກ, ແນະນຳ, ຊ່ວຍ, ສົນໃຈ, and phrase it as something said in reaction to what is happening, not a report of what is happening. Example: "ຄົນແຫ່ກັນເຂົ້າຮ້ານ." (narrator, rejected) becomes "ເບິ່ງແມ, ຄົນແຫ່ກັນມາຫຼາຍແທ້ເນາະ!" (spoken, accepted).

Leave the lines that were not flagged exactly as they were.

VALIDATION ERRORS:
${errors.map((x, i) => `${i + 1}. ${x}`).join('\n')}

PREVIOUS ANSWER:
${String(priorAnswer || '').slice(0, 30000)}`;
}

// ແຍກຕອບ AI ມາເປັນລາຍການ shot
// ດຶງບັດ CONTINUITY ອອກມາ — ບັດນີ້ຈະຖືກສຽບເຂົ້າທຸກ prompt ຂອງ Flow
function parseContinuity(raw) {
  const m = String(raw || '').match(/```jodflow\s*([\s\S]*?)```/i);
  const body = (m ? m[1] : raw || '').trim();
  const c = body.match(/^CONTINUITY\s*\n([\s\S]*?)(?=^-{3,}\s*$)/m);
  if (!c) return '';
  return c[1].split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// Additive quality audit only: older saved jobs remain usable, while new AI
// output is checked for stable character/location IDs and world details.
function continuityIssues(continuity) {
  const text = String(continuity || '').trim();
  if (!text) return ['ບໍ່ມີ CONTINUITY manifest'];
  const issues = [];
  if (!/^Character\s+C\d{2}\s*:/im.test(text)) issues.push('ຂາດ Character ID ເຊັ່ນ C01');
  if (!/^Location\s+L\d{2}\s*:/im.test(text)) issues.push('ຂາດ Location ID ເຊັ່ນ L01');
  if (!/^LocationSource\s*:\s*(?:USER_SPECIFIED|NEUTRAL_UNNAMED)\s*$/im.test(text)) {
    issues.push('ຂາດ LocationSource USER_SPECIFIED/NEUTRAL_UNNAMED');
  }
  for (const field of ['TimeOfDay', 'Lighting', 'Props', 'Palette']) {
    if (!new RegExp(`^${field}\\s*:`, 'im').test(text)) issues.push(`ຂາດ ${field}`);
  }
  const characterLines = text.split('\n').filter(line => /^Character\s+C\d{2}\s*:/i.test(line));
  for (const line of characterLines) {
    if (line.length < 90) issues.push(`${line.match(/Character\s+C\d{2}/i)?.[0] || 'Character'} ລາຍລະອຽດສັ້ນເກີນໄປ`);
  }
  const locationLines = text.split('\n').filter(line => /^Location\s+L\d{2}\s*:/i.test(line));
  for (const line of locationLines) {
    if (line.length < 90) issues.push(`${line.match(/Location\s+L\d{2}/i)?.[0] || 'Location'} ລາຍລະອຽດສັ້ນເກີນໄປ`);
  }
  return issues;
}

function parseScript(raw) {
  const m = String(raw || '').match(/```jodflow\s*([\s\S]*?)```/i);
  const body = (m ? m[1] : raw || '').trim();
  const parts = body.split(/^-{3,}\s*$/m).map(x => x.trim()).filter(Boolean);
  const shots = [];
  for (const p of parts) {
    // [^\n]* ກິນສ່ວນທ້າຍແຖວຫົວ (ເຊັ່ນ "(voice-over)") ບໍ່ໃຫ້ຕົກລົງໄປປົນກັບບົດພາກ
    const h = p.match(/^Shot\s+(\d{1,2})\s*\|\s*([\w-]+)\s*\|\s*([\d.]+)\s*s[^\n]*/im);
    if (!h) continue;
    const rest = p.replace(h[0], '').trim();
    const sceneMatch = rest.match(/^SCENE:\s*(.+)$/im);
    // ແປງຕົວໄທ→ລາວ ຕັ້ງແຕ່ຕອນອ່ານຄຳຕອບ AI ບົດພາກຈຶ່ງເປັນລາວລ້ວນຕັ້ງແຕ່ຕົ້ນ
    const scene = sceneMatch ? stripAICitations(sceneMatch[1]) : '';
    const text = thaiToLao(stripAICitations(rest.replace(/^SCENE:.*$/im, '')));
    shots.push({ shot: Number(h[1]), role: h[2].toLowerCase(), seconds: Number(h[3]), text, scene });
  }
  return shots.sort((a, b) => a.shot - b.shot);
}

// ກວດສະຄຣິບ: ຄົບ 12 shot ແລະພະຍາງພໍດີ.
// ສັດສ່ວນ presenter/customer ເປັນພຽງຄ່າແນະນຳ, ບໍ່ໃຊ້ເປັນປະຕູບລັອກ.
const NARRATION_OPENERS = /^(ປະກົດການ|ບັນຍາກາດ|ຝູງຊົນ|ຄົນແຫ່|ລ້າງໝາກ|ເຈັບເອວ|ຍ່ຽວເປັນໜອງ|ລຸກນັ່ງເຈັບ|ຄວາມ|ການ|ພາບ|ສາກ|ເຫດການ|ຜູ້ຄົນ|ທຸກຄົນກຳລັງ)/;
const CTA_WORDS = /(ທັກ|ແຊັດ|ສັ່ງ|ຊື້|ລອງ|ຮີບ|ໂທ|ຕິດຕໍ່|ຢ່າລໍຊ້າ)/;
const SPOKEN_SENTENCE_CUES = /(ຂ້ອຍ|ເຈົ້າ|ທ່ານ|ພວກເຮົາ|ພວກເຈົ້າ|ເຮົາ|ນີ້|ນັ້ນ|ແມ່ນ|ມີ|ບໍ່|ບໍ|ແນ່|ເລີຍ|ເດີ|ລອງ|ຢາກ|ຮູ້ສຶກ|ຂໍ|ເຊີນ|ແນະນຳ|ຊ່ວຍ|ເໝາະ|ດີ|ສະດວກ|ສົນໃຈ|ເນາະ|ແທ້|ຫຍັງ|ເນ|ແທດ|ແທ່|ຈັ່ງແມ່ນ)/;
// ປະໂຫຍກທີ່ລົງທ້າຍ ! ຫຼື ? ແມ່ນການເວົ້າຕໍ່ໜ້າ/ອຸທານ/ຖາມ ສະເໝີ — ບໍ່ແມ່ນ narrator
// ຕົວຢ່າງ: "ຄົນມາຫຼາຍແທ້ເນາະ!" "ເປັນຫຍັງຄົນຈຶ່ງມາຊື້ຫຼາຍ?" ຖືກປະຕິເສດຜິດມາກ່ອນ ທັງທີ່ເປັນຄຳເວົ້າຈິງ
const SPOKEN_PUNCTUATION_CUE = /[!?！？]\s*$/;

function dialogueIssues(shots, product = {}) {
  const issues = [];
  const byShot = new Map((shots || []).map(s => [Number(s.shot), s]));
  for (let i = 1; i <= 11; i++) {
    const s = byShot.get(i);
    if (!s) continue;
    const text = String(s.text || '').trim();
    if (NARRATION_OPENERS.test(text)) issues.push({ shot: i, reason: 'ເປັນຄຳບັນຍາຍເຫດການ ບໍ່ແມ່ນຄຳທີ່ຄົນໃນສາກເວົ້າຈິງ' });
    else if (!SPOKEN_SENTENCE_CUES.test(text) && !SPOKEN_PUNCTUATION_CUE.test(text)) issues.push({ shot: i, reason: 'ຍັງເປັນຄຳສັ້ນ/ຫົວຂໍ້ ບໍ່ແມ່ນປະໂຫຍກສົນທະນາທີ່ມີຄວາມໝາຍສົມບູນ' });
  }
  const hero = byShot.get(12);
  if (hero && !String(hero.text || '').trim()) issues.push({ shot: 12, reason: 'Hero shot ຕ້ອງມີສຽງ brand voice CTA 6-14 ພະຍາງ' });
  const cta = byShot.get(11);
  if (!CTA_WORDS.test(`${cta?.text || ''} ${hero?.text || ''}`)) issues.push({ shot: 12, reason: 'Shot 11 ຫຼື 12 ຕ້ອງມີ CTA ທີ່ຊັດເຈນ' });
  const name = String(product.name || '').replace(/\s+/g, '');
  if (name) {
    const introduced = (shots || []).filter(s => s.shot >= 3 && s.shot <= 10).some(s => String(s.text || '').replace(/\s+/g, '').includes(name));
    if (!introduced) issues.push({ shot: 3, reason: `ຍັງບໍ່ມີຄົນແນະນຳຊື່ສິນຄ້າ “${product.name}”` });
  }
  return issues;
}

// Hard gate: image/video generation must never start unless all twelve shots
// exist exactly once and each one has spoken Lao text. Other quality findings
// remain warnings so they do not unnecessarily block the user's workflow.
function requiredDialogueErrors(shots) {
  const errors = [];
  const counts = new Map();
  for (const shot of Array.isArray(shots) ? shots : []) {
    const n = Number(shot && shot.shot);
    if (Number.isInteger(n)) counts.set(n, (counts.get(n) || 0) + 1);
  }
  for (let n = 1; n <= 12; n++) {
    const matches = (Array.isArray(shots) ? shots : []).filter(s => Number(s && s.shot) === n);
    if (!matches.length) errors.push(`ບໍ່ມີ Shot ${n}`);
    else if (matches.length > 1) errors.push(`Shot ${n} ຊ້ຳ ${matches.length} ຄັ້ງ`);
    else if (!String(matches[0].text || '').trim()) errors.push(`Shot ${n}: ບົດພາກຫວ່າງ`);
  }
  return errors;
}

function validateScript(shots, product = {}) {
  const errs = [];
  if (shots.length !== 12) errs.push(`ຕ້ອງມີ 12 shot ແຕ່ໄດ້ ${shots.length}`);
  const nums = new Set(shots.map(s => s.shot));
  for (let i = 1; i <= 12; i++) if (!nums.has(i)) errs.push(`ບໍ່ມີ Shot ${i}`);
  for (const s of shots) {
    // ກວດວ່າ AI echo placeholder ຈາກ prompt ຕາມຕົວ (ບໍ່ໄດ້ຂຽນເນື້ອຫາຈິງ)
    if (/^\[.*ພະຍາງ.*\]$/.test(s.text || '') || /^\(.*ຂຽນ.*\)$/.test(s.text || '')) {
      errs.push(`Shot ${s.shot}: AI ຍັງບໍ່ຂຽນເນື້ອຫາ (echo placeholder) — ລອງ "ຂຽນໃໝ່ຈາກ AI" ອີກຄັ້ງ`);
    }
    const r = fits(s.text, s.seconds);
    if (!r.ok) errs.push(`Shot ${s.shot}: ${r.n} ພະຍາງ (ຕ້ອງ ${r.min}-${r.max})`);
    // ຕົວໜັງສືໄທໃນບົດລາວ = ຜິດສະເໝີ (ແປງອັດຕະໂນມັດບໍ່ໄດ້ຈຶ່ງມາຮອດນີ້)
    const thai = thaiLeftovers(s.text);
    if (thai.length) errs.push(`Shot ${s.shot}: ມີຕົວໜັງສືໄທປົນ (${thai.join(' ')}) — ຕ້ອງເປັນລາວລ້ວນ`);
  }
  for (const issue of dialogueIssues(shots, product)) errs.push(`Shot ${issue.shot}: ${issue.reason}`);
  for (const error of requiredDialogueErrors(shots)) if (!errs.includes(error)) errs.push(error);
  return errs;
}

// Locks ທີ່ຕ້ອງຢູ່ໃນທຸກ prompt Flow (ຈາກ SKILL)
const FLOW_LOCKS = {
  referenceImage: 'REFERENCE IMAGE LOCK: Use the accepted storyboard sheet and the accepted actual product photo attached in the same request. The storyboard sheet is a planning reference for the four ordered shots in this clip; render each shot as its own full-frame live-action moment. Never output, animate or reproduce the sheet/page/table/grid/border as the video. A filename, path, URL or written description is not an image input. If either required image is missing or rejected, stop and report NOT VERIFIED.',
  imageToVideo: 'IMAGE-TO-VIDEO LOCK: Image 1 is a storyboard planning sheet, NOT a video frame to animate. Read the matching panel for its scene, people and action, then render that scene alone as one edge-to-edge live-action frame. Never use any pixels from the sheet page, grid, captions, diagrams, white paper or neighboring panels as an opening frame, overlay, transition or background. Image 2 is the only product identity reference. Preserve the supplied face, people, location, lighting, wardrobe and action; add only natural motion and camera movement. Do not create a replacement storyboard image, new face, new person, new location, new lighting, new wardrobe or new product.',
  characterLocation: 'CHARACTER AND LOCATION LOCK: Preserve each supplied person’s face, age, hair, clothing, accessories, location layout, lighting direction, time of day and props. Keep the supplied commercial location; do not substitute a hospital, clinic, pharmacy or unrelated location. LOCATION PROVENANCE IS FIXED: if LocationSource is NEUTRAL_UNNAMED, keep an unnamed generic setting and never add or imply a city, province, country, monument, temple, landmark, civic architecture, identifiable skyline or location sign. In particular, never introduce Patuxai or any other famous landmark unless the user explicitly named it.',
  actionStoryboard: 'STORYBOARD ACTION LOCK: Follow the accepted storyboard action, speed, number of people, movement direction and camera movement exactly. A dense crowd remains dense across foreground, midground, background and frame edges. Running, rushing and surging remain running, rushing and surging; do not reduce them to walking, standing or a small group.',
  outputFormat: 'OUTPUT FORMAT LOCK: Every video asset is one full-bleed vertical 9:16 moving picture that fills the canvas edge-to-edge. Return each requested clip as a separate video asset. NEVER create two panels or two video areas: no top/bottom stacked scenes, no side-by-side scenes, no horizontal split, no vertical split, no divider line, no two simultaneous moments, no 2x2 grid, collage, split-screen, storyboard page, paper sheet, table, contact sheet, panel border, white margin, black bar, rounded card, picture-in-picture or combined image. Each moment must occupy the entire 9:16 canvas by itself.',
  cleanFrame: 'ABSOLUTE CLEAN-FRAME LOCK — HIGHEST PRIORITY: Lao dialogue is AUDIO ONLY. Do not render generated writing or interface elements anywhere in the video: no subtitles, captions, titles, text boxes, lower-thirds, nameplates, tickers, callouts, floating words or numbers, shot/scene numbers, internal ids, role names, UI, watermarks or decorative typography. All bracketed speaker metadata and storyboard instructions must stay off screen. NEVER create a two-panel composition, top/bottom duplicate, side-by-side duplicate, divider or simultaneous before/after layout. Existing physical writing on the accepted real product may remain only in its original position, scale and appearance; never rewrite, enlarge, translate or recreate it. Non-text motion graphics may contain no letters or numbers and must not cover the product or a speaker face.',
  productRef: 'MANDATORY PRODUCT SOURCE-PIXEL LOCK — HIGHEST PRIORITY: The actual uploaded product photo attached to this request is the ONLY permitted source for the product package. Use that attached image and nothing else. Treat the package as a fixed photographic object, not a style reference and not a text description. Preserve its exact source pixels, silhouette, proportions, colors, logo, printed Lao lettering and artwork. Do not draw, redraw, regenerate, redesign, replace, recolor, simplify, reinterpret, approximate, infer or invent any package, bottle, box, label, logo or product. Do not use a text description to create a substitute. If the attached product image is missing, rejected, inaccessible or cannot be preserved exactly, STOP generation and report PRODUCT FIDELITY NOT VERIFIED. A generated lookalike is a failure.',
  audioSource: 'STRICT DIALOGUE LOCK: Every Shot 1-12 MUST contain and speak its exact assigned Lao dialogue line; never omit a line. For Shots 1-11, the visible assigned character speaks with synchronized mouth movement. No narrator, off-screen speech, paraphrase, additions, crowd speech or improvised words in Shots 1-11. Shot 12 is the only exception to visible lip-sync: keep the visual product-only with zero people, hands or body parts, while speaking the exact Shot 12 line as a clean off-screen brand voice CTA.',
  antiMontage: 'ANTI-MONTAGE / SEPARATE-ASSET LOCK: Return one separate video file per requested clip. Do not combine clips or scenes into one timeline, montage, collage, split-screen, storyboard reel, or combined export.',
  labelIntegrity: 'LABEL INTEGRITY LOCK: The attached current product photo is the sole authority for the package. The PACKAGE ARTWORK description is QA metadata only and is not permission to draw a package. Preserve the photographed container type, silhouette, cap or closure, proportions, material, colours, emblem, wordmark, label layout, artwork and printed details exactly as photographed. Keep that same package when held, angled, distant or moving. A generated lookalike, generic package, altered logo, invented lettering, recoloured label or redesigned artwork is a failure.',
  audioPacing: 'ON-CAMERA DIALOGUE PACING LOCK: Natural, clear Lao dialogue by the visible speaker with synchronized lip movement. Fit the complete exact line within its configured shot duration. For a longer line, begin speaking at the very start of that shot, remove unnecessary pauses, and speak briskly only as much as needed to finish before the cut. Keep every word intelligible and the lip movement synchronized. Never omit, shorten, paraphrase, overlap, or move words to another shot. Do not change shot duration or speed up the video itself. No announcer-style voice-over.',
  storyBeat: 'STORY BEAT LOCK: Preserve the ordered beats, named roles, requested locations, actions, transitions, and ending exactly. Do not merge, replace, reorder, or omit a required beat.',
  continuity: 'CONTINUITY LOCK: The CAST & WORLD card below is fixed for all 3 sheets and all 3 clips of this commercial. Every person, outfit, hairstyle, location, time of day, lighting direction, vehicle and colour palette must match that card exactly in every single band and every single shot. Never restyle, re-cast, relocate, or re-light a shot because its own description is short — fall back to the card. The whole commercial is ONE continuous story shot on ONE day with ONE cast. Respect LocationSource: NEUTRAL_UNNAMED means zero named or recognizable geography and zero invented landmarks in every output.',
  speakerShare: 'SPEAKER SHARE GUIDANCE ONLY: Presenter/customer share around 70/30 is optional guidance, never a validation gate. Preserve the supplied roles and narration exactly even when the measured share is below 65% or above 75%.',
};

// ກົດເຫຼັກ: ສິນຄ້າຕ້ອງເປັນໜ່ວຍດຽວກັນເປະໆທັງ 3 ຄລິບ ແລະ ຫ້າມວາດ/ສ້າງຂຶ້ນມາໃໝ່
// ເດັດຂາດ. ວາງໄວ້ເທິງສຸດຂອງ prompt ເພາະຄຳສັ່ງຕົ້ນໆມີນ້ຳໜັກກວ່າ.
const PRODUCT_IDENTITY_LOCK = `*** PRODUCT IDENTITY LOCK — HIGHEST PRIORITY RULE, OVERRIDES EVERY OTHER INSTRUCTION ***
Image 2 is the ONE AND ONLY product source. Whenever the product is required, composite the same single closed photographed package from Image 2 into the live-action scene. Preserve its photographed silhouette, closure, proportions, material, colours, printed surface, logo and artwork exactly. Keep it whole and closed. The number of visible product units must be exactly ONE.

The storyboard is action and composition guidance only; every product-like drawing or diagram on it is non-authoritative planning ink and must not become a scene object. Text descriptions and package-analysis metadata are also non-authoritative and must not be used to construct the product. Do not visualize or expose anything that is not visibly part of the single closed package in Image 2.

CROSS-CLIP IDENTITY — this clip is part of a 3-clip commercial:
The product in Clip 1, Clip 2 and Clip 3 must be the SAME physical object, pixel-for-pixel identical in artwork, text, colour and proportions. A viewer comparing any two frames from different clips must see the identical package. Never let the package drift, re-render or "re-interpret" between clips or between shots.

PERMITTED: only camera-realistic changes to the SAME object — its position in frame, distance, angle of view, motion, focus, and natural scene lighting falling on it. Its printed surface never changes.

IF YOU CANNOT PRESERVE IMAGE 2: leave the product out of the frame. Never replace it with a generated interpretation.`;

// ກົດ "ຄົນຕ້ອງເປັນຄົນດຽວກັນເປະໆ" (ໂໝດຄົນລິວິວ/ຂາຍຄອດ): Flow ຕ້ອງສ້າງໜ້າຄົນ
// ໃຫ້ຄືຮູບທີ່ແນບທຸກຊັອດ ບໍ່ສຸ່ມໜ້າໃໝ່.
const CHARACTER_FIDELITY_LOCK = `*** SAME-PERSON-EVERY-TIME LOCK — enforce on every single frame of every shot ***
ONE AND THE SAME PERSON: the on-camera presenter is the exact human in the attached person reference photo(s) and nobody else. Across all four shots of this clip, and across all three clips, the presenter must be the SAME individual — identical face, identical facial features, identical skin tone, identical hair, identical body build, identical apparent age and gender. A viewer freezing any two frames that show the presenter must see the same human.
WHEN THE PERSON REAPPEARS: render the same face identically. Do not swap, age, slim, beautify, re-cast or redesign the person between shots. If unsure how they looked, copy the attached person photo(s) exactly.
IF YOU CANNOT MATCH THE REFERENCE FACE: do not invent a different-looking person; keep the camera off the face rather than showing a stranger.`;

// ໂໝດ: product (ຄືເກົ່າ) | review (ຄົນລິວິວສິນຄ້າ) | course (ຂາຍຄອດ ບໍ່ມີສິນຄ້າ)
function modeOf(product) {
  const m = product && product.mode;
  return (m === 'review' || m === 'course') ? m : 'product';
}

// ແຖວບອກວ່າຮູບທີ່ແນບອັນໃດແມ່ນ "ຄົນ" (kind: 'clip'=ມີ storyboard sheet ເປັນ Image 1; 'sheet'=ບໍ່ມີ)
function characterMappingLine(mode, kind) {
  if (mode === 'review') {
    return kind === 'clip'
      ? 'PERSON REFERENCE: After the storyboard sheet (Image 1) and the product photo (Image 2), the remaining attached photo(s) are the PERSON. The on-camera presenter MUST match that person exactly — same face, hair, skin tone, build, age and gender. Never generate a different-looking person.'
      : 'PERSON REFERENCE: Besides the product photo, the remaining attached photo(s) are the PERSON. Every on-camera presenter MUST match that person exactly — same face, hair, skin tone, build, age and gender.';
  }
  return kind === 'clip'
    ? 'PERSON REFERENCE: After the storyboard sheet (Image 1), ALL remaining attached photo(s) are the PERSON. The on-camera presenter MUST match that person exactly — same face, hair, skin tone, build, age and gender. Never generate a different-looking person.'
    : 'PERSON REFERENCE: ALL attached photo(s) are the PERSON. Every on-camera presenter MUST match that person exactly — same face, hair, skin tone, build, age and gender.';
}

// ບລັອກ override ບ່ອນເທິງສຸດ — priority ສູງສຸດ, ແກ້ semantic ຂອງໂໝດ (ວ່າງສຳລັບ product)
function buildModeOverride(mode, kind, product = {}) {
  if (mode === 'product') return '';
  const personLook = String(product.personLook || '').trim();
  const personDesc = personLook
    ? `\nPERSON APPEARANCE (match this exactly, together with the attached person photo(s)):\n${personLook}\n`
    : '';
  if (mode === 'review') {
    return `*** MODE: PERSON REVIEWS PRODUCT — HIGHEST PRIORITY, READ FIRST ***
This commercial shows a real PERSON reviewing and recommending the product. Two identities must BOTH stay locked:
1) THE PRODUCT — exactly as in the attached product photo (every product rule below still applies in full).
2) THE PERSON — exactly as in the attached person photo(s): the on-camera presenter is that same human in every shot.
${characterMappingLine(mode, kind)}
SHOT 12 OVERRIDE: Shot 12 is NOT a product-only hero. Shot 12 shows the SAME person holding the product toward camera and speaking the exact Shot 12 Lao line on camera with lip-sync. The person and the product are both clearly visible; the product stays identical to the attached product photo.
${personDesc}
${CHARACTER_FIDELITY_LOCK}

`;
  }
  // course
  return `*** MODE: COURSE SELLING — NO PRODUCT — HIGHEST PRIORITY, OVERRIDES EVERY PRODUCT INSTRUCTION BELOW ***
This commercial sells a COURSE / service. THERE IS NO PHYSICAL PRODUCT. Ignore and DO NOT apply any instruction below about a product, package, box, bottle, jar, label, logo artwork, "Image 2 product source", product fidelity, single closed package, or a product-only hero — none of that exists here. No package, box, bottle, label or product object may appear in ANY frame.
${characterMappingLine(mode, kind)}
The on-camera presenter (the instructor) is the focus of every shot and speaks the exact assigned Lao line on camera with synchronized lip movement.
SHOT 12 OVERRIDE: Shot 12 is NOT a product hero. Shot 12 shows the SAME person facing camera delivering the exact Shot 12 Lao CTA line on camera with lip-sync. No product appears.
${personDesc}
${CHARACTER_FIDELITY_LOCK}

`;
}

// ກົດ "ສິນຄ້າຕ້ອງຄືກັນທຸກຊັອດ/ທຸກແຖບ" ແລະ "ຫ້າມແຕ້ມເມັດຢາ/ກ່ອງທີສອງ" — ຕົງຕາມ
// ອາການຈິງ: Flow ແຕ້ມກ່ອງ/ເມັດຢາໃໝ່ຂຶ້ນເອງໃນບາງຊັອດ ເຮັດໃຫ້ສິນຄ້າບໍ່ຄືກັນທັງຄລິບ.
const PRODUCT_CONSISTENCY_LOCK = `*** SAME-PACKAGE-EVERY-TIME LOCK — enforce on every single frame of every shot ***
ONE AND ONLY ONE PACKAGE: the product is the exact closed package in Image 2 and nothing else. Across all four shots of this clip, and across all three clips, the package must be the SAME single object — identical silhouette, identical colours, identical logo, identical printed lettering, identical proportions. A viewer freezing any two frames that show the product must see the same package.
WHEN THE PRODUCT REAPPEARS: render it identically to how it looked in the earlier shots. Do not vary, restyle, recolour, relabel, resize or redesign it between shots. If you are unsure how it looked, copy Image 2 exactly.
CLOSED PACKAGE, NO CONTENTS: the package stays sealed and whole. NEVER draw, reveal or add its contents — no pills, capsules, tablets, granules, powder, liquid, gel, coffee grounds, sachets or inner packets — and NEVER add a second box, bottle, blister strip, carton, pouch or any extra product-form object. Only the one closed package from Image 2 may appear.
IF YOU CANNOT MATCH IT: remove the product from that frame rather than drawing a different, altered or invented one.`;

const PRODUCT_VISIBILITY_LOCK = `PRODUCT STORY-PLACEMENT LOCK: The attached product photo is the only identity source for the product. In Shots 1-11, the product may appear naturally when required by the written story beat (discovery, explanation, holding, purchase or use-context), but it must remain an in-scene prop with believable scale, action and context; never invent a replacement package, alter the label, or create an isolated centered beauty/packshot insert before Shot 12. Shot 12 alone is the standalone product-only hero using the actual attached product image, with zero people, hands or body parts. If the story does not require the product in a shot, keep it absent; do not force an insert.`;

function sceneRequiresProduct(scene, product = {}, shot = 0) {
  if (Number(shot) === 12) return true;
  const escapedName = String(product.name || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const terms = [escapedName, '\\bproduct\\b', '\\bpackage\\b', '\\bbottle\\b', '\\bjar\\b', '\\blabel\\b', '\\bpackshot\\b']
    .filter(Boolean).join('|');
  return Boolean(terms && new RegExp(terms, 'i').test(String(scene || '')));
}

function productVisibilityNote(shot, scene, product) {
  const mode = modeOf(product);
  if (mode === 'course') {
    return 'PRODUCT VISIBILITY: NONE — this is a course/service ad with no product; show no product, package, box, bottle or label in any frame.';
  }
  if (Number(shot) === 12) {
    if (mode === 'review') {
      return 'PRODUCT VISIBILITY: REQUIRED — the on-camera person holds exactly ONE closed product (the actual attached product package) toward camera; keep the person clearly visible and preserve the package exactly.';
    }
    return 'PRODUCT VISIBILITY: REQUIRED — show exactly ONE closed product: the actual attached Image 2 package, product-only macro hero, zero people, hands or body parts.';
  }
  return sceneRequiresProduct(scene, product, shot)
    ? 'PRODUCT VISIBILITY: REQUIRED BY THIS STORY BEAT — show exactly ONE closed product, using only the actual attached Image 2 package as a small natural in-scene prop. Preserve Image 2 exactly; add no other product-form object.'
    : 'PRODUCT VISIBILITY: NOT REQUIRED IN THIS STORY BEAT — keep Image 2 as reference only and show no product-form object.';
}

// ສ້າງ prompt ສຳລັບ Google Flow — 1 ຄລິບ (4 shot, 10 ວິ)
// Flow renders a field-label line such as "Location L01: ..." or
// "Character C01: TC Salesman" as an on-screen caption, which is how LOCATION/L01
// and a salesman name chip got burnt into generated frames. Keep the ids — SCENE
// lines reference them — but strip the caption shape before any card reaches Flow.
function continuityForFlow(continuity) {
  return String(continuity || '')
    .split('\n')
    .map(l => l
      .replace(/^\s*Character\s+(C\d{2})\s*:\s*/i, 'The recurring person tracked internally as $1 is ')
      .replace(/^\s*Location\s+(L\d{2})\s*:\s*/i, 'The setting tracked internally as $1 is ')
      .replace(/^\s*LocationSource\s*:\s*/i, 'Location provenance is ')
      .replace(/^\s*TimeOfDay\s*:\s*/i, 'The time of day is ')
      .replace(/^\s*Lighting\s*:\s*/i, 'The lighting is ')
      .replace(/^\s*Props\s*:\s*/i, 'The recurring props are ')
      .replace(/^\s*Palette\s*:\s*/i, 'The colour palette is '))
    .join('\n');
}

// Both demands are absolute, so they lead the brief as numbered hard rules
// instead of sitting as one bullet among twelve global locks.
const NO_TEXT_HARD_RULES = `HARD RULES — the output is rejected if any one is broken:
0. NOTHING WRITTEN IN THIS BRIEF MAY BE DRAWN INTO THE PICTURE. Every word here is a direction to you, never a caption to render. Never print a field label, an id or a role name from this brief — in particular never render LOCATION, Location, Setting, Character, Person, Scene, Shot, Beat, Props, Palette, Lighting, TimeOfDay, any id such as L01, L02, C01 or C02, any role word such as presenter, customer or salesman, and any number, percentage or duration.
1. ZERO WRITING ON SCREEN. No generated Lao or English writing, subtitles, captions, titles, text boxes, interface elements, lower-thirds, callouts, UI or watermarks. Lao dialogue is SPOKEN AUDIO ONLY. The only writing permitted is the unchanged printing physically present on the accepted Image 2 product.
2. IMAGE AUTHORITY IS SEPARATE. Image 1 supplies scene composition, people and action only. Image 2 alone supplies the product. Product-like drawings and diagrams in Image 1 are planning marks, not scene objects.`;

// The pack description begins with the photographed package form. Only infer a
// form from that opening description; later mentions may describe background
// objects or things the product does not contain.
function photographedPackageForm(product = {}) {
  const opening = String(product.packLook || '').split(/[\n.!?]/, 1)[0].slice(0, 320);
  const m = opening.match(/\b(bottle|jar|carton|box|tube|sachet|pouch)\b/i);
  return m ? ({ carton: 'box', pouch: 'sachet' }[m[1].toLowerCase()] || m[1].toLowerCase()) : '';
}

function sceneForFlowVideo(scene, product = {}) {
  let visual = String(scene || '');
  const form = photographedPackageForm(product);
  if (form !== 'bottle' && form !== 'jar') return visual;
  // Repair only claims that describe the advertised product. Leave unrelated
  // boxes in the location, and leave the separate spoken dialogue untouched.
  const formPhrase = `the closed reference ${form}`;
  visual = visual
    .replace(/\b(?:the|a|an)?\s*(?:product|branded|medicine|supplement)\s+(?:box|carton|sachet|pouch|blister(?:\s+pack)?|pill\s+strip)\b/gi, formPhrase)
    .replace(/\b(?:(?:the|a|an)\s+)?(?:box|carton|sachet|pouch|blister(?:\s+pack)?|pill\s+strip)\s+(?:of|for|containing)\s+(?:the\s+)?(?:product|medicine|supplement|capsules?|pills?)\b/gi, formPhrase)
    .replace(/\b(holds?|holding|shows?|showing|presents?|presenting|offers?|offering|carries|carrying)\s+(?:(?:the|a|an)\s+)?(?:branded\s+)?(?:box|carton|sachet|pouch|blister(?:\s+pack)?|pill\s+strip)\b/gi, (_, action) => `${action} ${formPhrase}`);
  const name = String(product.name || '').trim();
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    visual = visual.replace(new RegExp(`\\b(?:(?:the|a|an)\\s+)?(?:box|carton|sachet|pouch|blister(?:\\s+pack)?|pill\\s+strip)\\s+(?:of|for)\\s+${escaped}\\b`, 'gi'), formPhrase);
  }
  return visual;
}

function buildFlowClipPrompt(clipNo, shots4, product, continuity) {
  const start = (clipNo - 1) * 4 + 1;
  const mode = modeOf(product);
  const modeOverride = buildModeOverride(mode, 'clip', product);
  const card = continuityForFlow(continuity);
  const isLongLine = s => countLaoSyllables(s.text) > Math.round((Number(s.seconds) || 2.5) * 4);
  const paceDirection = s => isLongLine(s)
    ? 'Long line: begin speaking immediately at shot start; use a brisk, clear Lao delivery with no unnecessary pauses so the exact full line ends before this shot cuts. Keep lip-sync natural.'
    : 'Use natural, clear Lao delivery within this shot.';
  const narration = shots4.map(s => {
    if (s.shot === 12) {
      if (mode === 'product') return `Shot 12: ${s.text} — [Speaker: off-screen brand voice | Duration: ${s.seconds}s | Treatment: clean CTA voice over product-only hero | ${paceDirection(s)}]`;
      const treat = mode === 'review' ? 'on-camera lip-sync, person holding the product' : 'on-camera lip-sync CTA to camera, no product';
      return `Shot 12: ${s.text} — [Visible speaker: on-camera presenter matching the person reference | Duration: ${s.seconds}s | Treatment: ${treat} | ${paceDirection(s)}]`;
    }
    return `Shot ${s.shot}: ${s.text} — [Visible speaker: ${s.role} | Duration: ${s.seconds}s | Treatment: on-camera lip-sync | ${paceDirection(s)}]`;
  }).join('\n');
  const refMapFor = (s) => {
    if (mode === 'course') return `REFERENCE MAPPING: Image 1 supplies only the scene, location, action and camera composition for Shot ${s.shot}. The attached person photo(s) are the sole source for the presenter's identity. There is no product. Output one full-frame live-action shot and never reveal the storyboard page, grid or border.`;
    if (mode === 'review') return `REFERENCE MAPPING: Image 1 supplies only the location, action and camera composition for Shot ${s.shot}. Image 2 is the sole product source. The attached person photo(s) are the sole source for the presenter's face and identity. Ignore every product-like drawing in Image 1. Output one full-frame live-action shot and never reveal the storyboard page, grid or border. All attached images must be visibly accepted in this request.`;
    return `REFERENCE MAPPING: Image 1 supplies only the people, location, action and camera composition for Shot ${s.shot}. Image 2 is the sole product source. Ignore every product-like drawing or diagram in Image 1. Output one full-frame live-action shot and never reveal the storyboard page, grid or border. Both images must be visibly attached and accepted in this request.`;
  };
  const audioFor = (s) => {
    if (s.shot !== 12) return `the visible ${s.role} character speaks only the exact dialogue assigned to Shot ${s.shot} below; show the character’s face/mouth during the line and synchronize lip movement. No voice-over or narrator. Use the corresponding storyboard panel only as scene guidance; output one full-frame live-action shot.`;
    if (mode === 'product') return 'Speak the exact Shot 12 Lao line as a clean off-screen brand voice CTA. Keep the image product-only with zero humans, hands or mouths. Animate only the accepted source-pixel product image with a slow linear push-in.';
    if (mode === 'review') return 'The same person from the attached person photo(s) holds the product toward camera and speaks the exact Shot 12 Lao line on camera with synchronized lip movement. Both the person and the exact attached product are clearly visible. No off-screen narrator.';
    return 'The same person from the attached person photo(s) faces camera and speaks the exact Shot 12 Lao line as an on-camera CTA with synchronized lip movement. No product appears. No off-screen narrator.';
  };
  const shotDesc = shots4.map(s => {
    const beat = DEFAULT_SPEAKERS[s.shot - 1]?.beat || '';
    const sceneNote = s.scene ? `\nVISUAL DIRECTION: ${sceneForFlowVideo(s.scene, product)}` : '';
    return `Shot ${s.shot} (${s.seconds}s, ${s.role}, beat=${beat}):${sceneNote}\n${productVisibilityNote(s.shot, s.scene, product)}\n${refMapFor(s)}\nAudio: ${audioFor(s)}`;
  }).join('\n');
  return `JOD FLOW — CLIP ${clipNo} OF 3 (Shots ${start}-${start + 3}, 9:16, ~10s total)

${modeOverride}CRITICAL OUTPUT RULE — ABSOLUTELY CLEAN FULL-SCREEN VIDEO. THIS IS MANDATORY FOR EVERY FRAME, INCLUDING THE FIRST FRAME, LAST FRAME AND ALL TRANSITIONS.
The storyboard sheet is PRIVATE planning reference only. Its page layout, panels, borders, margins, dividers, labels and writing are NEVER part of the filmed scene. Under no circumstances photograph, display, animate, reconstruct or transition through the storyboard sheet itself.
FRAME-ZERO RULE: Start directly on the filmed scene at 00:00:00. The FIRST decoded frame must already be a borderless full-screen live-action image. Do not use the storyboard sheet as an initial image, flash frame, transition, inset, background layer or closing frame. At every cut, fill the entire canvas with the next scene; crop out all sheet paper and panel edges before rendering.
Show exactly ONE live-action scene filling the entire vertical 9:16 canvas edge to edge at a time. ABSOLUTELY FORBIDDEN: inset images, collage, split screen, stacked panels, frames, borders, bars, cards, picture-in-picture, grids, contact sheets, empty margins or any visible storyboard layout.
ABSOLUTELY NO GENERATED ON-SCREEN WRITING in any language: no Lao subtitles, captions, dialogue, titles, labels, text boxes, names, numbers, UI or watermarks. Lao dialogue is SPOKEN AUDIO ONLY. The sole text exception is existing writing physically printed on the actual product package when that same package appears naturally in the scene; preserve it exactly as photographed. Abstract motion graphics are allowed only when they contain no letters or numbers.
If a proposed frame contains a storyboard element, border or generated writing, REMOVE that element and render only the clean full-screen scene. Never deliver a frame that violates this rule.

${PRODUCT_IDENTITY_LOCK}

${PRODUCT_CONSISTENCY_LOCK}

${NO_TEXT_HARD_RULES}
3. Image 1 supplies scene planning only. Image 2 supplies the only permitted product object. Never turn product-like planning marks from Image 1 into scene objects.

GLOBAL LOCKS (apply to this clip):
- ${PRODUCT_VISIBILITY_LOCK}
- ${FLOW_LOCKS.referenceImage}
- ${FLOW_LOCKS.imageToVideo}
- ${FLOW_LOCKS.characterLocation}
- ${FLOW_LOCKS.actionStoryboard}
- ${FLOW_LOCKS.outputFormat}
- ${FLOW_LOCKS.continuity}
${card ? `
=== CAST & WORLD CARD — PRIVATE PRODUCTION METADATA (fixed for the whole commercial — clip ${clipNo} must match it exactly; not one word of this card may appear on screen) ===
${card}
=== end of card ===
` : ''}- ${FLOW_LOCKS.cleanFrame}
- ${FLOW_LOCKS.productRef}
- ${FLOW_LOCKS.audioSource}
- ${FLOW_LOCKS.antiMontage}
- ${FLOW_LOCKS.labelIntegrity}
- ${FLOW_LOCKS.audioPacing}
- ${FLOW_LOCKS.storyBeat}

PRODUCT: ${product.name}
  PHOTOGRAPHED PACKAGE FORM: ${photographedPackageForm(product) || 'read directly from Image 2; no other form is permitted'}. This is the only product package form allowed in every visual direction. Any contrary packaging wording in a scene is superseded by Image 2; spoken dialogue stays unchanged.
  PRODUCT VISUAL SOURCE: read the appearance directly from Image 2. Package-analysis text is intentionally omitted from this video prompt so it cannot be mistaken for permission to invent visible contents or another package form.

SHOT BREAKDOWN:
${shotDesc}

SPOKEN LAO DIALOGUE — AUDIO ONLY, NEVER WRITTEN ON SCREEN (sole source of spoken Lao for every Shot 1-12; Shot 12 uses off-screen brand voice CTA). These lines are heard, never seen; do not subtitle, caption or display them:
${narration}

PRODUCT PACKAGE RULE — the clip is unusable if broken:
Use the attached product photograph as the only package source. The package is a fixed photographic object. Preserve the exact photographed pixels and artwork in every occurrence. The text description above is QA metadata only and must never be used to redesign or redraw the package. If the engine cannot preserve the exact package, leave the package out of the generated frame and report PRODUCT FIDELITY NOT VERIFIED. Never substitute a lookalike, generic carton, altered logo, invented lettering or redesigned label.

SPOKEN AUDIO RULE: For Shots 1-11, the visible assigned character speaks ONLY the exact Lao dialogue before the em dash with synchronized lip movement. Shot 12 is the only exception: speak its exact line as an off-screen brand voice while the visual remains product-only with zero people. Ignore bracketed metadata and never render it. All other text is instruction only.

FINAL CHECK BEFORE RENDERING — confirm all of these:
- EVERY frame, including transitions, is one borderless full-screen 9:16 scene; the storyboard sheet, its panels and all generated writing are ABSENT. If not, do not render that frame.
- Not a single generated word, letter, digit, label, chip, caption or subtitle appears anywhere in the frame; the only writing visible is the real printing on the attached product package, unchanged.
- Image 1 controls the scene; Image 2 alone controls the product. No planning diagram becomes a scene object.
- The Lao dialogue is heard as speech only.
- PRODUCT IDENTITY: every frame showing the product shows the SAME object as Image 2, with identical artwork, identical printed text, identical colours and identical proportions — nothing redrawn, retyped, recoloured or reshaped. If any frame shows a package that differs from Image 2 in any way, remove the product from that frame rather than shipping a different package.
- CROSS-CLIP MATCH: the package in this clip would be indistinguishable from the package in the other two clips of this commercial.
- SINGLE CLOSED PRODUCT RULE: when required, show exactly one whole closed package copied from Image 2, with no exposed contents and no additional product-form object.
- STORYBOARD PRODUCT MARKS ARE NOT ASSETS: Image 2 alone decides the product. Ignore all product-like planning marks in Image 1.
`;
}

// Prompt ສ້າງ Storyboard sheet (ຜ່ານ Flow image generation)
function buildFlowStoryboardPrompt(sheetNo, shots4, product, continuity) {
  const start = (sheetNo - 1) * 4 + 1;
  const mode = modeOf(product);
  const modeOverride = buildModeOverride(mode, 'sheet', product);
  const card = continuityForFlow(continuity);
  const range = ['topmost', 'second from the top', 'third from the top', 'bottom'];
  const panels = shots4.map((s, i) => {
    const beat = DEFAULT_SPEAKERS[s.shot - 1]?.beat || '';
    const others = [1, 2, 3, 4].filter(k => k !== i + 1).join(', ');
    const sceneRequiresProduct = s.shot === 12 || new RegExp([
      product.name || '', 'product', 'package', 'packaging', 'box', 'bottle',
      'carton', 'label', 'holding', 'holds', 'opening', 'opens', 'purchase', 'buy'
    ].filter(Boolean).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i').test(s.scene || '');
    let rule;
    if (mode === 'course') {
      // ຂາຍຄອດ: ບໍ່ມີສິນຄ້າເລີຍ — ທຸກແຖບແມ່ນຄົນ/ຜູ້ສອນ
      rule = s.shot === 12
        ? 'PERSON HERO — the same person from the attached person photo(s) faces camera, confident, premium background. NO product, package, box, bottle or label of any kind appears.'
        : 'PERSON-ONLY SCENE: people, location and action only. The attached photo(s) are the person identity reference — match that face. NEVER place any box, bottle, package, label, logo or product in this band; no product exists.';
    } else if (mode === 'review') {
      // ຄົນລິວິວ: ສິນຄ້າຄືເກົ່າ ແຕ່ Shot 12 = ຄົນຖືສິນຄ້າ ແລະ ຄົນຕ້ອງໜ້າຄືຮູບ
      rule = s.shot === 12
        ? 'PERSON + PRODUCT HERO — the same person from the attached person photo(s) holds the attached product toward camera, premium background. Both the person and the product are clearly visible; product matched 1:1 to the attached product photo. The presenter face must match the attached person photo(s).'
        : (sceneRequiresProduct
          ? 'PRODUCT AS A SMALL IN-SCENE PROP: the people, location and action remain the dominant composition. Keep the actual attached product naturally in a hand or on a scene surface, below 20 percent of the band area. The person and story action occupy most of the band. This band is not a packshot, beauty shot, catalogue photo or isolated product composition. The presenter face must match the attached person photo(s).'
          : 'PRODUCT ABSENT: this story beat contains people/location/action only. Treat the attached product photo as identity reference for other bands; do not place a box, bottle, package, label, logo or product substitute in this band. The presenter face must match the attached person photo(s).');
    } else {
      rule = s.shot === 12
        ? 'PRODUCT ONLY — ZERO humans, zero hands, zero body parts. Static macro hero of the packaging, matched 1:1 to the attached reference photo, dark premium background, slow linear push-in framing.'
        : sceneRequiresProduct
          ? 'PRODUCT AS A SMALL IN-SCENE PROP: the people, location and action remain the dominant composition. Keep the actual attached product naturally in a hand or on a scene surface, below 20 percent of the band area. The person and story action occupy most of the band. This band is not a packshot, beauty shot, catalogue photo or isolated product composition.'
          : 'PRODUCT ABSENT: this story beat contains people/location/action only. Treat the attached product photo as identity reference for other bands; do not place a box, bottle, package, label, logo or product substitute in this band.';
    }
    return `[instruction ${i + 1} of 4 — the ${range[i]} strip]
Shot ${s.shot} (${s.role}, beat=${beat})
VISUAL DIRECTION: ${s.scene || '(follow the beat above)'}
${rule}
Must look clearly different from strips ${others}.`;
  }).join('\n\n');

  const heroBand = shots4.findIndex(s => s.shot === 12) + 1;
  const heroCheckText = mode === 'course'
    ? `\n- Band ${heroBand} shows the same person as a clean hero; no product appears.`
    : (mode === 'review'
      ? `\n- Band ${heroBand} shows the same person holding the product.`
      : `\n- Band ${heroBand} contains NO people at all — product only.`);
  const heroCheck = heroBand ? heroCheckText : '';

  return `JOD FLOW — STORYBOARD SHEET ${sheetNo} OF 3 (Shots ${start}-${start + 3})

${modeOverride}${PRODUCT_IDENTITY_LOCK}

${PRODUCT_CONSISTENCY_LOCK}

STORYBOARD LAYOUT LOCK — ABSOLUTE HIGHEST PRIORITY:
- The output is accepted only when it contains EXACTLY FOUR different full-width photographic story bands stacked from top to bottom.
- A single photograph, single product packshot, catalogue image, beauty shot, poster, hero image or one-scene composition is INVALID even when it is vertical 9:16.
- Product fidelity never overrides the four-band layout. The attached product is an object inside a required story band, except Shot 12 which is the bottom hero band of Sheet 3.

LOCKS:
- ${PRODUCT_VISIBILITY_LOCK}
- IMAGE GENERATION PRODUCT RULE — HIGHEST PRIORITY: For every generated storyboard image, use the visibly attached and accepted actual product photo as the only product source. Copy the photographed package itself. The image model has zero permission to invent, redraw or replace the package from text. If exact source-image use is unavailable, stop and return NOT VERIFIED instead of generating a substitute.
- ${FLOW_LOCKS.productRef}
- ${FLOW_LOCKS.characterLocation}
- ${FLOW_LOCKS.actionStoryboard}
- ${FLOW_LOCKS.outputFormat}
- ${FLOW_LOCKS.cleanFrame}
- ${FLOW_LOCKS.labelIntegrity}
- ${FLOW_LOCKS.storyBeat}
- ${FLOW_LOCKS.continuity}
${card ? `
=== CAST & WORLD CARD — PRIVATE PRODUCTION METADATA (fixed for the whole commercial — sheet ${sheetNo} must match it exactly; not one word of this card may appear on the frame) ===
${card}
=== end of card ===
` : ''}
CANVAS: ONE single portrait image in 9:16 (tall and narrow, like a phone screen held upright).
VISUAL MEDIUM LOCK — HIGHEST PRIORITY: This is a live-action photographic storyboard made from real camera frames. Use natural human skin, real lens depth of field, physically believable lighting, real fabric and real locations. Do NOT render a cartoon, comic, illustration, painting, anime, manga, vector graphic, 3D character, CGI render, plastic figurine, or hand-drawn storyboard under any circumstance. If the requested result cannot be made photorealistic, do not invent an illustrated substitute; return NOT VERIFIED.
ABSOLUTE FULL-BLEED / NO-BORDER LOCK — HIGHEST PRIORITY: The finished 9:16 image touches the canvas edge on all four sides. It must have NO outer frame, NO inner frame, NO black border, NO white border, NO coloured border, NO rounded card edge, NO matte, NO vignette border, NO letterbox, NO pillarbox, NO picture-in-picture card, NO film strip, NO sprocket holes, NO perforations, NO camera frame, NO contact sheet, and NO decorative margin. The four scenes are photographic content that fills the entire canvas from edge to edge; the outermost pixels at top, bottom, left and right are always part of a real scene, never a border. If any film-frame or border treatment would be added, omit it completely.
The image contains four full-width horizontal scenes stacked directly one above the next.
- The topmost band fills the upper quarter of the image.
- The second band sits directly beneath the topmost band.
- The third band sits directly beneath the second band.
- The fourth band fills the bottom quarter of the image.
Every scene spans the full width of the image, edge to edge, left edge to right edge. All four scenes are the same height. Scenes meet directly with no gutter, no gap, no black divider, no white divider and no framed edge. Reading the image from top to bottom gives four stacked photographic scenes in story order.

HARD RULES — the sheet is rejected if any one is broken:
0. NOTHING WRITTEN IN THIS BRIEF MAY BE DRAWN INTO THE PICTURE. Words such as "instruction", "strip", "Shot", "beat", "VISUAL DIRECTION", "LOCATION", "Location", "Setting", "Character", "Person", "Props", "Palette", "Lighting", "TimeOfDay", every internal id such as L01, L02, C01 or C02, every role word such as presenter, customer or salesman, every number, every percentage, and every label here are directions to you, not captions to render. Do not print band numbers, percentages, ratios, or position markers anywhere on the frame, including in the margins and corners. The finished picture contains photographed scenes only — zero overlaid words or numbers.
1. FOUR full-bleed scenes, stacked vertically. There is no outer frame, no film border, no sprocket-hole edge, no gutter and no decorative divider. The scenes touch directly edge-to-edge.
2. ALL 4 BANDS SHOW DIFFERENT SCENES. Never repeat a scene, never re-crop or re-angle the same moment, never reuse the same character pose across two bands. Four separate moments in the story.
3. Each band must differ from the other three in at least TWO of: location, which characters appear, camera distance, action taking place.
4. No vertical division appears anywhere in the image, and no scene is ever placed beside another scene. Each scene occupies its own full-width row; all rows share the same height. Scene transitions are direct clean photographic joins, not visible frames, borders, gutters, black bars, white bars or film perforations.
5. Render each band from ITS OWN VISUAL DIRECTION below. Do not replace a band with a variation of another band's scene, and do not drop a band because its direction seems similar.
6. No text anywhere on the frame: no titles, band numbers, captions, subtitles, footers, callouts, Lao text, English text, text boxes, speech bubbles, chips, pills, buttons, search icons, phone icons, lower-thirds, nameplates, UI widgets, logos or watermarks. Only writing physically present on the real attached product package may appear, left exactly as photographed.
9. ATTACHED IMAGES ARE THE ONLY VISUAL SOURCE for the product: build the package from the attached product photo alone and never invent, draw or design a new package, label, sign, badge or graphic element.
7. PHOTOREALISTIC LIVE-ACTION ONLY: real camera photograph, real people, real materials, real shadows and real locations. Not cartoon, comic, illustration, painting, anime, manga, vector art, 3D character art, CGI, plastic render, or drawn storyboard style.
8. PRODUCT VISIBILITY OVERRIDE: Follow each band's explicit PRODUCT ABSENT or PRODUCT AS A SMALL IN-SCENE PROP instruction. In Shots 1-11, people, location and action dominate every band and the product never becomes a full-band packshot. Shot 12 only is the standalone product hero inside its own fourth storyboard band.

 PRODUCT: ${product.name}
${product.packLook ? `\nPACKAGE ARTWORK REFERENCE (QA DESCRIPTION ONLY — attached pixels are the sole source):\n${product.packLook}\n` : ''}
${panels}

FINAL CHECK BEFORE RENDERING — confirm all of these:
- Counting from the top: four stacked full-width scenes, all the same height, with no outer border, no inner border, no black/white bars, no film strip and no sprocket holes; no vertical division anywhere.
- Band 1, band 2, band 3 and band 4 are four DIFFERENT scenes; none is a repeat or a re-crop of another.${heroCheck}
- Bands for Shots 1-11 may contain the exact attached product when the written story beat requires it, embedded in natural action and never as an isolated packshot; Shot 12 is the only standalone product hero, with no newly designed substitute.
- No text has been drawn onto the frame.
`;
}

// ຂຽນໃໝ່ບົດພາກ shot ທີ່ Flow ປະຕິເສດ (policy violation) ໃຫ້ຄວາມໝາຍຄືເກົ່າແຕ່ຜ່ານ filter
// ສຳຄັນ: ບົດເວົ້າລາວ (ຄຳຂາຍ/ສັບປະຄຸນ) ບໍ່ເຄີຍຖືກສົ່ງໄປໃຫ້ຕົວສ້າງຮູບ/ວິດີໂອເລີຍ
// ມີແຕ່ຄຳບັນຍາຍສາກ (SCENE) ເທົ່ານັ້ນທີ່ໄປ. ສະນັ້ນເມື່ອ Flow ບລັອກ ຕ້ອງແກ້ "ພາບ"
// ຢ່າງດຽວ — ບໍ່ຕ້ອງໄປອ່ອນຄຳຂາຍຂອງຜູ້ໃຊ້ ເຊິ່ງບໍ່ແມ່ນຕົ້ນເຫດ.
function buildRewriteRequest(shotText, sceneText, reason) {
  return `Flow ປະຕິເສດການສ້າງພາບຂອງ shot ນີ້ (ເຫດຜົນ: ${reason || 'policy violation'}).

ສິ່ງທີ່ຖືກບລັອກແມ່ນ "ພາບ" ບໍ່ແມ່ນຄຳເວົ້າ — ຂຽນໃໝ່ແຕ່ແຖວ SCENE ເທົ່ານັ້ນ.
ຫ້າມແຕະບົດເວົ້າລາວ ມັນຈະຖືກໃຊ້ຄືເກົ່າທຸກຄຳ.

${AD_SEQUENCE_LOCK} ຮັກສາໜ້າທີ່ຂອງ shot ເດີມ (Hook, Product, Highlight, Experience, CTA ຫຼື Hero), ຮັກສາຕົວລະຄອນ ສະຖານທີ່ ແລະ ຈັງຫວະເລື່ອງໃຫ້ຄືເກົ່າ.

ສິ່ງທີ່ມັກເຮັດໃຫ້ພາບຖືກບລັອກ ໃຫ້ລ້ຽງອອກ:
- ອາການເຈັບປ່ວຍທີ່ເຫັນຊັດ: ຄານ, ລົ້ມ, ຮ້ອງໄຫ້ດ້ວຍຄວາມເຈັບ, ບິດຕົວ, ຈັບບ່ອນເຈັບແຮງໆ
- ສ່ວນຮ່າງກາຍທີ່ບວມ ແດງ ມີບາດແຜ ເລືອດ ຜ້າພັນແຜ ເຂັມສັກ ນ້ຳເກືອ
- ບ່ອນຮັກສາພະຍາດ: ໂຮງໝໍ, ຫ້ອງກວດ, ຊຸດໝໍ, ເຄື່ອງມືແພດ, ຟິມ X-ray
- ການກິນຢາ/ເມັດຢາ ຫຼື ພາບກ່ອນ-ຫຼັງແບບການປິ່ນປົວ

ໃຫ້ປ່ຽນເປັນພາບທຳມະດາທີ່ຍັງສື່ເລື່ອງດຽວກັນແທນ ເຊັ່ນ: ຄົນນັ່ງພັກ ຍ່າງຊ້າ ຖູບ່າ ຢຽດຂາ ຫຼື ສີໜ້າບໍ່ສະບາຍເລັກນ້ອຍ ໃນສະຖານທີ່ທຳມະດາ.

SCENE ເກົ່າ: ${sceneText || '(ບໍ່ມີ)'}
(ບົດເວົ້າທີ່ຈະໃຊ້ຄືເກົ່າ ບໍ່ຕ້ອງຂຽນໃໝ່: ${shotText})

ຮູບແບບຜົນ (1 ແຖວເທົ່ານັ້ນ ບໍ່ຕ້ອງອະທິບາຍ):
SCENE: [English scene description ໃໝ່]`;
}

// ຂຽນໃໝ່ຫຼາຍ shot ພ້ອມກັນທີ່ພະຍາງບໍ່ຢູ່ໃນ budget — ລົບຄຳບໍ່ສຳຄັນ ຫຼືປ່ຽນຄຳ ແຕ່ຄົງຄວາມໝາຍ
function buildSyllableFixRequest(errorShots, product = {}, semanticIssues = []) {
  const reasonByShot = new Map(semanticIssues.map(x => [Number(x.shot), x.reason]));
  const lines = errorShots.map(s => {
    const b = syllableBudget(s.seconds);
    const n = countLaoSyllables(s.text);
    const dir = n > b.max ? 'ຍາວເກີນ ລົບຄຳບໍ່ສຳຄັນອອກ' : 'ສັ້ນເກີນ ຕື່ມຄຳໃຫ້ພໍດີ';
    const semantic = reasonByShot.get(Number(s.shot));
    return `Shot ${s.shot} (ປັດຈຸບັນ ${n} ພະຍາງ, ຕ້ອງ ${b.min}-${b.max}, ${semantic || dir}): ${s.text}`;
  }).join('\n');
  return `ສິນຄ້າ: ${product.name || '(ບໍ່ລະບຸ)'}\nຈຸດຂາຍ/ສັບພະຄຸນທີ່ອະນຸຍາດໃຫ້ໃຊ້: ${product.desc || '(ບໍ່ລະບຸ)'}\n\nຂຽນໃໝ່ແຕ່ລະ shot ໃຫ້ເປັນປະໂຫຍກເວົ້າທຳມະຊາດທີ່ມີຄວາມໝາຍສົມບູນ. Shot 1-11 ຄົນໃນສາກເວົ້າກັບອີກຄົນ ຫຼືກັບກ້ອງ; ຫ້າມຄຳບັນຍາຍພາບ/ເຫດການ, ຫ້າມ narrator, ຫ້າມຄຳສັ້ນແບບຫົວຂໍ້. ນຳຈຸດຂາຍ/ສັບພະຄຸນທີ່ໃຫ້ມາເປັນເນື້ອຫາຄຳເວົ້າ ແຕ່ຫ້າມປະດິດຄຳອ້າງໃໝ່. Shot 12 ເປັນສຽງ brand voice CTA ທັບພາບ Hero ສິນຄ້າລ້ວນ. ຄົງ role ແລະຄວາມໝາຍເດີມ. ທຸກ shot ເປົ້າໝາຍ 8-12 ພະຍາງ ແລະຕ້ອງຢູ່ໃນ 6-14 ພະຍາງ. ຖ້າ Shot 3 ຂາດການແນະນຳສິນຄ້າ ຕ້ອງເວົ້າຊື່ສິນຄ້າ. Shot 11 ຫຼື 12 ຕ້ອງມີ CTA ຊັດເຈນ.

${lines}

ຮູບແບບຜົນ (ແຖວດຽວຕໍ່ shot ເທົ່ານັ້ນ ບໍ່ຕ້ອງອະທິບາຍເພີ່ມ):
Shot <ເລກ>: <ຂໍ້ຄວາມລາວໃໝ່>`;
}

module.exports = {
  countLaoSyllables, syllableBudget, fits, DEFAULT_SPEAKERS,
  stripAICitations,
  buildScriptRequest, buildBriefExpansionRequest, buildBriefRepairRequest, parseScript, parseContinuity, continuityIssues, dialogueIssues, requiredDialogueErrors, validateScript, buildRewriteRequest, buildSyllableFixRequest, thaiToLao, thaiLeftovers,
  FLOW_LOCKS, buildFlowClipPrompt, buildFlowStoryboardPrompt,
};
