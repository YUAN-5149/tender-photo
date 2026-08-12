/* 產生 manifest 的 screenshots（Android 安裝對話框的大圖版面）。

   以 CDP 直接驅動 headless Chrome，不需要安裝任何套件（Node 22 內建 WebSocket）。
   會先在乾淨的 profile 裡寫入示範專案與 9 張示範照片，再逐一切換視窗尺寸截圖。

   先啟動本機伺服器：
     python -m http.server 8931
   再執行：
     node tools/make-screenshots.mjs "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" http://localhost:8931 screenshots

   Chrome 對 screenshots 的限制：最短邊 ≥320、最長邊 ≤3840、長短邊比 ≤2.3，
   且所有 narrow 截圖必須同一比例。目前直式 780×1560（2.0）、橫式 1280×800（1.6）。 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [CHROME, BASE, OUT] = process.argv.slice(2);
const PORT = 9333;
const PROFILE = join(tmpdir(), 'tp-shots-profile-' + Date.now());

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars',
  'about:blank'
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 還沒起來 */ }
    await sleep(250);
  }
  throw new Error('Chrome 沒有在時限內開好 debugging port');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? rej(new Error(m.method + ' ' + JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        c.waiters = c.waiters.filter((w) => (w.method === m.method ? (w.res(m.params), false) : true));
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeout = 15000) {
    return new Promise((res, rej) => {
      const w = { method, res };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error('等不到 ' + method)); }, timeout);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

/* 產生示範資料：畫面上要看得出「照片已依區域／工項／階段歸檔」 */
const SEED = `(async () => {
  const draw = (label, hue) => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1600, 1200);
    g.addColorStop(0, 'hsl(' + hue + ',16%,74%)'); g.addColorStop(1, 'hsl(' + hue + ',14%,48%)');
    x.fillStyle = g; x.fillRect(0, 0, 1600, 1200);
    x.strokeStyle = 'rgba(255,255,255,.26)'; x.lineWidth = 16;
    for (let i = -1200; i < 1700; i += 190) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 1200, 1200); x.stroke(); }
    x.textAlign = 'center';
    x.fillStyle = 'rgba(255,255,255,.92)'; x.font = '700 76px sans-serif';
    x.fillText('示範照片', 800, 570);
    x.fillStyle = 'rgba(255,255,255,.78)'; x.font = '500 50px sans-serif';
    x.fillText(label, 800, 660);
    x.textAlign = 'right';
    x.fillStyle = 'rgba(0,0,0,.5)'; x.font = '700 62px monospace';
    x.fillText('2026.08.12', 1524, 1124);
    x.fillStyle = '#fff'; x.fillText('2026.08.12', 1520, 1120);
    const t = document.createElement('canvas'); t.width = 400; t.height = 300;
    t.getContext('2d').drawImage(c, 0, 0, 400, 300);
    return new Promise((res) => c.toBlob((b) => res({ blob: b, thumb: t.toDataURL('image/jpeg', .7) }), 'image/jpeg', .85));
  };

  const p = Store.newProject({
    agency: '臺北市立龍山國民中學',
    projectName: '115年電源改善工程-教室線路更新第二期',
    docTitle: '施工照',
    periodStart: '2026-06-30', periodEnd: '2026-09-27',
    vendor: '億來科技股份有限公司'
  });
  p.areas = ['3F 301 教室', '3F 302 教室', '2F 走廊'].map((n) => Store.newArea(n));
  p.items = ['配電箱更新', '教室管線配置', '插座與開關更換', '照明燈具更新'].map((n) => Store.newItem(n, 'build'));
  await Store.saveProject(p);
  Store.setCurrentId(p.id);

  let seq = 0;
  for (const it of p.items.slice(0, 3)) {
    for (const st of ['施工前', '施工中', '施工後']) {
      const o = await draw(it.name + ' ' + st, 195 + seq * 13);
      seq++;
      await Store.savePhoto({
        id: U.uid('ph'), projectId: p.id, blob: o.blob, thumb: o.thumb,
        w: 1600, h: 1200, size: o.blob.size,
        areaId: p.areas[seq % 3].id, itemId: it.id, stage: st, note: '',
        takenAt: Date.now(), seq: seq, createdAt: Date.now()
      });
    }
  }
  return seq;
})()`;

const PICK = `(() => {
  document.querySelectorAll('#chips-area .chip')[0].click();
  document.querySelectorAll('#chips-item .chip')[0].click();
  document.querySelectorAll('#chips-stage .chip')[1].click();
  const f = document.querySelector('#gal-filter');
  f.value = 'all'; f.dispatchEvent(new Event('change'));
  return true;
})()`;

const PREVIEW = `(async () => {
  document.querySelector('#btn-preview').click();
  const imgs = [...document.querySelectorAll('#preview img')];
  await Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
  return imgs.length;
})()`;

// 窄版捲到 A4 預覽，讓「產出長什麼樣」直接看得到
const PREVIEW_SCROLL = PREVIEW.replace('return imgs.length;',
  `const card = document.querySelector('.card.span-2');
   scrollTo(0, card.getBoundingClientRect().top + scrollY - document.querySelector('.topbar').offsetHeight - 8);
   return imgs.length;`);

const SHOTS = [
  { file: 'shot-shoot.png', view: 'shoot', w: 390, h: 780, dpr: 2, touch: true, after: PICK },
  { file: 'shot-project.png', view: 'project', w: 390, h: 780, dpr: 2, touch: true },
  { file: 'shot-export.png', view: 'export', w: 390, h: 780, dpr: 2, touch: true, after: PREVIEW_SCROLL },
  { file: 'shot-wide-shoot.png', view: 'shoot', w: 1280, h: 800, dpr: 1, touch: false, after: PICK },
  { file: 'shot-wide-export.png', view: 'export', w: 1280, h: 800, dpr: 1, touch: false, after: PREVIEW }
];

try {
  const cdp = await CDP.connect(await target());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // 先開一次把示範資料寫進 IndexedDB（同一個 profile，後續導覽都讀得到）
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: BASE + '/index.html' });
  await loaded;
  await sleep(600);
  console.log('seeded photos:', await cdp.evaluate(SEED));

  for (const s of SHOTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: s.w, height: s.h, deviceScaleFactor: s.dpr, mobile: s.touch
    });
    // maxTouchPoints 即使 enabled:false 也必須是 1~16
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 1 });

    const ev = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE + '/index.html?view=' + s.view });
    await ev;
    await sleep(900);
    if (s.after) await cdp.evaluate(s.after);
    await sleep(500);

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(OUT, s.file), Buffer.from(data, 'base64'));
    const dim = await cdp.evaluate('JSON.stringify({w:innerWidth,h:innerHeight,coarse:matchMedia("(pointer:coarse)").matches})');
    console.log(s.file, '->', s.w * s.dpr + 'x' + s.h * s.dpr, dim);
  }
} finally {
  chrome.kill();
  await sleep(400);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* profile 可能還被鎖著 */ }
}
