/* 影像處理：EXIF 拍攝日期、縮圖壓縮、日期／說明浮水印 -------------------- */
(function (g) {
  'use strict';

  const Img = {};

  /* ---- 讀取 JPEG EXIF 的 DateTimeOriginal(0x9003) ---- */
  Img.readExifDate = function (file) {
    return U.blobToArrayBuffer(file.slice(0, 262144)).then((buf) => {
      try {
        const dv = new DataView(buf);
        if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null; // 非 JPEG
        let off = 2;
        while (off + 4 < dv.byteLength) {
          if (dv.getUint8(off) !== 0xFF) break;
          const marker = dv.getUint8(off + 1);
          const size = dv.getUint16(off + 2);
          if (marker === 0xE1) {                       // APP1
            const start = off + 4;
            if (dv.getUint32(start) !== 0x45786966) return null; // "Exif"
            const tiff = start + 6;
            const le = dv.getUint16(tiff) === 0x4949;
            const ifd0 = tiff + dv.getUint32(tiff + 4, le);
            const dt = scanIfd(dv, tiff, ifd0, le, 0);
            return dt;
          }
          if (marker === 0xDA) break;                  // 進入影像資料
          off += 2 + size;
        }
      } catch (e) { /* 忽略解析失敗 */ }
      return null;
    }).catch(() => null);
  };

  function scanIfd(dv, tiff, ifd, le, depth) {
    if (depth > 2 || ifd <= tiff || ifd + 2 > dv.byteLength) return null;
    const n = dv.getUint16(ifd, le);
    let exifPtr = null;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const tag = dv.getUint16(e, le);
      const type = dv.getUint16(e + 2, le);
      const count = dv.getUint32(e + 4, le);
      if (tag === 0x8769) exifPtr = tiff + dv.getUint32(e + 8, le);
      if ((tag === 0x9003 || tag === 0x9004 || tag === 0x0132) && type === 2) {
        const vOff = count > 4 ? tiff + dv.getUint32(e + 8, le) : e + 8;
        let s = '';
        for (let k = 0; k < count - 1 && vOff + k < dv.byteLength; k++) s += String.fromCharCode(dv.getUint8(vOff + k));
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
    }
    if (exifPtr) return scanIfd(dv, tiff, exifPtr, le, depth + 1);
    return null;
  }

  /* ---- 載入為可繪製來源（自動套用 EXIF 方向） ---- */
  Img.load = function (file) {
    if (g.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(() => loadViaTag(file));
    }
    return loadViaTag(file);
  };

  function loadViaTag(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
      im.src = url;
    });
  }

  /* ---- 主流程：壓縮＋浮水印 ----
     opts = { maxEdge, quality, watermark:{dateMode,dateFormat,showLabel},
              label, date }                                              */
  Img.process = function (file, opts) {
    opts = opts || {};
    const maxEdge = opts.maxEdge || 1600;
    const quality = opts.quality || 0.82;

    const fixed = opts.date || null;   // 有指定日期就不必讀 EXIF

    return Promise.all([Img.load(file), fixed ? Promise.resolve(null) : Img.readExifDate(file)])
      .then(([src, exifDate]) => {
        // 記錄日期來源，讓使用者能驗證每張照片的日期是怎麼來的
        let takenAt, dateSource;
        if (fixed) { takenAt = fixed; dateSource = 'fixed'; }
        else if (exifDate) { takenAt = exifDate; dateSource = 'exif'; }
        else if (file.lastModified) { takenAt = new Date(file.lastModified); dateSource = 'file'; }
        else { takenAt = new Date(); dateSource = 'now'; }
        const sw = src.width, sh = src.height;
        const scale = Math.min(1, maxEdge / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));

        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);

        // 浮水印不在此燒進圖片，改於匯出時套用（見 Img.render）。
        // 這樣事後修改日期或格式都能重新反映，不會蓋成兩層。
        // dateMode 'none'：不蓋日期，但 takenAt 仍照常記錄供 ZIP 檔名與 CSV 使用。
        const wm = opts.watermark || {};
        const stamped = wm.dateMode !== 'none';

        if (src.close) src.close();

        return new Promise((res) => {
          cv.toBlob((blob) => {
            const thumbCv = document.createElement('canvas');
            const ts = Math.min(1, 320 / Math.max(w, h));
            thumbCv.width = Math.round(w * ts); thumbCv.height = Math.round(h * ts);
            thumbCv.getContext('2d').drawImage(cv, 0, 0, thumbCv.width, thumbCv.height);
            res({
              blob: blob,
              thumb: thumbCv.toDataURL('image/jpeg', 0.7),
              w: w, h: h, size: blob.size, takenAt: takenAt.getTime(), dateSource: dateSource,
              stamped: stamped,
              baked: false,                                   // 圖檔本身乾淨，匯出時才蓋
              stampDate: stamped ? takenAt.getTime() : null,  // null＝這張不蓋日期
              label: (wm.showLabel && opts.label) ? opts.label : ''
            });
          }, 'image/jpeg', quality);
        });
      });
  };

  /* ---- 匯出時套用浮水印 ------------------------------------------------
     photo.baked 為 undefined（舊版匯入）表示浮水印已經燒在圖裡，直接沿用；
     其餘一律依目前的 stampDate 與日期格式重新蓋，改日期後匯出即刻反映。  */
  Img.stampTextOf = function (photo, project) {
    if (!photo.stampDate) return '';
    const fmt = (project && project.watermark && project.watermark.dateFormat) === 'ROC' ? U.toRoc : U.toAd;
    return fmt(photo.stampDate);
  };

  Img.render = function (photo, project, quality) {
    if (photo.baked === undefined || photo.baked) return Promise.resolve(photo.blob);

    const dateText = Img.stampTextOf(photo, project);
    const label = photo.label || '';
    if (!dateText && !label) return Promise.resolve(photo.blob);

    return Img.load(photo.blob).then((src) => {
      const w = src.width, h = src.height;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(src, 0, 0);
      if (dateText) stamp(ctx, w, h, dateText, 'br');
      if (label) stamp(ctx, w, h, label, 'bl');
      if (src.close) src.close();
      return new Promise((res) => cv.toBlob(res, 'image/jpeg', quality || 0.86));
    });
  };

  // 一次算好整批，匯出時共用（避免同一張重複重繪）
  Img.renderAll = function (photos, project, onProgress) {
    const map = {};
    let done = 0;
    return photos.reduce((chain, p) => chain.then(() => Img.render(p, project).then((b) => {
      map[p.id] = b;
      done++;
      if (onProgress) onProgress(done, photos.length, '套用浮水印 ' + done + '/' + photos.length);
    })), Promise.resolve()).then(() => map);
  };

  /* ---- 浮水印文字 ---- */
  function stamp(ctx, w, h, text, pos) {
    if (!text) return;
    const fs = Math.max(16, Math.round(Math.min(w, h) * 0.045));
    const pad = Math.round(fs * 0.6);
    ctx.save();
    ctx.font = '700 ' + fs + 'px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(text).width;
    let x, y;
    if (pos === 'bl') { x = pad; y = h - pad; }
    else { x = w - tw - pad; y = h - pad; }

    // 半透明底條，確保白字在亮背景仍可辨識
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(x - pad * 0.5, y - fs, tw + pad, fs * 1.35);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = Math.round(fs * 0.25);
    ctx.fillText(text, x, y + fs * 0.12);
    ctx.restore();
  }

  g.Img = Img;
})(window);
