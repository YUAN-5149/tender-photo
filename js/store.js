/* 本機儲存：IndexedDB（照片二進位）＋ localStorage（目前專案指標） -------- */
(function (g) {
  'use strict';

  const DB_NAME = 'tender-photo';
  const DB_VER = 1;
  const S_PROJECT = 'projects';
  const S_PHOTO = 'photos';
  const LS_CURRENT = 'tp.currentProjectId';

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(S_PROJECT)) db.createObjectStore(S_PROJECT, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(S_PHOTO)) {
          const os = db.createObjectStore(S_PHOTO, { keyPath: 'id' });
          os.createIndex('projectId', 'projectId', { unique: false });
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  const Store = {};

  /* ---- 專案 ---- */
  Store.saveProject = (p) => {
    p.updatedAt = Date.now();
    return tx(S_PROJECT, 'readwrite').then((os) => wrap(os.put(p))).then(() => p);
  };
  Store.getProject = (id) => tx(S_PROJECT, 'readonly').then((os) => wrap(os.get(id)));
  Store.listProjects = () => tx(S_PROJECT, 'readonly').then((os) => wrap(os.getAll()))
    .then((arr) => arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  Store.deleteProject = (id) => Store.listPhotos(id)
    .then((ps) => Promise.all(ps.map((p) => Store.deletePhoto(p.id))))
    .then(() => tx(S_PROJECT, 'readwrite'))
    .then((os) => wrap(os.delete(id)));

  Store.currentId = () => localStorage.getItem(LS_CURRENT);
  Store.setCurrentId = (id) => (id ? localStorage.setItem(LS_CURRENT, id) : localStorage.removeItem(LS_CURRENT));

  /* ---- 照片 ----
     rec = { id, projectId, blob, thumb(dataURL), w, h, size,
             areaId, itemId, stage, note, takenAt, seq, createdAt }        */
  Store.savePhoto = (rec) => tx(S_PHOTO, 'readwrite').then((os) => wrap(os.put(rec))).then(() => rec);
  Store.getPhoto = (id) => tx(S_PHOTO, 'readonly').then((os) => wrap(os.get(id)));
  Store.deletePhoto = (id) => tx(S_PHOTO, 'readwrite').then((os) => wrap(os.delete(id)));

  Store.listPhotos = (projectId) => tx(S_PHOTO, 'readonly').then((os) => {
    const idx = os.index('projectId');
    return wrap(idx.getAll(IDBKeyRange.only(projectId)));
  }).then((arr) => arr.sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0)));

  Store.estimate = function () {
    if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
    return Promise.resolve({ usage: 0, quota: 0 });
  };

  /* ---- 結構版本：既有專案開啟時自動補齊 ---- */
  Store.SCHEMA = 2;

  /**
   * 回傳 true 表示有調整、需要存回。
   * v2：左下角加註工項改為預設關閉 —— 該文字是匯入當下燒進圖片的，
   *     事後在相簿改工項或階段時不會跟著改，會與 Word 標題列不一致。
   */
  Store.migrate = function (p) {
    if (!p) return false;
    const from = p.schemaVersion || 1;
    if (from >= Store.SCHEMA) return false;

    if (from < 2) {
      p.watermark = p.watermark || {};
      p.watermark.showLabel = false;
      if (p.watermark.dateMode === undefined) p.watermark.dateMode = 'exif';
      if (p.watermark.fixedDate === undefined) p.watermark.fixedDate = '';
    }
    p.schemaVersion = Store.SCHEMA;
    return true;
  };

  /* ---- 專案樣板 ---- */
  Store.newProject = function (seed) {
    const now = new Date();
    const p = Object.assign({
      id: U.uid('prj'),
      agency: '',                 // 頁首第 1 行：機關／學校名稱
      projectName: '',            // 頁首第 2 行：工程名稱
      docTitle: '施工照',          // 頁首第 2 行尾綴
      periodStart: '',            // 工程期限起（民國字串）
      periodEnd: '',              // 工程期限訖
      vendor: '',                 // 施工廠商
      areas: [],                  // [{id,name}] 位置區域
      items: [],                  // [{id,name,stageSet}] 工項
      layoutMode: 'item',         // item = 依工項分頁；area = 依區域→工項；flow = 依序流水
      captionWithArea: false,     // 標題是否含位置區域
      includeEmpty: false,        // 是否保留無照片的空白版面
      zipStructure: 'item',       // ZIP 資料夾結構
      watermark: {
        enabled: true,
        dateFormat: 'AD',         // AD 西元 / ROC 民國
        dateMode: 'exif',         // exif = 各張照片的拍攝日期；fixed = 全部用指定日期
        fixedDate: '',            // dateMode 為 fixed 時使用（ISO）
        // 左下角加註工項：文字是匯入當下燒進圖片的，事後改分類不會跟著改，
        // 會與 Word 標題列不一致；Word 已載明工項與階段，故預設關閉。
        showLabel: false,
        position: 'br'
      },
      maxEdge: 1600,
      quality: 0.82,
      schemaVersion: Store.SCHEMA,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, seed || {});
    if (!p.periodStart) p.periodStart = U.toIso(now);
    return p;
  };

  Store.newArea = (name) => ({ id: U.uid('ar'), name: name || '' });
  Store.newItem = (name, stageSet) => ({ id: U.uid('it'), name: name || '', stageSet: stageSet || 'build' });

  /* 階段組合定義 */
  Store.STAGE_SETS = {
    build: { label: '施工前／中／後', stages: ['施工前', '施工中', '施工後'] },
    modify: { label: '修改前／中／後', stages: ['修改前', '修改中', '修改後'] },
    fix: { label: '拆除前／中／後', stages: ['拆除前', '拆除中', '拆除後'] },
    none: { label: '不分階段', stages: [''] }
  };
  Store.stagesOf = (item) => (Store.STAGE_SETS[(item && item.stageSet) || 'build'] || Store.STAGE_SETS.build).stages;

  g.Store = Store;
})(window);
