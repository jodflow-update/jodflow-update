// ສ້າງຮູບ hero ຂອງສິນຄ້າຈາກຮູບຈິງ (ຊັອດ 12) — ບໍ່ໃຫ້ Flow ແຕ້ມເອງ ຈຶ່ງຖືກຕ້ອງ 100%
// ໃຊ້ Chrome ທີ່ບັອດຂັບຢູ່ແລ້ວແຕ້ມລົງ canvas — ບໍ່ຕ້ອງຕິດຕັ້ງໂປຣແກຣມໃດເພີ່ມ
const { chromium } = require('playwright-core');
const fs = require('fs');
// ໃຊ້ຕົວຕັດສິນ port ອັນດຽວກັນກັບ worker.js — ຢ່າຍຶດ 9222 ຕາຍຕົວ
const { resolveCdpPort } = require('./cdp-port.js');
const PORT = resolveCdpPort();

// ຄ່າສຳຮອງເທົ່ານັ້ນ — ໃຊ້ເມື່ອຫາຂອບສິນຄ້າອັດຕະໂນມັດບໍ່ໄດ້.
// ເມື່ອກ່ອນຄ່ານີ້ຖືກໃຊ້ກັບທຸກຮູບ ເຊິ່ງຜູກກັບຮູບສິນຄ້າອັນດຽວ ພໍປ່ຽນສິນຄ້າ
// ກ່ອງຈຶ່ງຖືກຕັດຂາດ/ຕິດພື້ນຫຼັງ. ດຽວນີ້ບັອດຫາຂອບສິນຄ້າເອງຈາກຮູບແຕ່ລະອັນ.
const DEFAULT_CROP = { x: 0.15, y: 0.15, w: 0.70, h: 0.70 };

// crop = null ແປວ່າ "ຫາຂອບສິນຄ້າໃຫ້ເອງ" (ຄ່າເລີ່ມຕົ້ນ)
async function buildHero(refPath, outPath, crop = null) {
  if (!fs.existsSync(refPath)) throw new Error('ບໍ່ພົບຮູບສິນຄ້າ: ' + refPath);
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const pg = await b.contexts()[0].newPage();
  await pg.goto('about:blank');
  const url = 'data:image/jpeg;base64,' + fs.readFileSync(refPath).toString('base64');

  const b64 = await pg.evaluate(async ({ u, c: givenCrop, fallback }) => {
    const im = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
    });

    // ---- ຫາຂອບສິນຄ້າເອງ ----
    // ຫຼັກການ: ສີພື້ນຫຼັງປະມານຈາກຂອບຮູບ → ພິກເຊວທີ່ຕ່າງຈາກພື້ນຫຼັງຄືຂອງທີ່ຢູ່ໃນພາບ
    // → ຈັບກຸ່ມພິກເຊວທີ່ຕິດກັນ → ເລືອກກຸ່ມທີ່ "ໃຫຍ່ ແລະ ຢູ່ກາງພາບ" ທີ່ສຸດ
    // (ຮູບສິນຄ້າຜູ້ໃຊ້ຖ່າຍເອງ ສິນຄ້າມັກຢູ່ກາງ ສ່ວນຖົງ/ຜ້າກັ້ງ/ຂອງອື່ນຢູ່ແຄມ)
    function detectProductBox() {
      const SW = 200;
      const SH = Math.max(1, Math.round(im.height * SW / im.width));
      const cv2 = document.createElement('canvas');
      cv2.width = SW; cv2.height = SH;
      const g2 = cv2.getContext('2d', { willReadFrequently: true });
      g2.drawImage(im, 0, 0, SW, SH);
      const d = g2.getImageData(0, 0, SW, SH).data;
      const N = SW * SH;

      // ສີພື້ນຫຼັງ = ມັດທະຍົມຂອງວົງແຫວນຂອບຮູບ
      const ring = Math.max(2, Math.round(Math.min(SW, SH) * 0.06));
      const rs = [], gs = [], bs = [];
      for (let y = 0; y < SH; y++) {
        for (let x = 0; x < SW; x++) {
          if (x >= ring && y >= ring && x < SW - ring && y < SH - ring) continue;
          const i = (y * SW + x) * 4;
          rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
        }
      }
      const mid = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
      const bg = [mid(rs), mid(gs), mid(bs)];

      const diff = new Float32Array(N);
      for (let p = 0; p < N; p++) {
        const i = p * 4;
        diff[p] = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      }
      // ເສັ້ນແບ່ງປັບຕາມຮູບ (ເປີເຊັນໄທລ໌ 70) ແຕ່ບໍ່ຕ່ຳກວ່າ 45 ກັນພື້ນຫຼັງມີ noise
      const sorted = Float32Array.from(diff); sorted.sort();
      const thr = Math.max(45, sorted[Math.floor(N * 0.70)]);

      const lab = new Int32Array(N);
      const stack = new Int32Array(N);
      let best = null, id = 0;
      for (let s = 0; s < N; s++) {
        if (diff[s] <= thr || lab[s]) continue;
        id++;
        let top = 0, area = 0;
        let minx = SW, miny = SH, maxx = 0, maxy = 0;
        stack[top++] = s; lab[s] = id;
        while (top) {
          const p = stack[--top];
          const x = p % SW, y = (p / SW) | 0;
          area++;
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
          if (x > 0 && !lab[p - 1] && diff[p - 1] > thr) { lab[p - 1] = id; stack[top++] = p - 1; }
          if (x < SW - 1 && !lab[p + 1] && diff[p + 1] > thr) { lab[p + 1] = id; stack[top++] = p + 1; }
          if (y > 0 && !lab[p - SW] && diff[p - SW] > thr) { lab[p - SW] = id; stack[top++] = p - SW; }
          if (y < SH - 1 && !lab[p + SW] && diff[p + SW] > thr) { lab[p + SW] = id; stack[top++] = p + SW; }
        }
        const cx = (minx + maxx) / 2 / SW, cy = (miny + maxy) / 2 / SH;
        // ຢູ່ກາງພາບຫຼາຍເທົ່າໃດຄະແນນຍິ່ງສູງ — ກັນບັອດໄປຈັບຖົງ/ຜ້າກັ້ງທີ່ຢູ່ແຄມ
        const centre = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) * 2);
        const score = area * (0.25 + centre);
        if (!best || score > best.score) best = { score, minx, miny, maxx, maxy, area };
      }
      if (!best) return null;

      const pad = 0.04;
      let x0 = best.minx / SW - pad, y0 = best.miny / SH - pad;
      let x1 = (best.maxx + 1) / SW + pad, y1 = (best.maxy + 1) / SH + pad;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(1, x1); y1 = Math.min(1, y1);
      const w = x1 - x0, h = y1 - y0;
      // ກວດຄວາມສົມເຫດສົມຜົນ: ນ້ອຍ/ໃຫຍ່ເກີນໄປ ແປວ່າຈັບຜິດ → ໃຫ້ໃຊ້ຄ່າສຳຮອງແທນ
      if (w < 0.08 || h < 0.08 || w > 0.98 || h > 0.98) return null;
      // ສົ່ງສີພື້ນຫຼັງກັບໄປນຳ — ເມື່ອຫາຂອບໄດ້ ແປວ່າພື້ນຫຼັງຮຽບ ຈຶ່ງລຶບພື້ນຫຼັງ
      // ດ້ວຍສີໄດ້ແທ້ (ດີກວ່າເຮັດຂອບຈາງ ເຊິ່ງຈະກິນເນື້ອສິນຄ້າເມື່ອຂອບແໜ້ນ)
      return { x: x0, y: y0, w, h, auto: true, bg };
    }

    let c = givenCrop || null;
    if (!c) { try { c = detectProductBox(); } catch (e) { c = null; } }
    if (!c) c = fallback;
    const W = 720, H = 1280;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');

    // ພື້ນຫຼັງດຳມີແສງນຸ້ມຢູ່ກາງ ແບບຖ່າຍສະຕູດິໂອ
    const bg = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, W * 0.95);
    bg.addColorStop(0, '#2a1c14');
    bg.addColorStop(0.45, '#140d09');
    bg.addColorStop(1, '#000000');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    // ຕັດສະເພາະກ່ອງອອກມາ
    const sx = im.width * c.x, sy = im.height * c.y;
    const sw = im.width * c.w, sh = im.height * c.h;

    // ວາງກ່ອງໃຫ້ສູງປະມານ 46% ຂອງເຟຣມ ກາງຈໍ ຄ່ອນໄປທາງເທິງ
    const targetH = H * 0.46;
    const scale = targetH / sh;
    const dw = sw * scale, dh = sh * scale;
    const dx = (W - dw) / 2, dy = H * 0.30;

    // ເງົາໃຕ້ກ່ອງ
    g.save();
    g.filter = 'blur(26px)';
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.beginPath();
    g.ellipse(W / 2, dy + dh + 10, dw * 0.46, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // ແຕ້ມສິນຄ້າລົງ canvas ຍ່ອຍກ່ອນ ແລ້ວເຮັດໃຫ້ຂອບຈາງຫາຍເຂົ້າພື້ນມືດ.
    // ຖ້າແຕ້ມຮູບກົງໆ ຈະເຫັນເປັນ "ຮູບຖ່າຍສີ່ຫຼ່ຽມ" ແປະໃສ່ພື້ນດຳ ພ້ອມພື້ນຫຼັງຮົກ
    // (ໂຊຟາ/ຖົງ/ຜ້າກັ້ງ) ຕິດມານຳ. ການເຮັດຂອບຈາງເຮັດໃຫ້ເບິ່ງຄືພາບສະຕູດິໂອ.
    const pc = document.createElement('canvas');
    pc.width = Math.max(1, Math.round(dw));
    pc.height = Math.max(1, Math.round(dh));
    const pgx = pc.getContext('2d');
    pgx.drawImage(im, sx, sy, sw, sh, 0, 0, pc.width, pc.height);
    if (c.auto && c.bg) {
      // ພື້ນຫຼັງຮຽບ: ລຶບອອກຕາມສີ ໄດ້ຂອບສິນຄ້າແທ້ ບໍ່ກິນເນື້ອສິນຄ້າ
      const id = pgx.getImageData(0, 0, pc.width, pc.height);
      const px = id.data;
      const LO = 70, HI = 130;   // ໄກຈາກສີພື້ນຫຼັງເທົ່າໃດຈຶ່ງຖືວ່າເປັນສິນຄ້າ
      for (let i = 0; i < px.length; i += 4) {
        const dist = Math.abs(px[i] - c.bg[0]) + Math.abs(px[i + 1] - c.bg[1]) + Math.abs(px[i + 2] - c.bg[2]);
        const a = dist <= LO ? 0 : dist >= HI ? 1 : (dist - LO) / (HI - LO);
        px[i + 3] = Math.round(px[i + 3] * a);
      }
      pgx.putImageData(id, 0, 0);
    } else {
      // ພື້ນຫຼັງຮົກ (ຖ່າຍເອງໃນເຮືອນ): ເຮັດຂອບຈາງເປັນວົງມົນຮີທີ່ພໍດີກັບກອບ
      // ຮັບປະກັນວ່າເສັ້ນຂອບສີ່ຫຼ່ຽມຫາຍໝົດ ແລະ ຂອງຮົກໆຈາງເຂົ້າພື້ນມືດ
      pgx.globalCompositeOperation = 'destination-out';
      pgx.save();
      pgx.translate(pc.width / 2, pc.height / 2);
      pgx.scale(1, pc.height / pc.width);
      const R = pc.width / 2;
      const feather = pgx.createRadialGradient(0, 0, R * 0.40, 0, 0, R);
      feather.addColorStop(0, 'rgba(0,0,0,0)');
      feather.addColorStop(0.70, 'rgba(0,0,0,0.55)');
      feather.addColorStop(1, 'rgba(0,0,0,1)');
      pgx.fillStyle = feather;
      pgx.fillRect(-pc.width, -pc.height, pc.width * 2, pc.height * 2);
      pgx.restore();
      pgx.globalCompositeOperation = 'source-over';
    }

    g.drawImage(pc, dx, dy);

    // ເງົາສະທ້ອນເທິງພື້ນ (ໃຊ້ຮູບທີ່ຂອບຈາງແລ້ວ)
    g.save();
    g.globalAlpha = 0.16;
    g.translate(0, (dy + dh) * 2);
    g.scale(1, -1);
    g.drawImage(pc, dx, dy, dw, dh * 0.55);
    g.restore();

    // ໄລ່ສີດຳຂຶ້ນປິດຂອບເງົາສະທ້ອນ
    const fade = g.createLinearGradient(0, dy + dh, 0, dy + dh + dh * 0.55);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(0, dy + dh, W, dh * 0.6);

    return { b64: cv.toDataURL('image/png').split(',')[1], used: c };
  }, { u: url, c: crop, fallback: DEFAULT_CROP });

  fs.writeFileSync(outPath, Buffer.from(b64.b64, 'base64'));
  await pg.close();
  await b.close();
  buildHero.lastCrop = b64.used;   // ໄວ້ກວດ/ດີບັກວ່າບັອດຕັດຂອບໃສ
  return outPath;
}

module.exports = { buildHero, DEFAULT_CROP };

if (require.main === module) {
  const [ref, out] = process.argv.slice(2);
  buildHero(ref, out)
    .then(p => {
      const c = buildHero.lastCrop || {};
      console.log('ສ້າງ hero ສຳເລັດ →', p);
      console.log('ຂອບທີ່ໃຊ້:', c.auto ? 'ຫາເອງອັດຕະໂນມັດ' : 'ຄ່າສຳຮອງ',
        JSON.stringify({ x: +(c.x || 0).toFixed(3), y: +(c.y || 0).toFixed(3), w: +(c.w || 0).toFixed(3), h: +(c.h || 0).toFixed(3) }));
    })
    .catch(e => { console.error('ຜິດພາດ:', e.message); process.exit(1); });
}
