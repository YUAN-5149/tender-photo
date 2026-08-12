/* 匯出 Word(.docx) —— 版面完全對齊委辦單位既有施工照範本 ---------------- */
(function (g) {
  'use strict';

  const D = docx;

  /* 範本量測值（單位：twips / px@96dpi） */
  const PAGE = { w: 11906, h: 16838 };                       // A4 直式
  const MARGIN = { top: 851, right: 1134, bottom: 851, left: 1134, header: 851, footer: 567 };
  const CELL_W = 4927;                                       // 每欄寬
  const ROW_CAPTION_H = 284;                                 // 標題列高
  const ROW_PHOTO_H = 3686;                                  // 照片列高
  const ROW_PHOTO_H_LAST = 3575;                             // 末列略矮
  const IMG_BOX = { w: 313.07, h: 235.40 };                  // 照片方框（4:3）
  const FONT = '標楷體';

  const Exp = {};

  function run(text, opts) {
    return new D.TextRun(Object.assign({ text: text || '', font: FONT }, opts || {}));
  }

  function headerParagraphs(project) {
    const h = Layout.headerLines(project);
    const spacing = { line: 480, lineRule: D.LineRuleType.AT_LEAST };
    const ps = [];

    ps.push(new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: spacing,
      children: [run(h.agency, { bold: true, size: 52, underline: { type: D.UnderlineType.SINGLE } })]
    }));

    ps.push(new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: spacing,
      children: [
        run(project.projectName || '', { size: 32 }),
        run(project.docTitle ? ' ' + project.docTitle : '', { size: 30 })
      ]
    }));

    ps.push(new D.Paragraph({ spacing: spacing, children: [run(h.period, { size: 24 })] }));
    ps.push(new D.Paragraph({ spacing: spacing, children: [run(h.vendor, { size: 24 })] }));
    return ps;
  }

  function captionCell(text) {
    return new D.TableCell({
      width: { size: CELL_W, type: D.WidthType.DXA },
      children: [new D.Paragraph({ children: [run(text, { size: 24 })] })]
    });
  }

  // 依原始長寬比縮放到不超過方框
  function fit(photo) {
    if (!photo || !photo.w || !photo.h) return { width: IMG_BOX.w, height: IMG_BOX.h };
    const s = Math.min(IMG_BOX.w / photo.w, IMG_BOX.h / photo.h);
    return { width: photo.w * s, height: photo.h * s };
  }

  function photoCell(photo, bytes) {
    const children = [];
    if (photo && bytes) {
      children.push(new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        children: [new D.ImageRun({ type: 'jpg', data: bytes, transformation: fit(photo) })]
      }));
    } else {
      children.push(new D.Paragraph({ children: [] }));
    }
    return new D.TableCell({
      width: { size: CELL_W, type: D.WidthType.DXA },
      verticalAlign: D.VerticalAlign.CENTER,
      children: children
    });
  }

  function pageTable(page, blobMap) {
    const rows = [];
    page.rows.forEach((r, ri) => {
      rows.push(new D.TableRow({
        height: { value: ROW_CAPTION_H, rule: D.HeightRule.AT_LEAST },
        children: r.cells.map((c) => captionCell(c.caption))
      }));
      rows.push(new D.TableRow({
        height: { value: ri === page.rows.length - 1 ? ROW_PHOTO_H_LAST : ROW_PHOTO_H, rule: D.HeightRule.AT_LEAST },
        children: r.cells.map((c) => photoCell(c.photo, c.photo ? blobMap[c.photo.id] : null))
      }));
    });

    const b = { style: D.BorderStyle.SINGLE, size: 4, color: 'auto' };
    return new D.Table({
      layout: D.TableLayoutType.FIXED,
      columnWidths: [CELL_W, CELL_W],
      borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
      rows: rows
    });
  }

  /**
   * @param project 專案
   * @param photos  照片（含 blob）
   * @param onProgress (done, total, message)
   * @returns Promise<Blob>
   */
  Exp.build = function (project, photos, onProgress) {
    const pages = Layout.build(project, photos);
    const used = {};
    pages.forEach((p) => p.rows.forEach((r) => r.cells.forEach((c) => { if (c.photo) used[c.photo.id] = c.photo; })));
    const ids = Object.keys(used);

    let done = 0;
    const blobMap = {};
    const chain = ids.reduce((prev, id) => prev.then(() => U.blobToArrayBuffer(used[id].blob).then((buf) => {
      blobMap[id] = new Uint8Array(buf);
      done++;
      if (onProgress) onProgress(done, ids.length, '讀取照片 ' + done + '/' + ids.length);
    })), Promise.resolve());

    return chain.then(() => {
      if (onProgress) onProgress(ids.length, ids.length, '組版中…');

      const children = [];
      pages.forEach((page, i) => {
        children.push(pageTable(page, blobMap));
        if (i < pages.length - 1) {
          children.push(new D.Paragraph({ children: [] }));
          children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
        }
      });
      if (!pages.length) children.push(new D.Paragraph({ children: [run('（尚無照片）', { size: 24 })] }));

      const doc = new D.Document({
        styles: { default: { document: { run: { font: FONT, size: 24 } } } },
        sections: [{
          properties: {
            page: {
              size: { width: PAGE.w, height: PAGE.h, orientation: D.PageOrientation.PORTRAIT },
              margin: MARGIN
            }
          },
          headers: { default: new D.Header({ children: headerParagraphs(project) }) },
          children: children
        }]
      });

      return D.Packer.toBlob(doc);
    });
  };

  Exp.filename = function (project) {
    const d = U.toRoc(new Date());
    return U.safeName(d + '-' + (project.agency || '工程') + '-' + (project.docTitle || '施工照')) + '.docx';
  };

  g.ExportDocx = Exp;
})(window);
