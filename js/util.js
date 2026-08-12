/* 共用工具 ------------------------------------------------------------ */
(function (g) {
  'use strict';

  const U = {};

  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.pad = (n, len) => String(n).padStart(len || 2, '0');

  /* 日期 --------------------------------------------------------------- */
  // 西元 → 民國字串，例：2025-08-28 → 114.08.28
  U.toRoc = function (d, sep) {
    d = U.asDate(d);
    if (!d) return '';
    const s = sep === undefined ? '.' : sep;
    return (d.getFullYear() - 1911) + s + U.pad(d.getMonth() + 1) + s + U.pad(d.getDate());
  };

  // 西元字串，例：2025.08.28
  U.toAd = function (d, sep) {
    d = U.asDate(d);
    if (!d) return '';
    const s = sep === undefined ? '.' : sep;
    return d.getFullYear() + s + U.pad(d.getMonth() + 1) + s + U.pad(d.getDate());
  };

  U.toCompact = function (d) {
    d = U.asDate(d);
    if (!d) return '';
    return '' + d.getFullYear() + U.pad(d.getMonth() + 1) + U.pad(d.getDate());
  };

  U.asDate = function (v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const d = new Date(v);
    return isNaN(d) ? null : d;
  };

  // 西元 ISO 字串，例：2025-06-30（<input type="date"> 的值格式）
  U.toIso = function (d) {
    d = U.asDate(d);
    if (!d) return '';
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };

  // 任意輸入（民國字串／ISO／Date）→ ISO；無法解析回傳空字串
  U.anyToIso = (v) => U.toIso(U.parseRocInput(v));

  // 任意輸入 → 民國字串 114.06.30；無法解析回傳空字串
  U.anyToRoc = (v) => U.toRoc(U.parseRocInput(v));

  // 含頭尾的天數，例：06.30 ~ 09.27 為 90 天
  U.daysInclusive = function (a, b) {
    const d1 = U.parseRocInput(a), d2 = U.parseRocInput(b);
    if (!d1 || !d2) return null;
    return Math.round((d2 - d1) / 86400000) + 1;
  };

  // 民國字串 "114.06.30" / "1140630" → Date；也接受西元 "2025-06-30"
  U.parseRocInput = function (str) {
    if (!str) return null;
    const t = String(str).trim().replace(/[/\-]/g, '.');
    let m = t.match(/^(\d{2,3})\.(\d{1,2})\.(\d{1,2})$/);
    if (m) return new Date(+m[1] + 1911, +m[2] - 1, +m[3]);
    m = t.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = t.match(/^(\d{3})(\d{2})(\d{2})$/);
    if (m) return new Date(+m[1] + 1911, +m[2] - 1, +m[3]);
    return U.asDate(str);
  };

  /* 字串 --------------------------------------------------------------- */
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  };

  // 檔名安全化（保留中文）
  U.safeName = function (s, fallback) {
    const t = String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return t || (fallback || '未命名');
  };

  U.nonEmpty = (arr) => arr.filter((x) => x != null && String(x).trim() !== '');

  // 以單一空白串接非空欄位，作為照片標題
  U.joinCaption = function () {
    return U.nonEmpty(Array.prototype.slice.call(arguments)).join(' ');
  };

  /* 檔案 --------------------------------------------------------------- */
  U.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  };

  U.blobToArrayBuffer = function (blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsArrayBuffer(blob);
    });
  };

  U.bytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };

  /* 陣列 --------------------------------------------------------------- */
  U.chunk = function (arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  U.move = function (arr, from, to) {
    if (to < 0 || to >= arr.length) return arr;
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    return arr;
  };

  /* DOM ---------------------------------------------------------------- */
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  U.el = function (tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  };

  g.U = U;
})(window);
