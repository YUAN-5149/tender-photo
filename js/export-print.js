/* 預覽 / 匯出 PDF —— 以 A4 列印版面重現 Word 排版，交由瀏覽器「另存為 PDF」 */
(function (g) {
  'use strict';

  const P = {};
  let urls = [];

  function objUrl(blob) {
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  }

  P.revoke = function () {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  };

  function headerHtml(project) {
    const h = Layout.headerLines(project);
    return '' +
      '<div class="pg-head">' +
      '<div class="pg-agency">' + U.esc(h.agency) + '</div>' +
      '<div class="pg-title"><span class="pg-title-main">' + U.esc(project.projectName || '') + '</span>' +
      (project.docTitle ? ' <span class="pg-title-sub">' + U.esc(project.docTitle) + '</span>' : '') + '</div>' +
      '<div class="pg-line">' + U.esc(h.period) + '</div>' +
      '<div class="pg-line">' + U.esc(h.vendor) + '</div>' +
      '</div>';
  }

  function pageHtml(project, page, idx) {
    let rows = '';
    page.rows.forEach((r) => {
      rows += '<tr class="cap-row">' + r.cells.map((c) =>
        '<td>' + U.esc(c.caption) + '</td>').join('') + '</tr>';
      rows += '<tr class="img-row">' + r.cells.map((c) =>
        '<td>' + (c.photo ? '<img src="' + objUrl(c.photo.blob) + '" alt="">' : '') + '</td>').join('') + '</tr>';
    });
    return '<section class="page" data-page="' + (idx + 1) + '">' +
      headerHtml(project) +
      '<table class="photo-grid">' + rows + '</table>' +
      '</section>';
  }

  /** 產生所有頁面 HTML（會建立 objectURL，用完請呼叫 P.revoke()） */
  P.render = function (project, photos) {
    P.revoke();
    const pages = Layout.build(project, photos);
    if (!pages.length) {
      return '<section class="page"><div class="empty-page">尚無可輸出的照片</div></section>';
    }
    return pages.map((pg, i) => pageHtml(project, pg, i)).join('');
  };

  /** 列印（使用者於列印對話框選「另存為 PDF」） */
  P.print = function (project, photos) {
    const root = document.getElementById('print-root');
    root.innerHTML = P.render(project, photos);
    document.body.classList.add('printing');

    const imgs = U.$$('img', root);
    const ready = Promise.all(imgs.map((im) => im.complete ? Promise.resolve()
      : new Promise((res) => { im.onload = im.onerror = res; })));

    return ready.then(() => new Promise((res) => setTimeout(res, 120))).then(() => {
      const after = () => {
        document.body.classList.remove('printing');
        window.removeEventListener('afterprint', after);
        setTimeout(() => { root.innerHTML = ''; P.revoke(); }, 500);
      };
      window.addEventListener('afterprint', after);
      window.print();
      setTimeout(() => { if (document.body.classList.contains('printing')) after(); }, 60000);
    });
  };

  g.ExportPrint = P;
})(window);
