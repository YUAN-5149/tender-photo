/* 主程式：畫面與流程控制 -------------------------------------------------- */
(function (g) {
  'use strict';

  const state = {
    project: null,
    photos: [],
    capture: { areaId: '', itemId: '', stage: '' },
    selection: new Set(),
    view: 'shoot'
  };
  g.state = state;

  /* ===== 共用 UI ===== */
  function toast(msg, kind) {
    const t = U.el('div', { class: 'toast ' + (kind || ''), text: msg });
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }
  g.toast = toast;

  const busy = {
    show(msg) {
      U.$('#busy-msg').textContent = msg || '處理中…';
      U.$('#busy-bar').style.width = '0%';
      U.$('#busy').classList.add('on');
    },
    progress(done, total, msg) {
      const pct = total ? Math.min(100, (done / total) * 100) : 0;
      U.$('#busy-bar').style.width = pct + '%';
      if (msg) U.$('#busy-msg').textContent = msg;
    },
    hide() { U.$('#busy').classList.remove('on'); }
  };

  function confirmBox(msg) { return window.confirm(msg); }

  /* ===== 專案存取 ===== */
  function save() { return Store.saveProject(state.project); }

  const debouncedSave = (function () {
    let t;
    return function () { clearTimeout(t); t = setTimeout(save, 400); };
  })();

  function loadProject(id) {
    return Store.getProject(id).then((p) => {
      if (!p) return null;
      const changed = Store.migrate(p);
      state.project = p;
      Store.setCurrentId(p.id);
      return (changed ? Store.saveProject(p) : Promise.resolve(p))
        .then(() => Store.listPhotos(p.id))
        .then((ps) => { state.photos = ps; return p; });
    });
  }

  function createProject(seed) {
    const p = Store.newProject(seed);
    return Store.saveProject(p).then(() => loadProject(p.id));
  }

  /* ===== 名稱查詢 ===== */
  const areaName = (id) => (state.project.areas.find((a) => a.id === id) || {}).name || '';
  const itemOf = (id) => state.project.items.find((i) => i.id === id) || null;
  const itemName = (id) => (itemOf(id) || {}).name || '';

  /* ===== 檢視切換 ===== */
  function setView(v) {
    state.view = v;
    U.$$('.view').forEach((n) => n.classList.toggle('on', n.id === 'view-' + v));
    U.$$('.nav-btn').forEach((n) => n.classList.toggle('on', n.dataset.view === v));
    render();
    window.scrollTo(0, 0);
  }
  g.setView = setView;

  function render() {
    if (!state.project) return;
    if (state.view === 'project') renderProject();
    if (state.view === 'setup') renderSetup();
    if (state.view === 'shoot') renderShoot();
    if (state.view === 'export') renderExport();
    U.$('#badge-count').textContent = state.photos.length;
  }
  g.render = render;

  /* ===== 1. 專案設定 ===== */
  function renderProject() {
    const p = state.project;
    const f = (id, val) => { const n = U.$('#' + id); if (n && n.value !== val) n.value = val == null ? '' : val; };
    f('f-agency', p.agency);
    f('f-projectName', p.projectName);
    f('f-docTitle', p.docTitle);
    f('f-periodStart', U.anyToIso(p.periodStart));
    f('f-periodEnd', U.anyToIso(p.periodEnd));
    f('f-vendor', p.vendor);
    renderPeriodReadout();
    U.$('#f-wm-enabled').checked = !!p.watermark.enabled;
    U.$('#f-wm-format').value = p.watermark.dateFormat;
    U.$('#f-wm-label').checked = !!p.watermark.showLabel;
    U.$('#f-maxEdge').value = String(p.maxEdge);
    U.$('#f-wm-datemode').value = p.watermark.dateMode || 'exif';
    f('f-wm-fixeddate', U.anyToIso(p.watermark.fixedDate));
    renderDateMode();

    // 頁首即時預覽
    const h = Layout.headerLines(p);
    U.$('#head-preview').innerHTML =
      '<div class="hp-agency">' + U.esc(h.agency || '（機關／學校名稱）') + '</div>' +
      '<div class="hp-title">' + U.esc(h.title || '（工程名稱 施工照）') + '</div>' +
      '<div class="hp-line">' + U.esc(h.period || '工程期限：') + '</div>' +
      '<div class="hp-line">' + U.esc(h.vendor || '施工廠商：') + '</div>';

    renderProjectList();
  }

  /* 照片浮水印的日期來源 ------------------------------------------------
     exif  = 每張照片各自的拍攝日期（相簿舊照片會各不相同）
     fixed = 全部蓋同一個指定日期                                        */
  function effectiveDate(project) {
    const wm = project.watermark;
    if (wm.dateMode === 'fixed') {
      const d = U.parseRocInput(wm.fixedDate);
      if (d) return d;
    }
    return null;                     // null 代表沿用各張照片的拍攝日期
  }

  function stampPreview(project, d) {
    const fmt = project.watermark.dateFormat === 'ROC' ? U.toRoc : U.toAd;
    return fmt(d);
  }

  function renderDateMode() {
    const p = state.project;
    const fixed = p.watermark.dateMode === 'fixed';
    U.$('#fixed-date-field').style.display = fixed ? '' : 'none';

    const d = effectiveDate(p);
    U.$('#fixed-date-readout').innerHTML = fixed
      ? (d ? '<span class="pr-roc">照片將蓋上 ' + U.esc(stampPreview(p, d)) + '</span>'
           : '<span class="pr-warn">尚未選擇日期，將暫時沿用各張拍攝日期</span>')
      : '';
    U.$('#fixed-date-readout').className = 'period-readout' + (fixed ? ' on' : '') + (fixed && !d ? ' bad' : '');

    U.$('#datemode-hint').textContent = fixed
      ? '所有新拍或匯入的照片都會蓋上同一個日期，不受照片本身拍攝時間影響。'
      : '讀取照片的 EXIF DateTimeOriginal 欄位。從相簿匯入不同天拍的舊照片，日期會各不相同；'
        + '經通訊軟體轉傳或截圖的照片常已無 EXIF，會改採檔案時間並於匯入後提醒。';
  }

  /* 日曆選的是西元，公文用的是民國 —— 選完即時換算給使用者確認 */
  function renderPeriodReadout() {
    const p = state.project;
    const box = U.$('#period-readout');
    const s = U.anyToRoc(p.periodStart);
    const e = U.anyToRoc(p.periodEnd);

    if (!s && !e) {
      box.className = 'period-readout';
      box.innerHTML = '<span class="pr-hint">選擇日期後，這裡會顯示公文用的民國日期</span>';
      return;
    }

    const days = U.daysInclusive(p.periodStart, p.periodEnd);
    const reversed = days !== null && days < 1;
    box.className = 'period-readout on' + (reversed ? ' bad' : '');
    box.innerHTML =
      '<span class="pr-roc">工程期限：' + U.esc(s || '—') + (e ? '~' + U.esc(e) : '') + '</span>' +
      (reversed
        ? '<span class="pr-warn">訖日早於起日，請重新選擇</span>'
        : (days !== null ? '<span class="pr-days">工期 ' + days + ' 天</span>' : ''));
  }

  function renderProjectList() {
    Store.listProjects().then((list) => {
      const box = U.$('#project-list');
      box.innerHTML = '';
      list.forEach((p) => {
        const cur = p.id === state.project.id;
        const row = U.el('div', { class: 'prj-row' + (cur ? ' cur' : '') }, [
          U.el('div', { class: 'prj-main' }, [
            U.el('div', { class: 'prj-name', text: p.agency || '（未命名專案）' }),
            U.el('div', { class: 'prj-sub', text: (p.projectName || '') + ' · ' + new Date(p.updatedAt).toLocaleDateString('zh-TW') })
          ]),
          cur ? U.el('span', { class: 'tag', text: '使用中' })
            : U.el('button', {
              class: 'btn tiny', text: '切換',
              onclick: () => loadProject(p.id).then(() => { toast('已切換專案'); render(); })
            }),
          U.el('button', {
            class: 'btn tiny danger', text: '刪除',
            onclick: () => {
              if (!confirmBox('刪除專案「' + (p.agency || '未命名') + '」及其所有照片？此動作無法復原。')) return;
              Store.deleteProject(p.id).then(() => {
                if (p.id === state.project.id) return bootstrap();
                renderProjectList();
              }).then(() => toast('已刪除'));
            }
          })
        ]);
        box.appendChild(row);
      });
    });
  }

  function bindProjectForm() {
    const map = {
      'f-agency': 'agency', 'f-projectName': 'projectName', 'f-docTitle': 'docTitle',
      'f-periodStart': 'periodStart', 'f-periodEnd': 'periodEnd', 'f-vendor': 'vendor'
    };
    Object.keys(map).forEach((id) => {
      U.$('#' + id).addEventListener('input', (e) => {
        state.project[map[id]] = e.target.value;
        debouncedSave();
        renderProject();
      });
    });
    U.$('#f-wm-enabled').addEventListener('change', (e) => { state.project.watermark.enabled = e.target.checked; debouncedSave(); });
    U.$('#f-wm-format').addEventListener('change', (e) => { state.project.watermark.dateFormat = e.target.value; debouncedSave(); });
    U.$('#f-wm-label').addEventListener('change', (e) => { state.project.watermark.showLabel = e.target.checked; debouncedSave(); });
    U.$('#f-wm-datemode').addEventListener('change', (e) => {
      const wm = state.project.watermark;
      wm.dateMode = e.target.value;
      if (wm.dateMode === 'fixed' && !wm.fixedDate) wm.fixedDate = U.toIso(new Date());
      save().then(renderProject);
    });
    U.$('#f-wm-fixeddate').addEventListener('input', (e) => {
      state.project.watermark.fixedDate = e.target.value;
      debouncedSave();
      renderDateMode();
    });
    U.$('#f-maxEdge').addEventListener('change', (e) => { state.project.maxEdge = +e.target.value; debouncedSave(); });
    U.$('#btn-new-project').addEventListener('click', () => {
      if (!confirmBox('建立新專案？目前專案會保留在清單中。')) return;
      createProject().then(() => { toast('已建立新專案'); render(); });
    });
  }

  /* ===== 2. 工項與區域 ===== */
  function renderSetup() {
    const p = state.project;

    const areaBox = U.$('#area-list');
    areaBox.innerHTML = '';
    p.areas.forEach((a, idx) => areaBox.appendChild(rowEditor(a.name, '例：3 樓 301 教室', (v) => {
      a.name = v; debouncedSave();
    }, () => {
      p.areas.splice(idx, 1); save().then(render);
    }, idx, p.areas)));
    if (!p.areas.length) areaBox.appendChild(U.el('div', { class: 'hint', text: '尚未建立位置區域。未建立時照片仍可拍攝，僅無法依區域分類。' }));

    const itemBox = U.$('#item-list');
    itemBox.innerHTML = '';
    p.items.forEach((it, idx) => {
      const sel = U.el('select', { class: 'inp stage-sel', onchange: (e) => { it.stageSet = e.target.value; save().then(render); } });
      Object.keys(Store.STAGE_SETS).forEach((k) => {
        sel.appendChild(U.el('option', { value: k, text: Store.STAGE_SETS[k].label, selected: it.stageSet === k ? 'selected' : null }));
      });
      const row = U.el('div', { class: 'edit-row' }, [
        U.el('input', {
          class: 'inp', value: it.name, placeholder: '工項名稱',
          oninput: (e) => { it.name = e.target.value; debouncedSave(); }
        }),
        sel,
        U.el('div', { class: 'row-ops' }, [
          U.el('button', { class: 'btn tiny', text: '↑', onclick: () => { U.move(p.items, idx, idx - 1); save().then(render); } }),
          U.el('button', { class: 'btn tiny', text: '↓', onclick: () => { U.move(p.items, idx, idx + 1); save().then(render); } }),
          U.el('button', {
            class: 'btn tiny danger', text: '刪除',
            onclick: () => {
              const n = state.photos.filter((x) => x.itemId === it.id).length;
              if (n && !confirmBox('此工項已有 ' + n + ' 張照片，刪除後照片將變為未分類。確定？')) return;
              p.items.splice(idx, 1); save().then(render);
            }
          })
        ])
      ]);
      itemBox.appendChild(row);
    });
    if (!p.items.length) itemBox.appendChild(U.el('div', { class: 'hint', text: '尚未建立工項，可從下方範本一鍵載入。' }));

    const preBox = U.$('#preset-list');
    if (!preBox.dataset.done) {
      PRESETS.forEach((pre) => {
        preBox.appendChild(U.el('button', {
          class: 'btn ghost preset-btn',
          onclick: () => {
            if (!confirmBox('載入範本「' + pre.name + '」？將附加 ' + pre.items.length + ' 個工項。')) return;
            pre.items.forEach(([n, s]) => {
              if (!p.items.some((x) => x.name === n)) p.items.push(Store.newItem(n, s));
            });
            save().then(render).then(() => toast('已載入 ' + pre.items.length + ' 個工項'));
          }
        }, [U.el('strong', { text: pre.name }), U.el('small', { text: pre.note })]));
      });
      preBox.dataset.done = '1';
    }
  }

  function rowEditor(value, placeholder, onInput, onDelete, idx, arr) {
    return U.el('div', { class: 'edit-row' }, [
      U.el('input', { class: 'inp', value: value, placeholder: placeholder, oninput: (e) => onInput(e.target.value) }),
      U.el('div', { class: 'row-ops' }, [
        U.el('button', { class: 'btn tiny', text: '↑', onclick: () => { U.move(arr, idx, idx - 1); save().then(render); } }),
        U.el('button', { class: 'btn tiny', text: '↓', onclick: () => { U.move(arr, idx, idx + 1); save().then(render); } }),
        U.el('button', { class: 'btn tiny danger', text: '刪除', onclick: onDelete })
      ])
    ]);
  }

  function bindSetup() {
    U.$('#btn-add-area').addEventListener('click', () => {
      state.project.areas.push(Store.newArea(''));
      save().then(render);
    });
    U.$('#btn-add-item').addEventListener('click', () => {
      state.project.items.push(Store.newItem(''));
      save().then(render);
    });
    U.$('#btn-bulk-area').addEventListener('click', () => {
      const txt = window.prompt('每行一個位置區域，例如：\n1F 走廊\n2F 201 教室\n2F 202 教室');
      if (!txt) return;
      txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((n) => {
        if (!state.project.areas.some((a) => a.name === n)) state.project.areas.push(Store.newArea(n));
      });
      save().then(render);
    });
    U.$('#btn-bulk-item').addEventListener('click', () => {
      const txt = window.prompt('每行一個工項名稱');
      if (!txt) return;
      txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((n) => {
        if (!state.project.items.some((a) => a.name === n)) state.project.items.push(Store.newItem(n));
      });
      save().then(render);
    });
  }

  /* ===== 3. 拍照 ===== */
  function currentStages() {
    const it = itemOf(state.capture.itemId);
    return Store.stagesOf(it);
  }

  function renderShoot() {
    const p = state.project;
    const c = state.capture;

    // 白板：目前設定
    U.$('#board-agency').textContent = p.agency || '（未填機關名稱）';
    U.$('#board-caption').textContent = U.joinCaption(
      c.areaId ? areaName(c.areaId) : '', itemName(c.itemId) || '（未選工項）', c.stage
    );
    const fixedDate = effectiveDate(p);
    U.$('#board-date').textContent = fixedDate ? stampPreview(p, fixedDate) : '日期取自各張照片的 EXIF 拍攝時間';
    U.$('#board-date').classList.toggle('auto', !fixedDate);

    chips('#chips-area', p.areas.map((a) => ({ id: a.id, name: a.name || '（未命名）' })), c.areaId, (id) => {
      c.areaId = c.areaId === id ? '' : id; renderShoot();
    }, '尚未建立區域');

    chips('#chips-item', p.items.map((i) => ({ id: i.id, name: i.name || '（未命名）' })), c.itemId, (id) => {
      c.itemId = c.itemId === id ? '' : id;
      const st = currentStages();
      if (st.indexOf(c.stage) < 0) c.stage = st[0];
      renderShoot();
    }, '尚未建立工項');

    const st = currentStages();
    chips('#chips-stage', st.map((s) => ({ id: s, name: s || '不分階段' })), c.stage, (id) => {
      c.stage = id; renderShoot();
    }, '');

    const mode = p.watermark.dateMode || 'exif';
    chips('#chips-datemode', [
      { id: 'exif', name: 'EXIF 拍攝時間' },
      { id: 'fixed', name: '指定日期' }
    ], mode, (id) => {
      const wm = p.watermark;
      wm.dateMode = id;
      if (id === 'fixed' && !wm.fixedDate) wm.fixedDate = U.toIso(new Date());
      save().then(renderShoot);
    }, '');

    const dateInput = U.$('#f-shot-date');
    dateInput.style.display = mode === 'fixed' ? '' : 'none';
    const iso = U.anyToIso(p.watermark.fixedDate);
    if (dateInput.value !== iso) dateInput.value = iso;

    renderGallery();
  }

  function chips(sel, list, active, onPick, emptyText) {
    const box = U.$(sel);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(U.el('span', { class: 'hint', text: emptyText || '—' }));
      return;
    }
    list.forEach((x) => {
      box.appendChild(U.el('button', {
        class: 'chip' + (x.id === active ? ' on' : ''),
        text: x.name,
        onclick: () => onPick(x.id)
      }));
    });
  }

  function filteredPhotos() {
    const f = U.$('#gal-filter').value;
    if (f === 'current') {
      return state.photos.filter((p) =>
        (!state.capture.itemId || p.itemId === state.capture.itemId) &&
        (!state.capture.areaId || p.areaId === state.capture.areaId));
    }
    if (f === 'unassigned') return state.photos.filter((p) => !p.itemId);
    return state.photos;
  }

  function renderGallery() {
    const box = U.$('#gallery');
    const list = filteredPhotos();
    box.innerHTML = '';
    U.$('#gal-count').textContent = list.length + ' 張';

    if (!list.length) {
      box.appendChild(U.el('div', { class: 'hint pad', text: '尚無照片，按下方相機按鈕開始拍攝。' }));
      return;
    }
    list.forEach((ph) => {
      const cap = U.joinCaption(state.project.captionWithArea ? areaName(ph.areaId) : '', itemName(ph.itemId), ph.stage);
      const cell = U.el('figure', {
        class: 'ph' + (state.selection.has(ph.id) ? ' sel' : ''),
        onclick: (e) => {
          if (state.selection.size) { toggleSel(ph.id); return; }
          openEditor(ph.id);
        }
      }, [
        U.el('img', { src: ph.thumb, alt: cap, loading: 'lazy' }),
        U.el('figcaption', { text: cap || '未分類' }),
        U.el('button', {
          class: 'ph-sel', text: '✓',
          onclick: (e) => { e.stopPropagation(); toggleSel(ph.id); }
        })
      ]);
      box.appendChild(cell);
    });
    U.$('#bulk-bar').classList.toggle('on', state.selection.size > 0);
    U.$('#bulk-count').textContent = state.selection.size;
  }

  function toggleSel(id) {
    if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
    renderGallery();
  }

  /* --- 匯入照片 ---
     以佇列串接，避免使用者在處理途中切換工項導致標籤錯置或序號重複 */
  let importQueue = Promise.resolve();

  function importFiles(files) {
    const arr = Array.prototype.slice.call(files || []).filter((f) => /^image\//.test(f.type));
    if (!arr.length) return importQueue;
    // 按下快門當下的歸類與日期設定，之後切換 chips 不影響這批照片
    const shot = {
      areaId: state.capture.areaId,
      itemId: state.capture.itemId,
      stage: state.capture.stage,
      date: effectiveDate(state.project)   // null = 沿用各張拍攝日期
    };
    importQueue = importQueue.then(() => runImport(arr, shot));
    return importQueue;
  }

  function runImport(arr, shot) {
    const p = state.project;
    busy.show('處理照片 0/' + arr.length);
    let seq = state.photos.reduce((m, x) => Math.max(m, x.seq || 0), 0);
    let noExif = 0;
    const label = U.joinCaption(shot.areaId ? areaName(shot.areaId) : '', itemName(shot.itemId), shot.stage);

    return arr.reduce((chain, file, i) => chain.then(() => {
      return Img.process(file, {
        maxEdge: p.maxEdge, quality: p.quality,
        watermark: p.watermark, label: label,
        date: shot.date || undefined
      }).then((out) => {
        const rec = {
          id: U.uid('ph'), projectId: p.id,
          blob: out.blob, thumb: out.thumb, w: out.w, h: out.h, size: out.size,
          areaId: shot.areaId || '', itemId: shot.itemId || '', stage: shot.stage || '',
          note: '', takenAt: out.takenAt, dateSource: out.dateSource,
          seq: ++seq, createdAt: Date.now()
        };
        if (out.dateSource !== 'exif' && out.dateSource !== 'fixed') noExif++;
        return Store.savePhoto(rec).then(() => { state.photos.push(rec); });
      }).catch((e) => {
        console.error(e); toast('照片處理失敗：' + file.name, 'err');
      }).then(() => busy.progress(i + 1, arr.length, '處理照片 ' + (i + 1) + '/' + arr.length));
    }), Promise.resolve()).then(() => {
      busy.hide();
      if (noExif) {
        toast(noExif + ' 張照片沒有 EXIF 拍攝時間，已改用檔案時間，請確認日期', 'err');
      } else {
        toast('已加入 ' + arr.length + ' 張照片');
      }
      render();
    });
  }

  /* --- 單張編輯 --- */
  let editingId = null;
  function openEditor(id) {
    const ph = state.photos.find((x) => x.id === id);
    if (!ph) return;
    editingId = id;
    const p = state.project;

    U.$('#ed-img').src = URL.createObjectURL(ph.blob);
    const SRC = { exif: 'EXIF 拍攝時間', fixed: '指定日期', file: '檔案時間（無 EXIF）', now: '匯入時間（無 EXIF）' };
    const src = SRC[ph.dateSource] || '拍攝時間';
    U.$('#ed-meta').innerHTML = U.esc(ph.w + '×' + ph.h + ' · ' + U.bytes(ph.size)) +
      '<br><b>' + U.esc(U.toRoc(ph.takenAt || ph.createdAt)) + '</b>　' +
      '<span class="' + (ph.dateSource === 'file' || ph.dateSource === 'now' ? 'src-warn' : 'src-ok') + '">' +
      U.esc(src) + '</span>';

    const selArea = U.$('#ed-area');
    selArea.innerHTML = '<option value="">（未指定區域）</option>';
    p.areas.forEach((a) => selArea.appendChild(U.el('option', { value: a.id, text: a.name || '（未命名）' })));
    selArea.value = ph.areaId || '';

    const selItem = U.$('#ed-item');
    selItem.innerHTML = '<option value="">（未分類）</option>';
    p.items.forEach((i) => selItem.appendChild(U.el('option', { value: i.id, text: i.name || '（未命名）' })));
    selItem.value = ph.itemId || '';

    fillStageSelect(ph.itemId, ph.stage);
    U.$('#ed-note').value = ph.note || '';
    U.$('#editor').classList.add('on');
  }

  function fillStageSelect(itemId, cur) {
    const sel = U.$('#ed-stage');
    sel.innerHTML = '';
    Store.stagesOf(itemOf(itemId)).forEach((s) => sel.appendChild(U.el('option', { value: s, text: s || '不分階段' })));
    sel.value = cur || sel.options[0].value;
  }

  function closeEditor() {
    U.$('#editor').classList.remove('on');
    const im = U.$('#ed-img');
    if (im.src.startsWith('blob:')) URL.revokeObjectURL(im.src);
    editingId = null;
  }

  function bindShoot() {
    U.$('#file-camera').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
    U.$('#file-album').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
    U.$('#gal-filter').addEventListener('change', renderGallery);
    U.$('#f-shot-date').addEventListener('input', (e) => {
      state.project.watermark.fixedDate = e.target.value;
      debouncedSave();
      renderShoot();
    });

    U.$('#btn-clear-sel').addEventListener('click', () => { state.selection.clear(); renderGallery(); });
    U.$('#btn-bulk-assign').addEventListener('click', () => {
      const c = state.capture;
      if (!c.itemId) { toast('請先於上方選擇工項', 'err'); return; }
      const ids = Array.from(state.selection);
      Promise.all(ids.map((id) => {
        const ph = state.photos.find((x) => x.id === id);
        ph.areaId = c.areaId || ''; ph.itemId = c.itemId; ph.stage = c.stage || '';
        return Store.savePhoto(ph);
      })).then(() => { state.selection.clear(); toast('已套用至 ' + ids.length + ' 張'); render(); });
    });
    U.$('#btn-bulk-delete').addEventListener('click', () => {
      const ids = Array.from(state.selection);
      if (!confirmBox('刪除選取的 ' + ids.length + ' 張照片？')) return;
      Promise.all(ids.map((id) => Store.deletePhoto(id))).then(() => {
        state.photos = state.photos.filter((x) => !state.selection.has(x.id));
        state.selection.clear(); toast('已刪除'); render();
      });
    });

    U.$('#ed-item').addEventListener('change', (e) => fillStageSelect(e.target.value, ''));
    U.$('#ed-close').addEventListener('click', closeEditor);
    U.$('#ed-save').addEventListener('click', () => {
      const ph = state.photos.find((x) => x.id === editingId);
      if (!ph) return closeEditor();
      ph.areaId = U.$('#ed-area').value;
      ph.itemId = U.$('#ed-item').value;
      ph.stage = U.$('#ed-stage').value;
      ph.note = U.$('#ed-note').value.trim();
      Store.savePhoto(ph).then(() => { closeEditor(); toast('已更新'); render(); });
    });
    U.$('#ed-delete').addEventListener('click', () => {
      if (!confirmBox('刪除這張照片？')) return;
      Store.deletePhoto(editingId).then(() => {
        state.photos = state.photos.filter((x) => x.id !== editingId);
        closeEditor(); toast('已刪除'); render();
      });
    });
  }

  /* ===== 4. 預覽與匯出 ===== */
  function renderExport() {
    const p = state.project;
    U.$('#f-layoutMode').value = p.layoutMode;
    U.$('#f-captionWithArea').checked = !!p.captionWithArea;
    U.$('#f-includeEmpty').checked = !!p.includeEmpty;
    U.$('#f-zipStructure').value = p.zipStructure || 'item';

    const s = Layout.stats(p, state.photos);
    U.$('#stat').innerHTML =
      '<b>' + s.photos + '</b> 張照片　→　<b>' + s.pages + '</b> 頁' +
      (s.used < s.photos ? '　<span class="warn">（' + (s.photos - s.used) + ' 張未編入，請確認工項設定）</span>' : '');

    const unassigned = state.photos.filter((x) => !x.itemId).length;
    U.$('#warn-unassigned').classList.toggle('on', unassigned > 0);
    U.$('#warn-unassigned').textContent = unassigned ? '有 ' + unassigned + ' 張照片尚未指定工項，將被歸入「其他」。' : '';
  }

  function renderPreview() {
    const box = U.$('#preview');
    box.innerHTML = ExportPrint.render(state.project, state.photos);
    box.classList.add('on');
    U.$('#btn-preview').textContent = '重新整理預覽';
  }

  function bindExport() {
    U.$('#f-layoutMode').addEventListener('change', (e) => { state.project.layoutMode = e.target.value; save().then(renderExport); });
    U.$('#f-captionWithArea').addEventListener('change', (e) => { state.project.captionWithArea = e.target.checked; save().then(renderExport); });
    U.$('#f-includeEmpty').addEventListener('change', (e) => { state.project.includeEmpty = e.target.checked; save().then(renderExport); });
    U.$('#f-zipStructure').addEventListener('change', (e) => { state.project.zipStructure = e.target.value; debouncedSave(); });

    U.$('#btn-preview').addEventListener('click', renderPreview);

    U.$('#btn-word').addEventListener('click', () => {
      busy.show('產生 Word…');
      ExportDocx.build(state.project, state.photos, busy.progress)
        .then((blob) => {
          U.downloadBlob(blob, ExportDocx.filename(state.project));
          busy.hide(); toast('Word 已下載（' + U.bytes(blob.size) + '）');
        })
        .catch((e) => { console.error(e); busy.hide(); toast('Word 產生失敗：' + e.message, 'err'); });
    });

    U.$('#btn-pdf').addEventListener('click', () => {
      busy.show('準備列印版面…');
      ExportPrint.print(state.project, state.photos)
        .then(() => busy.hide())
        .catch((e) => { console.error(e); busy.hide(); toast('列印失敗：' + e.message, 'err'); });
    });

    U.$('#btn-zip').addEventListener('click', () => {
      busy.show('打包 ZIP…');
      const withDocx = U.$('#f-zipWithDocx').checked;
      const pre = withDocx ? ExportDocx.build(state.project, state.photos, busy.progress) : Promise.resolve(null);
      pre.then((docxBlob) => ExportZip.build(state.project, state.photos, {
        includeDocx: docxBlob,
        structure: U.$('#f-zipStructure').value,
        onProgress: busy.progress
      })).then((blob) => {
        U.downloadBlob(blob, ExportZip.filename(state.project));
        busy.hide(); toast('ZIP 已下載（' + U.bytes(blob.size) + '）');
      }).catch((e) => { console.error(e); busy.hide(); toast('ZIP 產生失敗：' + e.message, 'err'); });
    });
  }

  /* ===== 啟動 ===== */
  function bindNav() {
    U.$$('.nav-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  }

  function bootstrap() {
    return Store.listProjects().then((list) => {
      const cur = Store.currentId();
      if (cur && list.some((p) => p.id === cur)) return loadProject(cur);
      if (list.length) return loadProject(list[0].id);
      return createProject({ agency: '', projectName: '', vendor: '' });
    }).then(() => {
      const st = currentStages();
      state.capture.stage = st[0];
      render();
    });
  }

  function init() {
    bindNav(); bindProjectForm(); bindSetup(); bindShoot(); bindExport();
    bootstrap().then(() => setView(state.project && state.project.items.length ? 'shoot' : 'project'));

    Store.estimate().then((e) => {
      if (e.quota) U.$('#storage').textContent = '本機已用 ' + U.bytes(e.usage) + ' / ' + U.bytes(e.quota);
    });

    registerSW();
  }

  /* Service Worker：偵測到新版本時提示重新載入，避免使用者停在舊程式 */
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

    U.$('#btn-update').addEventListener('click', () => location.reload());
    U.$('#btn-update-later').addEventListener('click', () => U.$('#update-bar').classList.remove('on'));

    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // 已有 controller 代表這是「更新」而非首次安裝
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            U.$('#update-bar').classList.add('on');
          }
        });
      });
      // 回到前景時主動檢查更新（現場常整天不關網頁）
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    }).catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
