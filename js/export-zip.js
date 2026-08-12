/* 匯出 ZIP —— 依「位置區域／工項／階段」建立資料夾並自動命名，附照片清單 CSV */
(function (g) {
  'use strict';

  const Z = {};

  function nameOf(list, id, fallback) {
    const x = (list || []).find((v) => v.id === id);
    return (x && x.name) || fallback || '';
  }

  /**
   * @param opts { includeDocx:Blob|null, structure:'area'|'item'|'flat', onProgress }
   */
  Z.build = function (project, photos, opts) {
    opts = opts || {};
    const zip = new JSZip();
    const structure = opts.structure || 'item';
    const rows = [['序號', '檔名', '位置區域', '工項', '階段', '拍攝日期', '備註']];

    const counters = {};
    photos.forEach((p, i) => {
      const area = nameOf(project.areas, p.areaId, '未分區');
      const item = nameOf(project.items, p.itemId, '未分類');
      const stage = p.stage || '無階段';
      const date = U.toCompact(p.takenAt || p.createdAt);

      let dir;
      if (structure === 'flat') dir = '';
      else if (structure === 'area') dir = U.safeName(area) + '/' + U.safeName(item) + '/' + U.safeName(stage) + '/';
      else dir = U.safeName(item) + '/' + U.safeName(stage) + '/';

      counters[dir] = (counters[dir] || 0) + 1;
      const seq = U.pad(counters[dir], 3);
      const fname = U.safeName([seq, area !== '未分區' ? area : '', item, stage !== '無階段' ? stage : '', date]
        .filter(Boolean).join('_')) + '.jpg';

      zip.file(dir + fname, p.blob);
      rows.push([String(i + 1), dir + fname, area, item, stage, U.toRoc(p.takenAt || p.createdAt), p.note || '']);
      if (opts.onProgress) opts.onProgress(i + 1, photos.length, '打包 ' + (i + 1) + '/' + photos.length);
    });

    const csv = '﻿' + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    zip.file('照片清單.csv', csv);

    const h = Layout.headerLines(project);
    zip.file('專案資訊.txt', [
      h.agency, h.title, h.period, h.vendor, '',
      '照片總數：' + photos.length,
      '匯出時間：' + new Date().toLocaleString('zh-TW')
    ].join('\r\n'));

    if (opts.includeDocx) zip.file(ExportDocx.filename(project), opts.includeDocx);

    return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
      if (opts.onProgress) opts.onProgress(meta.percent, 100, '壓縮中 ' + meta.percent.toFixed(0) + '%');
    });
  };

  Z.filename = function (project) {
    return U.safeName(U.toRoc(new Date()) + '-' + (project.agency || '工程') + '-施工照') + '.zip';
  };

  g.ExportZip = Z;
})(window);
