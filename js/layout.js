/* 版面配置：把照片編排成「每頁一張表格、2 欄 × 3 列（標題列＋照片列）」 -----
   產出的 pages 結構同時供 Word、PDF 列印、ZIP 清單使用。               */
(function (g) {
  'use strict';

  const Layout = {};

  Layout.COLS = 2;   // 每列 2 張（對應範本 2 欄）
  Layout.ROWS = 3;   // 每頁 3 列

  function nameOf(list, id) {
    const x = (list || []).find((v) => v.id === id);
    return x ? x.name : '';
  }

  /* 產生單一儲存格標題 */
  function caption(project, item, stage, photo) {
    const areaName = project.captionWithArea && photo ? nameOf(project.areas, photo.areaId) : '';
    const note = photo && photo.note ? photo.note : '';
    return U.joinCaption(areaName, item ? item.name : '', stage, note);
  }

  /* 供標題列使用（整組共用，不依賴單張照片） */
  function groupCaption(project, areaName, itemName, stage) {
    return U.joinCaption(project.captionWithArea ? areaName : '', itemName, stage);
  }

  /**
   * @param project 專案設定
   * @param photos  已排序的照片陣列
   * @returns pages: [{ key, title, rows:[{ cells:[{caption, photo}] }] }]
   */
  Layout.build = function (project, photos) {
    const mode = project.layoutMode || 'item';
    if (mode === 'flow') return buildFlow(project, photos);

    const groups = [];
    if (mode === 'area') {
      (project.areas.length ? project.areas : [{ id: null, name: '' }]).forEach((area) => {
        project.items.forEach((item) => {
          groups.push({
            areaName: area.name,
            item: item,
            photos: photos.filter((p) => p.itemId === item.id && (area.id === null || p.areaId === area.id))
          });
        });
      });
      // 未指定區域的照片另成一組
      project.items.forEach((item) => {
        const orphan = photos.filter((p) => p.itemId === item.id && !p.areaId);
        if (orphan.length && project.areas.length) groups.push({ areaName: '', item: item, photos: orphan });
      });
    } else {
      project.items.forEach((item) => {
        groups.push({ areaName: '', item: item, photos: photos.filter((p) => p.itemId === item.id) });
      });
    }

    // 未歸類到任何工項的照片
    const noItem = photos.filter((p) => !p.itemId || !project.items.some((i) => i.id === p.itemId));
    if (noItem.length) groups.push({ areaName: '', item: { id: null, name: '其他', stageSet: 'none' }, photos: noItem });

    const pages = [];
    groups.forEach((grp) => {
      if (!grp.photos.length && !project.includeEmpty) return;
      const stages = Store.stagesOf(grp.item);
      const buckets = stages.map((s) => grp.photos.filter((p) => (p.stage || '') === s));

      // 階段不在此工項設定內的照片，補進第一個階段桶
      const known = new Set(stages);
      const strays = grp.photos.filter((p) => !known.has(p.stage || ''));
      if (strays.length) buckets[0] = buckets[0].concat(strays);

      // 不分階段：整頁 6 格流水；分階段：每階段一列、每列 2 格
      const flat = stages.length === 1 && stages[0] === '';
      let pageCount = 1;
      if (flat) pageCount = Math.max(1, Math.ceil(buckets[0].length / (Layout.COLS * Layout.ROWS)));
      else buckets.forEach((b) => { pageCount = Math.max(pageCount, Math.ceil(b.length / Layout.COLS)); });

      for (let k = 0; k < pageCount; k++) {
        const rows = [];
        if (flat) {
          const list = buckets[0];
          for (let r = 0; r < Layout.ROWS; r++) {
            const base = (k * Layout.ROWS + r) * Layout.COLS;
            rows.push({
              cells: [0, 1].map((c) => ({
                caption: groupCaption(project, grp.areaName, grp.item.name, ''),
                photo: list[base + c] || null
              }))
            });
          }
        } else {
          stages.forEach((stage, si) => {
            const b = buckets[si] || [];
            rows.push({
              cells: [0, 1].map((c) => ({
                caption: groupCaption(project, grp.areaName, grp.item.name, stage),
                photo: b[k * Layout.COLS + c] || null
              }))
            });
          });
          while (rows.length < Layout.ROWS) rows.push({ cells: [{ caption: '', photo: null }, { caption: '', photo: null }] });
        }

        const hasPhoto = rows.some((r) => r.cells.some((c) => c.photo));
        if (!hasPhoto && k > 0) continue;
        if (!hasPhoto && !project.includeEmpty && grp.photos.length) continue;

        pages.push({
          key: (grp.areaName ? grp.areaName + '／' : '') + grp.item.name + (pageCount > 1 ? '（' + (k + 1) + '）' : ''),
          title: U.joinCaption(grp.areaName, grp.item.name),
          rows: rows
        });
      }
    });

    // 不分階段的工項可能產生多餘空白頁，過濾之
    return pages.filter((p, i) => p.rows.some((r) => r.cells.some((c) => c.photo)) || project.includeEmpty);
  };

  /* 依序流水：每格自帶標題 */
  function buildFlow(project, photos) {
    const cells = photos.map((p) => {
      const item = project.items.find((i) => i.id === p.itemId);
      return { caption: caption(project, item, p.stage || '', p), photo: p };
    });
    const rows = U.chunk(cells, Layout.COLS).map((cs) => {
      while (cs.length < Layout.COLS) cs.push({ caption: '', photo: null });
      return { cells: cs };
    });
    return U.chunk(rows, Layout.ROWS).map((rs, i) => {
      while (rs.length < Layout.ROWS) rs.push({ cells: [{ caption: '', photo: null }, { caption: '', photo: null }] });
      return { key: '第 ' + (i + 1) + ' 頁', title: '', rows: rs };
    });
  }

  /* 統計 */
  Layout.stats = function (project, photos) {
    const pages = Layout.build(project, photos);
    return {
      pages: pages.length,
      photos: photos.length,
      used: pages.reduce((n, p) => n + p.rows.reduce((m, r) => m + r.cells.filter((c) => c.photo).length, 0), 0)
    };
  };

  /* 頁首 4 行文字 */
  Layout.headerLines = function (project) {
    const period = U.joinCaption(
      project.periodStart || project.periodEnd
        ? '工程期限：' + (project.periodStart || '') + (project.periodEnd ? '~' + project.periodEnd : '')
        : ''
    );
    return {
      agency: project.agency || '',
      title: U.joinCaption(project.projectName || '', project.docTitle || ''),
      period: period,
      vendor: project.vendor ? '施工廠商：' + project.vendor : ''
    };
  };

  g.Layout = Layout;
})(window);
