/* 主程式：畫面與流程控制 -------------------------------------------------- */
(function (g) {
  'use strict';

  const state = {
    project: null,
    photos: [],
    capture: { areaId: '', itemId: '', stage: '' },
    selection: new Set(),
    sorting: { area: false, item: false },   // 拖移排序模式（不寫進專案）
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
    // 預覽在隱藏狀態下量不到寬度，切回來時重算一次縮放
    if (v === 'export') fitPreview();
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
    setDateField('f-periodStart', p.periodStart);
    setDateField('f-periodEnd', p.periodEnd);
    f('f-vendor', p.vendor);
    renderPeriodReadout();
    U.$('#f-wm-format').value = p.watermark.dateFormat;
    U.$('#f-wm-label').checked = !!p.watermark.showLabel;
    U.$('#f-maxEdge').value = String(p.maxEdge);
    U.$('#f-wm-datemode').value = p.watermark.dateMode || 'exif';
    setDateField('f-wm-fixeddate', p.watermark.fixedDate);
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
     fixed = 全部蓋同一個指定日期
     none  = 不蓋日期，照片保持原樣（takenAt 仍照常記錄，ZIP 檔名與 CSV 要用） */
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
    const mode = p.watermark.dateMode || 'exif';
    const fixed = mode === 'fixed';
    const none = mode === 'none';
    U.$('#fixed-date-field').style.display = fixed ? '' : 'none';

    // 不蓋任何字時，日期格式與左下角加註都失去意義，一併收起來免得誤會
    U.$('#wm-format-field').style.display = none ? 'none' : '';
    U.$('#wm-label-field').hidden = none;
    U.$('#wm-label-hint').hidden = none;

    const d = effectiveDate(p);
    U.$('#fixed-date-readout').innerHTML = fixed
      ? (d ? '<span class="pr-roc">照片將蓋上 ' + U.esc(stampPreview(p, d)) + '</span>'
           : '<span class="pr-warn">尚未選擇日期，將暫時沿用各張拍攝日期</span>')
      : '';
    U.$('#fixed-date-readout').className = 'period-readout' + (fixed ? ' on' : '') + (fixed && !d ? ' bad' : '');

    U.$('#datemode-hint').textContent = none
      ? '照片維持原本畫面，右下角日期與左下角工項都不會加上去。仍會依 EXIF 方向轉正並縮到上方設定的解析度；'
        + '拍攝日期照常記錄，ZIP 檔名與照片清單 CSV 仍看得到。'
      : fixed
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

  /* ===== 可鍵盤輸入的日期欄位 =========================================
     文字框可自由打 115.6.1 / 115/6/1 / 1150601 / 2026-06-01 等寫法，
     離開欄位或按 Enter 時自動正規化為民國格式 115.06.01；
     旁邊的 📅 按鈕開啟系統日曆，兩種輸入方式並存。
     onCommit 收到的是 ISO 字串（''＝清空），維持內部一律存 ISO。   */

  const dateFields = {};   // id → { set(iso) }

  function bindDateField(id, onCommit) {
    const input = U.$('#' + id);
    const cal = U.$('#' + id + '-cal');
    if (!input) return;

    const setText = (iso) => {
      const d = U.parseDateInput(iso);
      const txt = d ? U.toRoc(d) : '';
      if (input.value !== txt) input.value = txt;
      input.classList.remove('bad');
    };
    dateFields[id] = { set: setText };

    // 打字途中只做提示，不干擾輸入
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      input.classList.toggle('bad', !!raw && !U.parseDateInput(raw));
    });

    const commit = () => {
      const raw = input.value.trim();
      if (!raw) { input.classList.remove('bad'); onCommit(''); return; }
      const d = U.parseDateInput(raw);
      if (!d) { input.classList.add('bad'); return; }   // 保留原輸入讓使用者修正
      input.classList.remove('bad');
      input.value = U.toRoc(d);
      onCommit(U.toIso(d));
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    });

    if (cal) {
      cal.addEventListener('change', () => {
        if (!cal.value) return;
        const d = U.parseDateInput(cal.value);
        if (!d) return;
        input.value = U.toRoc(d);
        input.classList.remove('bad');
        onCommit(U.toIso(d));
      });
      const btn = U.$('.datefield-btn[data-date-for="' + id + '"]');
      if (btn) btn.addEventListener('click', () => {
        const d = U.parseDateInput(input.value) || new Date();
        cal.value = U.toIso(d);
        if (cal.showPicker) { try { cal.showPicker(); return; } catch (e) { /* 不支援就退回點擊 */ } }
        cal.focus(); cal.click();
      });
    }
  }

  const setDateField = (id, iso) => { if (dateFields[id]) dateFields[id].set(iso); };

  function bindProjectForm() {
    const map = {
      'f-agency': 'agency', 'f-projectName': 'projectName',
      'f-docTitle': 'docTitle', 'f-vendor': 'vendor'
    };
    Object.keys(map).forEach((id) => {
      U.$('#' + id).addEventListener('input', (e) => {
        state.project[map[id]] = e.target.value;
        debouncedSave();
        renderProject();
      });
    });
    bindDateField('f-periodStart', (iso) => {
      state.project.periodStart = iso; save().then(renderProject);
    });
    bindDateField('f-periodEnd', (iso) => {
      state.project.periodEnd = iso; save().then(renderProject);
    });
    bindDateField('f-wm-fixeddate', (iso) => {
      state.project.watermark.fixedDate = iso; save().then(renderProject);
    });

    U.$('#f-wm-format').addEventListener('change', (e) => { state.project.watermark.dateFormat = e.target.value; debouncedSave(); });
    U.$('#f-wm-label').addEventListener('change', (e) => { state.project.watermark.showLabel = e.target.checked; debouncedSave(); });
    U.$('#f-wm-datemode').addEventListener('change', (e) => {
      const wm = state.project.watermark;
      wm.dateMode = e.target.value;
      if (wm.dateMode === 'fixed' && !wm.fixedDate) wm.fixedDate = U.toIso(new Date());
      save().then(renderProject);
    });
    U.$('#f-maxEdge').addEventListener('change', (e) => { state.project.maxEdge = +e.target.value; debouncedSave(); });
    U.$('#btn-new-project').addEventListener('click', () => {
      if (!confirmBox('建立新專案？目前專案會保留在清單中。')) return;
      createProject().then(() => { toast('已建立新專案'); render(); });
    });
  }

  /* ===== 工項照片完成度 ==============================================
     依該工項的階段組合判定：
       無照片   —— 一張都還沒拍
       尚未完整 —— 有照片，但還有階段是空的
       已完成   —— 每個階段都至少有一張
     不分階段的工項只看有沒有照片。                                   */
  function itemPhotoStatus(item) {
    const stages = Store.stagesOf(item);
    const list = state.photos.filter((x) => x.itemId === item.id);
    const flat = stages.length === 1 && stages[0] === '';

    if (flat) {
      return {
        state: list.length ? 'full' : 'empty',
        done: list.length ? 1 : 0, need: 1, total: list.length, flat: true, missing: []
      };
    }
    const missing = stages.filter((s) => !list.some((x) => (x.stage || '') === s));
    return {
      state: !list.length ? 'empty' : (missing.length ? 'partial' : 'full'),
      done: stages.length - missing.length, need: stages.length,
      total: list.length, flat: false, missing: missing
    };
  }

  const STATE_LABEL = { full: '已完成', partial: '尚未完整', empty: '無照片' };

  function statusTitle(st) {
    return STATE_LABEL[st.state] + '：'
      + (st.total
        ? '共 ' + st.total + ' 張' + (st.missing.length ? '，缺 ' + st.missing.join('、') : '')
        : '尚未拍攝');
  }

  function statusBadge(item) {
    const st = itemPhotoStatus(item);
    const text = st.flat ? st.total + ' 張' : st.done + '/' + st.need;
    const title = statusTitle(st);
    return U.el('span', { class: 'ph-state ' + st.state, title: title, 'aria-label': title }, [
      U.el('i', { class: 'ph-dot', 'aria-hidden': 'true' }),
      U.el('b', { text: text })
    ]);
  }

  function renderItemLegend() {
    const box = U.$('#item-legend');
    if (!box) return;
    const p = state.project;
    if (!p.items.length) { box.innerHTML = ''; return; }

    const n = { full: 0, partial: 0, empty: 0 };
    p.items.forEach((it) => { n[itemPhotoStatus(it).state]++; });
    box.innerHTML = ['full', 'partial', 'empty'].map((k) =>
      '<span class="ph-state ' + k + '"><i class="ph-dot"></i>' +
      U.esc(STATE_LABEL[k]) + ' <b>' + n[k] + '</b></span>').join('');
  }

  /* ===== 2. 工項與區域 ===== */
  function renderSetup() {
    const p = state.project;

    const areaBox = U.$('#area-list');
    areaBox.innerHTML = '';
    p.areas.forEach((a, idx) => areaBox.appendChild(rowEditor(a, '例：3 樓 301 教室', (v) => {
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
      const row = U.el('div', { class: 'edit-row', 'data-id': it.id }, [
        U.el('input', {
          class: 'inp', value: it.name, placeholder: '工項名稱',
          oninput: (e) => { it.name = e.target.value; debouncedSave(); }
        }),
        sel,
        statusBadge(it),
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
        ]),
        dragHandle()          // 放最後：拖移模式下握把落在每列右側
      ]);
      itemBox.appendChild(row);
    });
    if (!p.items.length) itemBox.appendChild(U.el('div', { class: 'hint', text: '尚未建立工項，可從下方範本一鍵載入。' }));

    U.$('#area-count').textContent = p.areas.length ? '共 ' + p.areas.length + ' 區' : '';
    U.$('#item-count').textContent = p.items.length ? '共 ' + p.items.length + ' 項' : '';
    renderItemLegend();

    renderSortMode('area');
    renderSortMode('item');

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

  function rowEditor(obj, placeholder, onInput, onDelete, idx, arr) {
    return U.el('div', { class: 'edit-row', 'data-id': obj.id }, [
      U.el('input', { class: 'inp', value: obj.name, placeholder: placeholder, oninput: (e) => onInput(e.target.value) }),
      U.el('div', { class: 'row-ops' }, [
        U.el('button', { class: 'btn tiny', text: '↑', onclick: () => { U.move(arr, idx, idx - 1); save().then(render); } }),
        U.el('button', { class: 'btn tiny', text: '↓', onclick: () => { U.move(arr, idx, idx + 1); save().then(render); } }),
        U.el('button', { class: 'btn tiny danger', text: '刪除', onclick: onDelete })
      ]),
      dragHandle()            // 放最後：拖移模式下握把落在每列右側
    ]);
  }

  function dragHandle() {
    return U.el('span', { class: 'drag-handle', text: '⠿', title: '按住拖曳調整順序', 'aria-hidden': 'true' });
  }

  /* ---- 拖移排序 ----
     手機沒有 HTML5 drag & drop，改用 Pointer Events：拖曳時直接搬 DOM，
     放開才一次寫回陣列。每次搬完會把基準點補回位移量，畫面才不會跳。 */
  /* 標題旁與清單下方各有一組按鈕（長清單不必捲到底），
     以 data-sort / data-add 標記，兩組共用同一份狀態 */
  const SORT = {
    area: { box: '#area-list', btn: '[data-sort="area"]', arr: () => state.project.areas },
    item: { box: '#item-list', btn: '[data-sort="item"]', arr: () => state.project.items }
  };

  function renderSortMode(kind) {
    const cfg = SORT[kind];
    const on = state.sorting[kind];
    U.$(cfg.box).classList.toggle('sorting', on);
    U.$$(cfg.btn).forEach((btn) => {
      btn.classList.toggle('primary', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '🔒 鎖定' : '⇅ 手動拖移或刪除';
    });
  }

  function toggleSortMode(kind) {
    // 這個模式同時管排序與刪除，只有一列時也要能進去（否則刪不掉最後一列）
    if (!state.sorting[kind] && !(SORT[kind].arr() || []).length) {
      toast('尚未建立任何項目'); return;
    }
    state.sorting[kind] = !state.sorting[kind];
    renderSortMode(kind);
    if (!state.sorting[kind]) toast('已鎖定');
  }

  function bindSortable(kind) {
    const cfg = SORT[kind];
    const box = U.$(cfg.box);
    let drag = null;
    let raf = 0;

    const rows = () => U.$$('.edit-row', box);

    // 量測「若不套用 top 位移」時的位置，用來算 DOM 搬移造成的落差
    function baseTop(el) {
      const keep = el.style.top;
      el.style.top = '0px';
      const t = el.getBoundingClientRect().top;
      el.style.top = keep;
      return t;
    }

    function place(ref) {
      const before = baseTop(drag.el);
      box.insertBefore(drag.el, ref);
      drag.grabY += baseTop(drag.el) - before;
      drag.el.style.top = (drag.lastY - drag.grabY) + 'px';
    }

    function reorder() {
      const mid = drag.el.getBoundingClientRect();
      const c = mid.top + mid.height / 2;
      let ref = null;
      for (const s of rows()) {
        if (s === drag.el) continue;
        const r = s.getBoundingClientRect();
        if (c < r.top + r.height / 2) { ref = s; break; }
      }
      if (drag.el.nextElementSibling !== ref) place(ref);
    }

    // 手指停在畫面邊緣時持續捲動，長清單才拖得動
    function autoScroll() {
      raf = 0;
      if (!drag) return;
      const edge = 80;
      let dy = 0;
      if (drag.lastY < edge) dy = -Math.ceil((edge - drag.lastY) / 6);
      else if (drag.lastY > innerHeight - edge) dy = Math.ceil((drag.lastY - (innerHeight - edge)) / 6);
      if (dy) {
        const y0 = scrollY;
        scrollBy(0, dy);
        // 頁面捲動後元素的靜態位置也跟著移動，基準要補回來才會黏在手指上
        drag.grabY -= (scrollY - y0);
        drag.el.style.top = (drag.lastY - drag.grabY) + 'px';
        reorder();
      }
      raf = requestAnimationFrame(autoScroll);
    }

    function onMove(e) {
      if (!drag) return;
      e.preventDefault();
      drag.lastY = e.clientY;
      drag.el.style.top = (e.clientY - drag.grabY) + 'px';
      reorder();
    }

    function end() {
      if (!drag) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);

      drag.el.classList.remove('dragging');
      drag.el.style.top = '';
      box.classList.remove('is-dragging');
      drag = null;

      // DOM 是唯一真相，依畫面順序重排陣列（保留同一個陣列參照）
      const order = rows().map((r) => r.dataset.id);
      const arr = cfg.arr();
      const next = order.map((id) => arr.find((x) => x.id === id)).filter(Boolean);
      if (next.length === arr.length) {
        arr.length = 0;
        Array.prototype.push.apply(arr, next);
        save().then(render);
      } else {
        render();   // 對不起來就直接依陣列重畫，不動資料
      }
    }

    box.addEventListener('pointerdown', (e) => {
      if (!box.classList.contains('sorting')) return;
      const handle = e.target.closest && e.target.closest('.drag-handle');
      if (!handle) return;
      const el = handle.closest('.edit-row');
      if (!el) return;
      e.preventDefault();

      drag = { el: el, grabY: e.clientY, lastY: e.clientY };
      el.classList.add('dragging');
      box.classList.add('is-dragging');

      /* 監聽掛在 document 而非清單上：拖曳過程會用 insertBefore 搬動這一列，
         節點一被搬走 pointer capture 就失效，手指若停在清單外（例如蓋住頂列）
         放開時清單收不到 pointerup，順序就不會寫回去。 */
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
      raf = requestAnimationFrame(autoScroll);
    });
  }

  function bindSetup() {
    bindSortable('area');
    bindSortable('item');

    U.$$('[data-sort]').forEach((b) => {
      b.addEventListener('click', () => toggleSortMode(b.dataset.sort));
    });
    U.$$('[data-add]').forEach((b) => {
      b.addEventListener('click', () => {
        const kind = b.dataset.add;
        const arr = SORT[kind].arr();
        arr.push(kind === 'area' ? Store.newArea('') : Store.newItem(''));
        save().then(render).then(() => {
          // 從標題旁新增時新列在清單最下方，捲過去並聚焦，免得以為沒反應
          const rows = U.$$('.edit-row', U.$(SORT[kind].box));
          const last = rows[rows.length - 1];
          if (!last) return;
          last.scrollIntoView({ block: 'center' });
          const inp = U.$('.inp', last);
          if (inp) inp.focus();
        });
      });
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
    const mode = p.watermark.dateMode || 'exif';
    const fixedDate = effectiveDate(p);
    U.$('#board-date').textContent = mode === 'none'
      ? '不加日期浮水印，照片維持原本畫面'
      : (fixedDate ? stampPreview(p, fixedDate) : '日期取自各張照片的 EXIF 拍攝時間');
    U.$('#board-date').classList.toggle('auto', !fixedDate || mode === 'none');

    chips('#chips-area', p.areas.map((a) => ({ id: a.id, name: a.name || '（未命名）' })), c.areaId, (id) => {
      c.areaId = c.areaId === id ? '' : id; renderShoot();
    }, '尚未建立區域');

    // 工項晶片沿用工項清單的完成度顏色：綠＝已完成、琥珀＝尚未完整、灰＝無照片
    chips('#chips-item', p.items.map((i) => {
      const s = itemPhotoStatus(i);
      return { id: i.id, name: i.name || '（未命名）', state: s.state, title: statusTitle(s) };
    }), c.itemId, (id) => {
      c.itemId = c.itemId === id ? '' : id;
      const st = currentStages();
      if (st.indexOf(c.stage) < 0) c.stage = st[0];
      renderShoot();
    }, '尚未建立工項');

    const st = currentStages();
    chips('#chips-stage', st.map((s) => ({ id: s, name: s || '不分階段' })), c.stage, (id) => {
      c.stage = id; renderShoot();
    }, '');

    chips('#chips-datemode', [
      { id: 'exif', name: 'EXIF 拍攝時間' },
      { id: 'fixed', name: '指定日期' },
      { id: 'none', name: '不需日期' }
    ], mode, (id) => {
      const wm = p.watermark;
      wm.dateMode = id;
      if (id === 'fixed' && !wm.fixedDate) wm.fixedDate = U.toIso(new Date());
      save().then(renderShoot);
    }, '');

    U.$('#f-shot-date').closest('.datefield').style.display = mode === 'fixed' ? '' : 'none';
    setDateField('f-shot-date', p.watermark.fixedDate);

    renderGallery();
  }

  /* x = { id, name, state?, title? }
     state 為 full／partial／empty 時，晶片會帶上與工項清單一致的狀態顏色與圓點 */
  function chips(sel, list, active, onPick, emptyText) {
    const box = U.$(sel);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(U.el('span', { class: 'hint', text: emptyText || '—' }));
      return;
    }
    list.forEach((x) => {
      const kids = [];
      if (x.state) kids.push(U.el('i', { class: 'ph-dot', 'aria-hidden': 'true' }));
      kids.push(U.el('span', { text: x.name }));
      box.appendChild(U.el('button', {
        class: 'chip' + (x.id === active ? ' on' : '') + (x.state ? ' st-' + x.state : ''),
        title: x.title || null,
        onclick: () => onPick(x.id)
      }, kids));
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
      const canDrag = window.matchMedia && window.matchMedia('(hover: hover)').matches;
      box.appendChild(U.el('div', {
        class: 'hint pad',
        text: canDrag ? '尚無照片。按上方按鈕匯入，或直接把照片拖曳到這張卡片。'
          : '尚無照片，按上方相機按鈕開始拍攝。'
      }));
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

    // 讓使用者按下去之前就知道日期會不會一併改寫
    const wm = state.project.watermark;
    const mode = wm.dateMode || 'exif';
    const fixed = mode === 'fixed' ? U.parseDateInput(wm.fixedDate) : null;
    U.$('#bulk-date-note').textContent =
      mode === 'fixed' && fixed ? '並押上 ' + (wm.dateFormat === 'ROC' ? U.toRoc(fixed) : U.toAd(fixed))
        : mode === 'none' ? '並移除日期'
          : '';
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
    // 按下快門當下的歸類與浮水印設定，之後切換 chips 不影響這批照片
    // （浮水印整組快照：否則處理到一半改成「不需日期」，同一批會有的蓋有的沒蓋）
    const shot = {
      areaId: state.capture.areaId,
      itemId: state.capture.itemId,
      stage: state.capture.stage,
      date: effectiveDate(state.project),  // null = 沿用各張拍攝日期
      watermark: Object.assign({}, state.project.watermark)
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
        watermark: shot.watermark, label: label,
        date: shot.date || undefined
      }).then((out) => {
        const rec = {
          id: U.uid('ph'), projectId: p.id,
          blob: out.blob, thumb: out.thumb, w: out.w, h: out.h, size: out.size,
          areaId: shot.areaId || '', itemId: shot.itemId || '', stage: shot.stage || '',
          note: '', takenAt: out.takenAt, dateSource: out.dateSource, stamped: out.stamped,
          // 圖檔保持乾淨，浮水印於匯出時才套用，日期事後仍可修改
          baked: out.baked, stampDate: out.stampDate, label: out.label,
          seq: ++seq, createdAt: Date.now()
        };
        if (out.dateSource !== 'exif' && out.dateSource !== 'fixed') noExif++;
        return Store.savePhoto(rec).then(() => { state.photos.push(rec); });
      }).catch((e) => {
        console.error(e); toast('照片處理失敗：' + file.name, 'err');
      }).then(() => busy.progress(i + 1, arr.length, '處理照片 ' + (i + 1) + '/' + arr.length));
    }), Promise.resolve()).then(() => {
      busy.hide();
      if (!noExif) {
        toast('已加入 ' + arr.length + ' 張照片');
      } else if (shot.watermark.dateMode === 'none') {
        // 沒蓋在照片上，日期只影響 ZIP 檔名與 CSV，不必用錯誤色提醒
        toast(noExif + ' 張沒有 EXIF 拍攝時間，ZIP 檔名與清單會用檔案時間');
      } else {
        toast(noExif + ' 張照片沒有 EXIF 拍攝時間，已改用檔案時間，請確認日期', 'err');
      }
      render();
    });
  }

  /* --- 單張編輯 --- */
  let editingId = null;
  let editingStamp;            // undefined＝未更動；null＝改為不蓋日期；數字＝時間戳
  function openEditor(id) {
    const ph = state.photos.find((x) => x.id === id);
    if (!ph) return;
    editingId = id;
    const p = state.project;

    U.$('#ed-img').src = URL.createObjectURL(ph.blob);
    const SRC = { exif: 'EXIF 拍攝時間', fixed: '指定日期', file: '檔案時間（無 EXIF）', now: '匯入時間（無 EXIF）' };
    const src = SRC[ph.dateSource] || '拍攝時間';
    // stamped 為 undefined 代表舊照片（當時一律有蓋），只在明確為 false 時標示
    const noStamp = ph.stamped === false ? '　<span class="src-plain">未加浮水印</span>' : '';
    U.$('#ed-meta').innerHTML = U.esc(ph.w + '×' + ph.h + ' · ' + U.bytes(ph.size)) +
      '<br><b>' + U.esc(U.toRoc(ph.takenAt || ph.createdAt)) + '</b>　' +
      '<span class="' + (ph.dateSource === 'file' || ph.dateSource === 'now' ? 'src-warn' : 'src-ok') + '">' +
      U.esc(src) + '</span>' + noStamp;

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

    // 浮水印日期：舊版匯入的照片已燒進圖片，無法再改
    const locked = ph.baked === undefined || ph.baked;
    editingStamp = undefined;
    U.$('#ed-date').value = ph.stampDate ? U.toRoc(ph.stampDate) : '';
    U.$('#ed-date').disabled = locked;
    U.$('.datefield-btn[data-date-for="ed-date"]').disabled = locked;
    U.$('#ed-date-note').className = 'period-readout' + (locked ? ' on bad' : '');
    U.$('#ed-date-note').textContent = locked
      ? '這張為舊版匯入，浮水印已燒進圖片，日期無法變更'
      : '';

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

  /* ===== 桌機：把照片直接拖進相簿 ====================================
     沿用與相機／相簿匯入相同的流程，因此區域、工項、階段與日期設定
     一律比照按下快門當下的選取。                                     */
  const isFileDrag = (e) => !!(e.dataTransfer
    && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);

  function bindDropZone() {
    const zone = U.$('#drop-zone');
    if (!zone) return;
    let depth = 0;
    const clear = () => { depth = 0; zone.classList.remove('drop-over'); };

    zone.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault(); depth++; zone.classList.add('drop-over');
    });
    zone.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e)) return;
      depth--; if (depth <= 0) clear();
    });
    zone.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault(); clear();
      const files = Array.prototype.filter.call(e.dataTransfer.files || [], (f) => /^image\//.test(f.type));
      if (!files.length) { toast('請拖曳圖片檔（JPG／PNG）', 'err'); return; }
      importFiles(files);
    });

    // 拖到其他地方時擋掉瀏覽器的預設行為，避免整頁被檔案取代
    ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => {
      if (isFileDrag(e) && !(e.target.closest && e.target.closest('#drop-zone'))) e.preventDefault();
    }));
  }

  function bindShoot() {
    bindDropZone();
    U.$('#file-camera').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
    U.$('#file-album').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
    U.$('#gal-filter').addEventListener('change', renderGallery);
    bindDateField('f-shot-date', (iso) => {
      state.project.watermark.fixedDate = iso;
      save().then(renderShoot);
    });

    U.$('#btn-clear-sel').addEventListener('click', () => { state.selection.clear(); renderGallery(); });
    U.$('#btn-bulk-assign').addEventListener('click', () => {
      const c = state.capture;
      if (!c.itemId) { toast('請先於上方選擇工項', 'err'); return; }

      const ids = Array.from(state.selection);
      const applied = applyDateToPhotos(ids.map((id) => state.photos.find((x) => x.id === id)));

      Promise.all(ids.map((id) => {
        const ph = state.photos.find((x) => x.id === id);
        ph.areaId = c.areaId || ''; ph.itemId = c.itemId; ph.stage = c.stage || '';
        return Store.savePhoto(ph);
      })).then(() => {
        state.selection.clear();
        let msg = '已套用至 ' + ids.length + ' 張';
        if (applied.changed) msg += '，日期改為 ' + applied.text;
        toast(msg);
        if (applied.locked) {
          setTimeout(() => toast(applied.locked + ' 張為舊版匯入、浮水印已燒進圖片，日期無法變更', 'err'), 2700);
        }
        render();
      });
    });

    /* 依目前的「照片日期」設定改寫選取照片的日期 ----------------------
       指定日期 → 押上該日；不需日期 → 移除日期。
       EXIF 模式代表「各張各自的拍攝時間」，不應被批次覆蓋，故不動。
       舊版匯入的照片浮水印已燒在圖裡，無法重蓋，另行提示。          */
    function applyDateToPhotos(photos) {
      const wm = state.project.watermark;
      const mode = wm.dateMode || 'exif';
      if (mode === 'exif') return { changed: 0, locked: 0, text: '' };

      const fixed = mode === 'fixed' ? U.parseDateInput(wm.fixedDate) : null;
      if (mode === 'fixed' && !fixed) return { changed: 0, locked: 0, text: '' };

      let changed = 0, locked = 0;
      photos.forEach((ph) => {
        if (!ph) return;
        if (ph.baked === undefined || ph.baked) { locked++; return; }
        if (fixed) {
          ph.stampDate = fixed.getTime();
          ph.takenAt = fixed.getTime();       // ZIP 檔名與 CSV 一併對齊
          ph.dateSource = 'fixed';
        } else {
          ph.stampDate = null;                // 不需日期
          ph.dateSource = 'none';
        }
        changed++;
      });
      return {
        changed: changed, locked: locked,
        text: fixed ? (wm.dateFormat === 'ROC' ? U.toRoc(fixed) : U.toAd(fixed)) : '不蓋日期'
      };
    }
    U.$('#btn-bulk-delete').addEventListener('click', () => {
      const ids = Array.from(state.selection);
      if (!confirmBox('刪除選取的 ' + ids.length + ' 張照片？')) return;
      Promise.all(ids.map((id) => Store.deletePhoto(id))).then(() => {
        state.photos = state.photos.filter((x) => !state.selection.has(x.id));
        state.selection.clear(); toast('已刪除'); render();
      });
    });

    U.$('#ed-item').addEventListener('change', (e) => fillStageSelect(e.target.value, ''));
    bindDateField('ed-date', (iso) => {
      editingStamp = iso ? U.parseDateInput(iso).getTime() : null;
      const note = U.$('#ed-date-note');
      note.className = 'period-readout on';
      note.textContent = editingStamp
        ? '儲存後將押上 ' + (state.project.watermark.dateFormat === 'ROC' ? U.toRoc(editingStamp) : U.toAd(editingStamp))
        : '儲存後這張不會蓋日期';
    });
    U.$('#ed-close').addEventListener('click', closeEditor);
    U.$('#ed-save').addEventListener('click', () => {
      const ph = state.photos.find((x) => x.id === editingId);
      if (!ph) return closeEditor();
      ph.areaId = U.$('#ed-area').value;
      ph.itemId = U.$('#ed-item').value;
      ph.stage = U.$('#ed-stage').value;
      ph.note = U.$('#ed-note').value.trim();
      if (editingStamp !== undefined && !(ph.baked === undefined || ph.baked)) {
        ph.stampDate = editingStamp;
        if (editingStamp) { ph.takenAt = editingStamp; ph.dateSource = 'fixed'; }
        else ph.dateSource = 'none';
      }
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
    busy.show('產生預覽…');
    return ExportPrint.render(state.project, state.photos, busy.progress).then((html) => {
      box.innerHTML = html;
      box.classList.add('on');
      U.$('#btn-preview').textContent = '重新整理預覽';
      fitPreview();
      busy.hide();
    }).catch((e) => {
      console.error(e); busy.hide(); toast('預覽產生失敗：' + e.message, 'err');
    });
  }

  /* A4 頁面固定 210mm 寬，依容器寬度換算縮放比，任何螢幕都剛好塞滿不橫向捲動 */
  const A4_PX = 210 / 25.4 * 96;
  function fitPreview() {
    const box = U.$('#preview');
    if (!box || !box.classList.contains('on')) return;
    const cs = getComputedStyle(box);
    const inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (inner <= 0) return;
    const z = Math.min(1, Math.max(0.2, (inner - 2) / A4_PX));
    box.style.setProperty('--pv-zoom', z.toFixed(3));
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
      ExportPrint.print(state.project, state.photos, busy.progress)
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

  const VIEWS = ['project', 'setup', 'shoot', 'export'];

  function init() {
    bindNav(); bindProjectForm(); bindSetup(); bindShoot(); bindExport();
    bootstrap().then(() => {
      // manifest shortcuts 會帶 ?view=shoot / ?view=export 進來
      const want = new URLSearchParams(location.search).get('view');
      setView(VIEWS.indexOf(want) >= 0 ? want
        : (state.project && state.project.items.length ? 'shoot' : 'project'));
    });

    reportStorage();
    bindConnectivity();
    bindInstall();
    bindViewport();
    registerSW();
  }

  /* 螢幕尺寸／方向改變時重算 A4 預覽縮放 */
  function bindViewport() {
    let t;
    const relayout = () => { clearTimeout(t); t = setTimeout(fitPreview, 120); };
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
  }

  /* 儲存空間：照片全存在 IndexedDB，向瀏覽器申請「持久化」避免空間吃緊時被清掉 */
  function reportStorage() {
    const persisted = (navigator.storage && navigator.storage.persist)
      ? navigator.storage.persisted()
          .then((ok) => ok || navigator.storage.persist())
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([Store.estimate(), persisted]).then(([e, ok]) => {
      const parts = ['資料全部保存在本機瀏覽器，不會上傳。'];
      if (e.quota) parts.push('已用 ' + U.bytes(e.usage) + ' / ' + U.bytes(e.quota) + '。');
      if (ok === true) parts.push('已設為持久保存，不會被瀏覽器自動清除。');
      else if (ok === false) parts.push('尚未取得持久保存權限；裝到主畫面後較不會被自動清除，重要照片請盡早匯出。');
      U.$('#storage').textContent = parts.join('');
    }).catch(() => {});
  }

  /* 離線指示：現場常沒訊號，讓使用者知道現在是離線但仍可用 */
  function bindConnectivity() {
    const pill = U.$('#offline-pill');
    let last = navigator.onLine;
    const sync = (notify) => {
      const on = navigator.onLine;
      pill.hidden = on;
      if (notify && on !== last) toast(on ? '已恢復連線' : '目前離線，拍照與歸檔照常運作');
      last = on;
    };
    window.addEventListener('online', () => sync(true));
    window.addEventListener('offline', () => sync(true));
    sync(false);
  }

  /* 安裝到主畫面：Android/桌面用 beforeinstallprompt，iOS 只能給步驟說明 */
  function bindInstall() {
    const card = U.$('#install-card');
    const btn = U.$('#btn-install');
    const steps = U.$('#ios-steps');
    let deferred = null;

    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || navigator.standalone === true;
    if (standalone) return;

    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (iOS) { card.hidden = false; steps.hidden = false; }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      card.hidden = false; btn.hidden = false; steps.hidden = true;
    });

    btn.addEventListener('click', () => {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then((r) => {
        if (r.outcome === 'accepted') card.hidden = true;
        deferred = null; btn.hidden = true;
      }).catch(() => {});
    });

    window.addEventListener('appinstalled', () => {
      card.hidden = true;
      toast('已安裝，之後可從主畫面直接開啟');
    });
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
