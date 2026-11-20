/* ============================================================
   내 서재 — reading log & book weaving PWA
   Vanilla JS · IndexedDB · zero dependencies
   ============================================================ */
'use strict';

/* ---------------- tiny helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};
const fmtDateTime = (ts) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(ts)} ${hh}:${mm}`;
};
const fmtBytes = (n) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sanitizeFilename = (s) =>
  (s || 'nae-seoje').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'nae-seoje';
const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/* ---------------- IndexedDB ---------------- */
const DB_NAME = 'nae-seoje';
const DB_VERSION = 1;
const STORES = ['books', 'photos', 'notes', 'blobs'];
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      });
      const photos = req.transaction.objectStore('photos');
      if (!photos.indexNames.contains('bookId')) photos.createIndex('bookId', 'bookId');
      const notes = req.transaction.objectStore('notes');
      if (!notes.indexNames.contains('bookId')) notes.createIndex('bookId', 'bookId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open 실패'));
    req.onblocked = () => reject(new Error('다른 탭에서 서재를 열고 있어요. 그 탭을 닫고 다시 시도해 주세요.'));
  });
  return _dbPromise;
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(value);
    t.oncomplete = () => res(value);
    t.onerror = () => rej(t.error);
  });
}
async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  });
}
async function dbClear(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).clear();
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  });
}

/* ---------------- state ---------------- */
/* 표지 팔레트 — 아이보리와 먹색만. [밝은 쪽, 어두운 쪽, 글자색] */
const PALETTES = [
  ['#EFE9DA', '#DCD3BD', '#111111'],
  ['#1A1A19', '#0B0B0A', '#F6F3EA'],
  ['#E8E2D4', '#D6CEBA', '#111111'],
  ['#2C2C29', '#181816', '#EFEBE1'],
  ['#FFFFFF', '#F5F1E5', '#111111'],
  ['#DCD5C3', '#C8C0AC', '#111111'],
  ['#3B3B36', '#26261F', '#E8E3D6'],
  ['#FFFFFF', '#F2EEE2', '#111111'],
];

const state = {
  books: [],
  photos: [],
  notes: [],
  currentBookId: null,
  tab: 'photos',
  bookPhotos: [],
  bookNotes: [],
  editingBookId: null,
  coverDraft: null,
  coverColor: 0,
  editingNoteId: null,
  usedVoice: false,
  photoDraft: null,
  weaveMode: false,
  selection: new Set(),
  studioBooks: [],
  genreBook: 'essay',
  genreStudio: 'essay',
  lightboxList: [],
  lightboxIndex: 0,
  speech: null,
  listening: false,
  persistClickable: true,
};

const urlCache = new Map();

/* ---------------- generic UI ---------------- */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function hashColor(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % PALETTES.length;
}

/* ---------------- covers ---------------- */
function makeCover(book, sizeClass = '') {
  const el = document.createElement('div');
  el.className = 'cover' + (sizeClass ? ' ' + sizeClass : '');
  const pal = PALETTES[book.color != null ? book.color % PALETTES.length : hashColor(book.title)] || PALETTES[0];
  el.style.setProperty('--c1', pal[0]);
  el.style.setProperty('--c2', pal[1]);
  el.style.setProperty('--cf', pal[2] || '#111111');

  if (book.coverData) {
    el.classList.add('has-img');
    const img = document.createElement('img');
    img.className = 'cover-img';
    img.src = book.coverData;
    img.alt = '';
    el.appendChild(img);
    const inner = document.createElement('div');
    inner.className = 'cover-inner';
    inner.style.justifyContent = 'flex-end';
    const t = document.createElement('span');
    t.className = 'cover-title';
    t.textContent = book.title || '제목 없는 책';
    inner.appendChild(t);
    el.appendChild(inner);
    return el;
  }

  const inner = document.createElement('div');
  inner.className = 'cover-inner';
  const top = document.createElement('div');
  const t = document.createElement('span');
  t.className = 'cover-title';
  t.textContent = book.title || '제목 없는 책';
  top.appendChild(t);
  const line = document.createElement('div');
  line.className = 'cover-line';
  top.appendChild(line);
  inner.appendChild(top);
  if (book.author) {
    const a = document.createElement('span');
    a.className = 'cover-author';
    a.textContent = book.author;
    inner.appendChild(a);
  }
  el.appendChild(inner);
  return el;
}

/* ---------------- images ---------------- */
function compressImage(file, maxEdge = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const loadImage = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.'));
        img.src = src;
      });

    const draw = async (source, w, h) => {
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, cw, ch);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      if (!blob) return reject(new Error('이미지 압축에 실패했습니다.'));
      resolve({ blob, width: cw, height: ch });
    };

    const objectUrl = URL.createObjectURL(file);
    const finish = () => URL.revokeObjectURL(objectUrl);

    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then((bitmap) => {
          const w = bitmap.width;
          const h = bitmap.height;
          draw(bitmap, w, h)
            .then(() => {
              if (bitmap.close) bitmap.close();
              finish();
            })
            .catch((e) => {
              finish();
              reject(e);
            });
        })
        .catch(() => {
          loadImage(objectUrl)
            .then((img) => draw(img, img.naturalWidth, img.naturalHeight).finally(finish))
            .catch((e) => {
              finish();
              reject(e);
            });
        });
    } else {
      loadImage(objectUrl)
        .then((img) => draw(img, img.naturalWidth, img.naturalHeight).finally(finish))
        .catch((e) => {
          finish();
          reject(e);
        });
    }
  });
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataUrl) {
  const [head, data] = String(dataUrl).split(',');
  const mime = (head.match(/:(.*?);/) || [, 'image/jpeg'])[1];
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await dbGet('blobs', id);
  if (!rec || !rec.blob) return '';
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}
function dropPhotoURL(id) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}

/* ============================================================
   DATA
   ============================================================ */
async function reloadAll() {
  const [books, photos, notes] = await Promise.all([dbGetAll('books'), dbGetAll('photos'), dbGetAll('notes')]);
  state.books = books;
  state.photos = photos;
  state.notes = notes;
}

const photosOf = (bookId) =>
  state.photos
    .filter((p) => p.bookId === bookId)
    .sort((a, b) => (a.page || 99999) - (b.page || 99999) || a.createdAt - b.createdAt);
const notesOf = (bookId) => state.notes.filter((n) => n.bookId === bookId).sort((a, b) => a.createdAt - b.createdAt);
const bookById = (id) => state.books.find((b) => b.id === id);
const lastActivity = (book) => {
  const p = state.photos.filter((x) => x.bookId === book.id).map((x) => x.createdAt);
  const n = state.notes.filter((x) => x.bookId === book.id).map((x) => x.createdAt);
  return Math.max(book.updatedAt || 0, book.createdAt || 0, ...p, ...n);
};

/* ============================================================
   SHELF
   ============================================================ */
function renderShelf() {
  const grid = $('#shelfGrid');
  const q = $('#searchInput').value.trim().toLowerCase();
  const sort = $('#sortSelect').value;
  grid.innerHTML = '';

  const noteIndex = new Map();
  state.notes.forEach((n) => {
    const prev = noteIndex.get(n.bookId) || '';
    noteIndex.set(n.bookId, prev + ' ' + (n.text || ''));
  });
  const photoIndex = new Map();
  state.photos.forEach((p) => {
    const prev = photoIndex.get(p.bookId) || '';
    photoIndex.set(p.bookId, prev + ' ' + (p.caption || ''));
  });

  let books = state.books.filter((b) => {
    if (!q) return true;
    const hay = [b.title, b.author, noteIndex.get(b.id) || '', photoIndex.get(b.id) || ''].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (sort === 'title') books.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
  else if (sort === 'added') books.sort((a, b) => b.createdAt - a.createdAt);
  else books.sort((a, b) => lastActivity(b) - lastActivity(a));

  const hasBooks = state.books.length > 0;
  $('#shelfEmpty').hidden = hasBooks;
  $('#noResults').hidden = !(hasBooks && books.length === 0);
  grid.hidden = books.length === 0;
  const cabinet = $('#shelfCabinet');
  if (cabinet) cabinet.hidden = books.length === 0;

  books.forEach((book) => {
    const pc = photosOf(book.id).length;
    const nc = notesOf(book.id).length;
    const card = document.createElement('article');
    const isSelected = state.weaveMode && state.selection.has(book.id);
    card.className = 'book-card' + (isSelected ? ' is-selected' : '');
    card.dataset.id = book.id;
    card.setAttribute('role', 'listitem');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'book-card-btn';
    btn.setAttribute('aria-label', `${book.title}${book.author ? ', ' + book.author : ''} — 사진 ${pc}장, 기록 ${nc}편`);
    btn.appendChild(makeCover(book));
    const stage = document.createElement('div');
    stage.className = 'book-stage';
    stage.appendChild(btn);
    card.appendChild(stage);

    if (state.weaveMode) {
      const box = document.createElement('span');
      box.className = 'select-box';
      box.textContent = isSelected ? '✓' : '';
      box.setAttribute('aria-hidden', 'true');
      card.appendChild(box);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }

    const meta = document.createElement('div');
    meta.className = 'book-card-meta';
    const h = document.createElement('h3');
    h.textContent = book.title;
    meta.appendChild(h);
    if (book.author) {
      const a = document.createElement('p');
      a.className = 'author';
      a.textContent = book.author;
      meta.appendChild(a);
    }
    const badges = document.createElement('div');
    badges.className = 'badges';
    badges.innerHTML = `<span class="b-photo">${pc}</span><span class="b-note">${nc}</span>`;
    meta.appendChild(badges);
    card.appendChild(meta);
    grid.appendChild(card);
  });

  updateShelfSummary();
  updateSelectionBar();
  fillLastShelfRow();
}

/* 마지막 줄의 빈 칸에도 나무 선반이 이어지도록 빈 칸 채우기 */
function shelfColumnCount(grid) {
  const cards = [...grid.querySelectorAll('.book-card')];
  if (!cards.length) return 1;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const cardWidth = cards[0].getBoundingClientRect().width;
  if (!cardWidth) return 1;
  return Math.max(1, Math.round((grid.clientWidth + gap) / (cardWidth + gap)));
}

function fillLastShelfRow() {
  const grid = $('#shelfGrid');
  if (!grid || grid.hidden) return;
  grid.querySelectorAll('.shelf-filler').forEach((el) => el.remove());
  const count = grid.querySelectorAll('.book-card').length;
  if (!count) return;
  const cols = shelfColumnCount(grid);
  const missing = (cols - (count % cols)) % cols;
  for (let i = 0; i < missing; i += 1) {
    const filler = document.createElement('div');
    filler.className = 'shelf-filler';
    filler.setAttribute('role', 'presentation');
    filler.setAttribute('aria-hidden', 'true');
    const stage = document.createElement('div');
    stage.className = 'book-stage';
    filler.appendChild(stage);
    grid.appendChild(filler);
  }
}

function updateShelfSummary() {
  const n = state.books.length;
  const p = state.photos.length;
  const m = state.notes.length;
  const el = $('#shelfSummary');
  if (!n) el.textContent = '아직 서재가 비어 있어요.';
  else el.textContent = `책 ${n}권 · 밑줄 사진 ${p}장 · 나의 언어 ${m}편`;
}

function updateSelectionBar() {
  const bar = $('#selectionBar');
  bar.hidden = !state.weaveMode;
  if (!state.weaveMode) return;
  const n = state.selection.size;
  $('#selectionText').textContent = n ? `${n}권 선택됨` : '엮을 책을 골라주세요';
  $('#selectionGo').disabled = n === 0;
}

function toggleSelection(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  renderShelf();
}

/* ============================================================
   ROUTER / VIEWS
   ============================================================ */
function showShelf() {
  $('#view-shelf').hidden = false;
  $('#view-book').hidden = true;
  $('#view-studio').hidden = true;
  document.title = '내 서재 — 읽고, 밑줄 긋고, 엮어서 한 권으로';
  renderShelf();
}

function routeFromHash() {
  const h = location.hash || '#shelf';
  if (h.startsWith('#book/')) {
    const id = decodeURIComponent(h.slice(6));
    openBook(id, false);
  } else if (h === '#studio') {
    showStudio(false);
  } else {
    showShelf();
  }
}

/* ============================================================
   BOOK DIALOG
   ============================================================ */
function openBookDialog(book = null) {
  state.editingBookId = book ? book.id : null;
  state.coverDraft = book ? book.coverData || null : null;
  state.coverColor = book ? book.color ?? hashColor(book.title) : PALETTES.length - 1;
  $('#bookDialogTitle').textContent = book ? '책 정보 수정' : '새 책';
  $('#bookSubmit').textContent = book ? '저장' : '서재에 꽂기';
  $('#bookTitleInput').value = book ? book.title : '';
  $('#bookAuthorInput').value = book ? book.author || '' : '';
  renderSwatches();
  paintCoverPreview();
  if (!$('#bookDialog').open) $('#bookDialog').showModal();
  setTimeout(() => $('#bookTitleInput').focus(), 60);
}

function renderSwatches() {
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  PALETTES.forEach((pal, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (i === state.coverColor ? ' is-active' : '');
    b.style.background = `linear-gradient(150deg, ${pal[0]}, ${pal[1]})`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', i === state.coverColor ? 'true' : 'false');
    b.setAttribute('aria-label', `표지 색 ${i + 1}`);
    b.dataset.color = String(i);
    wrap.appendChild(b);
  });
}

function paintCoverPreview() {
  const holder = $('#coverPreview');
  if (!holder) return;
  const draft = {
    title: $('#bookTitleInput').value || '표지',
    author: $('#bookAuthorInput').value || '',
    color: state.coverColor,
    coverData: state.coverDraft,
  };
  const cover = makeCover(draft, 'cover-pick');
  cover.id = 'coverPreview';
  holder.replaceWith(cover);
}

async function handleCoverFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('이미지 파일만 표지로 쓸 수 있어요.');
  try {
    const { blob } = await compressImage(file, 720, 0.8);
    state.coverDraft = await blobToDataURL(blob);
    paintCoverPreview();
    toast('표지 사진을 넣었어요.');
  } catch (e) {
    toast('표지를 불러오지 못했어요: ' + e.message);
  }
}

async function submitBook(e) {
  e.preventDefault();
  const title = $('#bookTitleInput').value.trim();
  const author = $('#bookAuthorInput').value.trim();
  if (!title) {
    $('#bookTitleInput').focus();
    return toast('책 제목을 적어주세요.');
  }
  const now = Date.now();
  if (state.editingBookId) {
    const book = bookById(state.editingBookId);
    if (!book) return;
    book.title = title;
    book.author = author;
    book.color = state.coverColor;
    book.coverData = state.coverDraft;
    book.updatedAt = now;
    await dbPut('books', book);
    toast('책 정보를 저장했어요.');
    $('#bookDialog').close();
    if (state.currentBookId === book.id) renderBook();
    renderShelf();
  } else {
    const book = {
      id: uid(),
      title,
      author,
      color: state.coverColor,
      coverData: state.coverDraft,
      summary: '',
      createdAt: now,
      updatedAt: now,
    };
    await dbPut('books', book);
    state.books.push(book);
    $('#bookDialog').close();
    renderShelf();
    toast(`「${title}」을 서재에 꽂았어요.`);
    location.hash = '#book/' + book.id;
  }
}

/* ============================================================
   BOOK VIEW
   ============================================================ */
function openBook(id, updateHash = true) {
  const book = bookById(id);
  if (!book) {
    toast('책을 찾을 수 없어요.');
    location.hash = '#shelf';
    return;
  }
  state.currentBookId = id;
  state.tab = 'photos';
  resetNoteEditor();
  if (updateHash) location.hash = '#book/' + id;
  $('#view-shelf').hidden = true;
  $('#view-studio').hidden = true;
  $('#view-book').hidden = false;
  renderBook();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
}

function renderBook() {
  const book = bookById(state.currentBookId);
  if (!book) return;
  document.title = `${book.title} — 내 서재`;
  const coverHolder = $('#bookCover');
  if (coverHolder) {
    const fresh = makeCover(book, 'cover-lg');
    fresh.id = 'bookCover';
    coverHolder.replaceWith(fresh);
  }

  $('#bookTitle').textContent = book.title;
  $('#bookAuthor').textContent = book.author || '';
  $('#bookEyebrow').textContent = book.author ? 'READING LOG' : 'READING LOG · 저자 미상';
  const photos = photosOf(book.id);
  const notes = notesOf(book.id);
  state.bookPhotos = photos;
  state.bookNotes = notes;

  $('#bookMeta').innerHTML = `
    <span>밑줄 사진 ${photos.length}장</span>
    <span>나의 언어 ${notes.length}편</span>
    <span>${fmtDate(book.createdAt)} 시작</span>`;
  $('#tab-photos .tab-count').textContent = photos.length;
  $('#tab-notes .tab-count').textContent = notes.length;
  $('#bookSummary').value = book.summary || '';

  switchTab(state.tab);
  renderPhotos();
  renderNotes();
  renderBookPreview();
}

function switchTab(name) {
  state.tab = name;
  $$('.tabs .tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== name));
}

/* ---------------- photos ---------------- */
function renderPhotos() {
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  const photos = state.bookPhotos;

  photos.forEach((p, idx) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'photo-card';
    card.dataset.photoId = p.id;
    const img = document.createElement('img');
    img.alt = p.caption || `밑줄 사진 ${idx + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    card.appendChild(img);
    photoURL(p.id).then((u) => { if (u) img.src = u; });

    if (p.isQuote) {
      const q = document.createElement('span');
      q.className = 'pc-quote';
      q.textContent = '대표 문장';
      card.appendChild(q);
    }
    const body = document.createElement('div');
    body.className = 'pc-body';
    if (p.page) {
      const pg = document.createElement('span');
      pg.className = 'pc-page';
      pg.textContent = `p. ${p.page}`;
      body.appendChild(pg);
    }
    if (p.caption) {
      const cap = document.createElement('span');
      cap.className = 'pc-caption';
      cap.textContent = p.caption;
      body.appendChild(cap);
    }
    if (!p.page && !p.caption) {
      const cap = document.createElement('span');
      cap.className = 'pc-caption';
      cap.textContent = fmtDate(p.createdAt);
      body.appendChild(cap);
    }
    card.appendChild(body);
    card.addEventListener('click', () => openLightbox(p.id));
    grid.appendChild(card);
  });

  $('#photoEmpty').hidden = photos.length > 0;
  $('#tab-photos .tab-count').textContent = photos.length;
  updateShelfCounts();
}

function updateShelfCounts() {
  if (state.currentBookId) {
    const book = bookById(state.currentBookId);
    if (!book) return;
    const pc = photosOf(book.id).length;
    const nc = notesOf(book.id).length;
    $('#bookMeta').innerHTML = `
      <span>밑줄 사진 ${pc}장</span>
      <span>나의 언어 ${nc}편</span>
      <span>${fmtDate(book.createdAt)} 시작</span>`;
    $('#tab-notes .tab-count').textContent = nc;
  }
}

/* photo dialog */
function resetPhotoDialog() {
  const prev = $('#photoPreviewImg').dataset.url;
  if (prev) URL.revokeObjectURL(prev);
  delete $('#photoPreviewImg').dataset.url;
  state.photoDraft = null;
  $('#photoFile').value = '';
  $('#cameraFile').value = '';
  $('#photoPreviewWrap').hidden = true;
  $('#photoPreviewImg').removeAttribute('src');
  $('#uploadPrompt').hidden = false;
  $('#photoSubmit').disabled = true;
  $('#photoPage').value = '';
  $('#photoCaption').value = '';
  $('#photoQuote').checked = false;
  $('#photoSizeInfo').textContent = '';
}

function openPhotoDialog() {
  resetPhotoDialog();
  if (!$('#photoDialog').open) $('#photoDialog').showModal();
}

async function handlePhotoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('이미지 파일만 올릴 수 있어요.');
  if (file.size > 40 * 1024 * 1024) return toast('40MB 이하 사진만 올릴 수 있어요.');
  const label = $('#photoSizeInfo');
  label.textContent = '압축 중…';
  $('#uploadPrompt').hidden = true;
  $('#photoPreviewWrap').hidden = false;
  try {
    const { blob, width, height } = await compressImage(file, 1600, 0.82);
    state.photoDraft = { blob, width, height, original: file.size, bytes: blob.size };
    const oldUrl = $('#photoPreviewImg').dataset.url;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const url = URL.createObjectURL(blob);
    $('#photoPreviewImg').src = url;
    $('#photoPreviewImg').dataset.url = url;
    const saved = file.size ? Math.round((1 - blob.size / file.size) * 100) : 0;
    label.textContent = `${fmtBytes(file.size)} → ${fmtBytes(blob.size)} · ${saved}% 절약`;
    $('#photoSubmit').disabled = false;
  } catch (err) {
    toast('사진을 처리하지 못했어요: ' + err.message);
    resetPhotoDialog();
  }
}

async function submitPhoto(e) {
  e.preventDefault();
  if (!state.photoDraft || !state.currentBookId) return;
  const book = bookById(state.currentBookId);
  if (!book) return;
  const now = Date.now();
  const photo = {
    id: uid(),
    bookId: book.id,
    page: Number($('#photoPage').value) || null,
    caption: $('#photoCaption').value.trim(),
    isQuote: $('#photoQuote').checked,
    width: state.photoDraft.width,
    height: state.photoDraft.height,
    bytes: state.photoDraft.bytes,
    type: state.photoDraft.blob.type,
    createdAt: now,
  };
  await dbPut('photos', photo);
  await dbPut('blobs', { id: photo.id, blob: state.photoDraft.blob });
  state.photos.push(photo);
  book.updatedAt = now;
  await dbPut('books', book);
  state.bookPhotos = photosOf(book.id);
  $('#photoDialog').close();
  renderPhotos();
  renderBookPreview();
  refreshStorageChip();
  toast(`사진 1장 저장 · ${fmtBytes(photo.bytes)}`);
}

/* lightbox */
function openLightbox(photoId) {
  const list = photosOf(state.currentBookId);
  const idx = list.findIndex((p) => p.id === photoId);
  if (idx < 0) return;
  state.lightboxList = list;
  state.lightboxIndex = idx;
  paintLightbox();
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}

async function paintLightbox() {
  const p = state.lightboxList[state.lightboxIndex];
  if (!p) return closeLightbox();
  const img = $('#lbImage');
  img.classList.remove('zoom');
  const u = await photoURL(p.id);
  img.src = u;
  img.alt = p.caption || '밑줄 사진';
  $('#lbMeta').textContent = [p.page ? `p. ${p.page}` : '', fmtDate(p.createdAt), fmtBytes(p.bytes)].filter(Boolean).join(' · ');
  $('#lbCaption').textContent = p.caption || '';
  $('#lbPrev').hidden = state.lightboxIndex === 0;
  $('#lbNext').hidden = state.lightboxIndex === state.lightboxList.length - 1;
}

function closeLightbox() {
  $('#lightbox').hidden = true;
  document.body.style.overflow = '';
}
function lightboxNav(dir) {
  const next = state.lightboxIndex + dir;
  if (next < 0 || next >= state.lightboxList.length) return;
  state.lightboxIndex = next;
  paintLightbox();
}
async function deleteCurrentPhoto() {
  const p = state.lightboxList[state.lightboxIndex];
  if (!p) return;
  if (!confirm('이 사진을 지울까요? 되돌릴 수 없어요.')) return;
  await dbDelete('photos', p.id);
  await dbDelete('blobs', p.id);
  dropPhotoURL(p.id);
  state.photos = state.photos.filter((x) => x.id !== p.id);
  state.bookPhotos = photosOf(state.currentBookId);
  state.lightboxList = state.lightboxList.filter((x) => x.id !== p.id);
  if (!state.lightboxList.length) closeLightbox();
  else {
    state.lightboxIndex = Math.min(state.lightboxIndex, state.lightboxList.length - 1);
    paintLightbox();
  }
  renderPhotos();
  renderBookPreview();
  refreshStorageChip();
  toast('사진을 지폈어요.');
}

/* ---------------- notes ---------------- */
function renderNotes() {
  const list = $('#noteList');
  list.innerHTML = '';
  const notes = state.bookNotes;
  notes.forEach((n) => {
    const item = document.createElement('article');
    item.className = 'note-item' + (n.source === 'voice' ? ' is-quote' : '');
    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = n.text;
    item.appendChild(text);
    const foot = document.createElement('div');
    foot.className = 'note-foot';
    const date = document.createElement('span');
    date.className = 'note-date';
    date.textContent = fmtDateTime(n.updatedAt || n.createdAt) + (n.source === 'voice' ? ' · 음성으로 남김' : '');
    foot.appendChild(date);
    const acts = document.createElement('div');
    acts.className = 'note-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '수정';
    edit.dataset.editNote = n.id;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '삭제';
    del.dataset.deleteNote = n.id;
    acts.append(edit, del);
    foot.appendChild(acts);
    item.appendChild(foot);
    list.appendChild(item);
  });
  $('#noteEmpty').hidden = notes.length > 0;
  $('#tab-notes .tab-count').textContent = notes.length;
  updateShelfCounts();
}

function ensureCancelEditBtn() {
  if ($('#cancelEditBtn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'cancelEditBtn';
  btn.className = 'btn ghost sm';
  btn.textContent = '수정 취소';
  btn.hidden = true;
  btn.addEventListener('click', resetNoteEditor);
  $('#saveNoteBtn').before(btn);
}

function setNoteEditing(note) {
  ensureCancelEditBtn();
  if (note) {
    state.editingNoteId = note.id;
    $('#noteInput').value = note.text;
    $('#composerTitle').textContent = '내 기록 수정';
    $('#saveNoteBtn').textContent = '수정 저장';
    $('#cancelEditBtn').hidden = false;
    $('#noteHint').textContent = '수정 중이에요.';
    $('#noteInput').focus();
  } else {
    resetNoteEditor();
  }
}

function resetNoteEditor() {
  state.editingNoteId = null;
  $('#noteInput').value = '';
  $('#composerTitle').textContent = '내 생각 쓰기';
  $('#saveNoteBtn').textContent = '기록 저장';
  const c = $('#cancelEditBtn');
  if (c) c.hidden = true;
  $('#noteHint').textContent = '저장하면 이 기기의 IndexedDB에만 남아요.';
}

async function saveNote() {
  const text = $('#noteInput').value.trim();
  if (!text) {
    $('#noteInput').focus();
    return toast('한 문장이라도 적어주세요.');
  }
  const book = bookById(state.currentBookId);
  if (!book) return;
  const now = Date.now();
  if (state.editingNoteId) {
    const note = state.notes.find((n) => n.id === state.editingNoteId);
    if (note) {
      note.text = text;
      note.updatedAt = now;
      note.source = state.usedVoice ? 'voice' : note.source || 'text';
      await dbPut('notes', note);
    }
    toast('기록을 고쳤어요.');
  } else {
    const note = {
      id: uid(),
      bookId: book.id,
      text,
      source: state.usedVoice ? 'voice' : 'text',
      createdAt: now,
      updatedAt: now,
    };
    await dbPut('notes', note);
    state.notes.push(note);
    toast('나의 언어로 남겼어요.');
  }
  book.updatedAt = now;
  await dbPut('books', book);
  state.bookNotes = notesOf(book.id);
  state.usedVoice = false;
  resetNoteEditor();
  renderNotes();
  renderBookPreview();
}

async function deleteNote(id) {
  if (!confirm('이 기록을 지울까요?')) return;
  await dbDelete('notes', id);
  state.notes = state.notes.filter((n) => n.id !== id);
  state.bookNotes = notesOf(state.currentBookId);
  if (state.editingNoteId === id) resetNoteEditor();
  renderNotes();
  renderBookPreview();
  toast('기록을 지폈어요.');
}

/* ---------------- speech ---------------- */
function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function setSpeechStatus(msg, isError = false) {
  const el = $('#speechStatus');
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}

function stopSpeechUI() {
  clearTimeout(state.speechTimer);
  state.listening = false;
  const btn = $('#micBtn');
  btn.classList.remove('is-listening');
  btn.setAttribute('aria-pressed', 'false');
  $('#micLabel').textContent = '말로 쓰기';
}

function startSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setSpeechStatus('이 브라우저는 음성 입력을 지원하지 않아요. 직접 타이핑해 주세요.', true);
    return;
  }
  try {
    const rec = new SR();
    state.speech = rec;
  state.speechGotResult = false;
  state.speechErrored = false;
  state.speechManualStop = false;
    rec.lang = $('#speechLang').value;
    rec.continuous = true;
    rec.interimResults = true;
    let base = $('#noteInput').value;
    rec.onstart = () => {
      clearTimeout(state.speechTimer);
      state.listening = true;
      const btn = $('#micBtn');
      btn.classList.add('is-listening');
      btn.setAttribute('aria-pressed', 'true');
      $('#micLabel').textContent = '듣는 중…';
      setSpeechStatus(`듣고 있어요 (${rec.lang === 'ko-KR' ? '한국어' : 'English'}). 다시 누르면 멈춰요.`);
    };
    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalText) {
        const glue = base && !/\s$/.test(base) ? ' ' : '';
        base += glue + finalText;
        $('#noteInput').value = base;
        state.usedVoice = true;
        state.speechGotResult = true;
      }
      if (interim) {
        state.speechGotResult = true;
        setSpeechStatus('듣는 중… ' + interim);
      } else if (finalText) setSpeechStatus('받아 적었어요. 계속 말해도 돼요.');
    };
    rec.onerror = (e) => {
      const map = {
        'not-allowed': '마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크를 허용해 주세요.',
        'service-not-allowed': '이 브라우저에서는 음성 인식 서비스를 쓸 수 없어요. 직접 타이핑해 주세요.',
        'no-speech': '소리가 들리지 않았어요. 다시 눌러 말해보세요.',
        'audio-capture': '마이크를 찾지 못했어요.',
        network: '음성 인식 서버에 연결하지 못했어요. 잠시 뒤 다시 시도하거나 타이핑해 주세요.',
        aborted: '',
      };
      const msg = map[e.error];
      if (msg) setSpeechStatus(msg, true);
      if (e.error !== 'aborted') state.speechErrored = true;
      stopSpeechUI();
    };
    rec.onend = () => {
      stopSpeechUI();
      if (state.speechManualStop || state.speechErrored) return;
      if (state.speechGotResult) {
        setSpeechStatus('받아 적었어요. 아래 저장을 눌러 남겨주세요.');
      } else {
        setSpeechStatus('소리가 잡히지 않았어요. 마이크 권한을 허용하고 다시 눌러 말해보세요.', true);
      }
    };
    rec.start();
    clearTimeout(state.speechTimer);
    state.speechTimer = setTimeout(() => {
      if (!state.listening && !state.speechGotResult && !$('#speechStatus').textContent.trim()) {
        setSpeechStatus('음성 인식을 시작하지 못했어요. 마이크 권한과 인터넷 연결을 확인하거나 타이핑으로 남겨주세요.', true);
        stopSpeechUI();
      }
    }, 2500);
  } catch (err) {
    setSpeechStatus('음성 입력을 시작하지 못했어요: ' + err.message, true);
    stopSpeechUI();
  }
}

function toggleSpeech() {
  if (state.listening) {
    state.speechManualStop = true;
    try { state.speech && state.speech.stop(); } catch (_) {}
    stopSpeechUI();
    setSpeechStatus(state.speechGotResult ? '멈췄어요. 저장을 눌러 남겨주세요.' : '멈췄어요.');
    return;
  }
  startSpeech();
}

/* ============================================================
   EXPORT / WEAVING
   ============================================================ */
function photoLines(photos, level = 3) {
  const h = '#'.repeat(level);
  return photos
    .map((p, i) => {
      const head = p.page ? `p. ${p.page}` : '쪽 미표기';
      const cap = p.caption ? ` — ${p.caption}` : '';
      const quote = p.isQuote ? '\n> 대표 인용문' : '';
      return `${h} ${head}${cap}${quote}\n· 사진 ${i + 1} (${p.width || '?'}×${p.height || '?'}, ${fmtBytes(p.bytes)})`;
    })
    .join('\n\n');
}

function noteBlock(notes, level = 3) {
  const h = '#'.repeat(level);
  return notes
    .map((n) => `${h} ${fmtDateTime(n.createdAt)}${n.source === 'voice' ? ' · 음성으로 남김' : ''}\n${n.text}`)
    .join('\n\n');
}

/* ============================================================
   AI 창작 프롬프트 — 장르별 프로 편집자 프롬프트
   ============================================================ */
const GENRES = [
  { id: 'essay', label: '에세이 · 회고' },
  { id: 'growth', label: '자기계발 · 실행' },
  { id: 'business', label: '비즈니스 · 부' },
  { id: 'parenting', label: '육아 · 가족' },
  { id: 'humanities', label: '인문 · 사유' },
  { id: 'fiction', label: '소설 · 창작' },
];

const GENRE_PROMPTS = {
  essay: {
    name: '에세이 · 회고',
    reader:
      '아이를 키우거나 일과 삶 사이에서 자기 시간을 잃어가는 30~40대. 화려한 성공담이 아니라, 내 하루를 정확히 봐 주는 문장을 원하는 사람이다.',
    formula:
      '① 한 장면에 통찰 하나. 사건의 크기가 아니라 관찰의 정확도가 힘이다. ② 시간을 교차한다(지금의 장면 → 그때의 기억 → 다시 지금). ③ 사물 하나를 책 전체를 관통하는 모티프로 반복한다(서랍, 새벽 수유등, 현관의 신발). ④ 감정은 이름 붙이지 않고 행동과 사물로 보여준다. ⑤ 마지막 장은 결론이 아니라 “지금 나는 무엇을 보고 있는가”로 닫는다.',
    titles:
      '사물·장소·시간의 이름을 그대로 제목으로 쓴다(“서랍 두 개”, “새벽 세 시의 물컵”). 4~10자. 행복·성장·치유 같은 추상어를 단독으로 쓰지 않는다. 다섯 개 제목을 이어 읽으면 한 편의 짧은 글이 되어야 한다.',
    rhythm:
      '① 장면 한 줄(시간·장소·사물이 보이게) ② 그때 내가 한 행동 ③ 그 행동이 지금의 나에게 남긴 것 ④ 밑줄 문장 한 줄 ⑤ 지금의 나에게 던지는 질문 하나',
    ban:
      '“많이 힘들었다”, “그래서 나는 성장했다” 같은 감정 요약과 교훈적 마무리. 내 기록에 없는 명언 인용. “치유”, “위로” 같은 상투어 남발.',
    deliver: 'H1 책 제목, H2 챕터 5~7개, 각 챕터 1,200~1,800자.',
  },
  growth: {
    name: '자기계발 · 실행',
    reader:
      '복직·이직·새 습관을 앞두고 계획은 세우지만 3일을 넘기지 못하는 30~40대 직장인. 위로보다 “그래서 오늘 뭘 하지”를 원하는 사람이다.',
    formula:
      '① 독자가 겪는 구체적 장면으로 문제를 연다(출근길, 새벽 알람, 세 번째 실패). ② 원인을 의지가 아니라 구조에서 찾는다(환경, 마찰, 기준). ③ 해법은 3단계 이내로 압축하고 이름을 붙인다(예: “현관 3초 규칙”). ④ 반론을 먼저 처리한다(“바쁘면요?”, “아이가 있으면요?”). ⑤ 챕터마다 오늘 10분 안에 할 수 있는 실천 하나로 닫는다.',
    titles:
      '숫자 + 행동(“3일을 넘기는 법”, “현관에 두는 운동화 하나”). 6~14자. 제목만 이어 읽어도 실행 순서가 보이게 쓴다.',
    rhythm:
      '① 독자가 겪는 장면 ② 왜 의지의 문제가 아닌지 ③ 내가 바꾼 구조 하나 ④ 밑줄 문장 ⑤ “오늘 10분” 실천 한 줄',
    ban:
      '“의지력”, “동기부여”, “마인드셋”만 외치는 구호. 성공 사례를 자랑하는 문단. 같은 주장을 세 번 반복하는 것. “무조건”, “누구나 할 수 있다”.',
    deliver: 'H1 책 제목, H2 챕터 5~7개, 각 챕터 끝에 “오늘 10분” 실천 1줄.',
  },
  business: {
    name: '비즈니스 · 부',
    reader:
      '월급 외 수입을 처음 만들려는 직장인, 이미 작게 팔고 있지만 가격과 재구매에서 막힌 1인 사업자. 감동보다 숫자와 순서를 원하는 사람이다.',
    formula:
      '① 첫 장에서 “이 문제가 한 달에 얼마를 새게 하는지”를 숫자로 제시한다. ② 사례 → 원리 → 적용 순서로 쌓는다. ③ 방법에 이름을 붙여 기억하게 한다(프레임워크는 한 권에 하나면 충분하다). ④ 반대편 리스크와 실패 조건을 반드시 함께 쓴다(신뢰는 여기서 생긴다). ⑤ 마지막 장은 30일 실행 순서표로 끝낸다.',
    titles:
      '결과 + 기간(“30일 안에 첫 결제”, “가격을 올려도 팔리는 이유”). 숫자를 제목에 넣되 근거 없는 숫자는 쓰지 않는다.',
    rhythm:
      '① 독자가 실제로 겪는 손실 장면 ② 그 손실이 생기는 구조 ③ 내가 쓴 방법과 이름 ④ 예상 반론과 답 ⑤ 밑줄 문장 ⑥ 오늘 할 한 가지',
    ban:
      '“무조건”, “누구나 월 1억”, 근거 없는 시장 규모, 과장된 성공 신화. 내 기록에 없는 매출·전환율을 사실처럼 쓰는 것(예시면 “예: ”를 붙인다).',
    deliver: 'H1 책 제목, H2 챕터 5~7개, 맨 끝에 30일 실행 순서표(체크리스트).',
  },
  parenting: {
    name: '육아 · 가족',
    reader:
      '3~7세 아이를 키우는 부모. 훈육과 애정 사이에서 매일 흔들리고, 아이를 평가하지 않으면서도 기준은 세우고 싶은 사람이다.',
    formula:
      '① 아이의 말이나 행동 한 장면으로 연다(대사를 그대로). ② 그 순간 부모인 내가 당황한 지점을 숨기지 않는다. ③ 발달 관점의 해석은 한두 문장만 곁들인다(단정하지 않는다). ④ 오늘 바꿔 말할 한 문장을 제시한다. ⑤ 완벽한 부모 서사 대신 “다음에 다시 해보는” 여운으로 닫는다.',
    titles:
      '아이의 말을 제목으로 쓰거나(“엄마, 아직 안 자”), 장면의 이름을 쓴다(“현관에서 나가기까지 12분”).',
    rhythm:
      '① 아이의 장면과 대사 ② 그때 내가 느낀 당황 ③ 내가 해석한 이유 ④ 밑줄 문장 ⑤ 오늘 아이에게 건넬 한마디',
    ban:
      '아이를 평가하는 말(“착한 아이”, “예민한 아이”), 훈육법 단정(“이렇게 하면 무조건”), 아이의 사생활 과다 노출(이름·얼굴·어린이집 이름은 이니셜이나 “아이”로 바꾼다).',
    deliver: 'H1 책 제목, H2 챕터 5~7개, 각 챕터 끝에 “오늘의 한마디”.',
  },
  humanities: {
    name: '인문 · 사유',
    reader:
      '읽고 난 뒤 혼자 생각할 시간을 갖고 싶은 독자. 정답보다 질문, 요약보다 사유의 과정을 원하는 사람이다.',
    formula:
      '① 개념 하나를 붙잡고 시작한다(덜어냄, 기다림, 소유). ② 서로 당기는 두 관점을 나란히 놓는다(비움과 고름). ③ 개념을 내 일상의 장면으로 끌어내린다(서랍, 장바구니, 새벽). ④ 쉽게 결론내지 않고 질문을 남긴다. ⑤ 개념어는 한 챕터에 하나만 쓴다.',
    titles:
      '개념어 + 변주(“비움과 고름”, “남긴다는 것의 무게”). 4~12자. 개념을 설명하는 명사 나열을 피한다.',
    rhythm:
      '① 일상의 장면 ② 그 장면에서 떠오른 개념 ③ 개념을 둘러싼 두 관점 ④ 내 삶에 적용해 본 한 문장 ⑤ 질문 하나',
    ban:
      '철학자 이름을 나열해 권위를 만드는 것, 내 기록에 없는 인용, “본질적으로”, “~란 무엇인가”의 반복, 결론 강요.',
    deliver: 'H1 책 제목, H2 챕터 5~6개, 각 챕터 마지막에 질문 1개.',
  },
  fiction: {
    name: '소설 · 창작',
    reader:
      '짧은 소설을 좋아하는 독자. 설명된 감정이 아니라 장면에서 저절로 올라오는 감정을 원하는 사람이다.',
    formula:
      '① 기록을 사실이 아니라 재료로 쓴다. 인물을 새로 만든다(이름 하나, 욕망 하나, 결핍 하나). ② 각 기록을 장면으로 다시 배치한다(누가, 어디서, 무엇을 하다가). ③ 욕망이 좌절되고 인물이 선택하는 순간을 책의 중심에 둔다. ④ 감각을 쓴다(냄새, 소리, 온도, 손끝). ⑤ 결말은 설명하지 않고 마지막 행동으로 남긴다.',
    titles:
      '명사구로 쓴다(“빌린 우산”, “새벽 배송”). 인물·사물·장소의 이름. 줄거리를 설명하는 제목은 쓰지 않는다.',
    rhythm:
      '① 장면(누가 어디서) ② 인물이 원하는 것과 막는 것 ③ 대사 한 번 ④ 감각 디테일 ⑤ 장면을 닫는 행동',
    ban:
      '감정 요약(“그는 슬펐다”), 갑작스러운 결말, 실제 가족·아이를 실명으로 등장시키는 것(관계와 이름을 바꿔 익명화한다), 서술자가 인물을 설명하는 소개.',
    deliver: 'H1 책 제목, H2 챕터 5~8개(장면 5~8개), 각 장면 800~1,500자.',
  },
};

function buildGenrePrompt(genreId, ctx = {}) {
  const g = GENRE_PROMPTS[genreId] || GENRE_PROMPTS.essay;
  const isStudio = ctx.mode === 'studio';
  const books = Math.max(1, ctx.bookCount || 1);
  const photos = ctx.photos || 0;
  const notes = ctx.notes || 0;
  const out = [];

  out.push(`## 🤖 AI 창작 프롬프트 — ${g.name} (여기까지 함께 복사해 ChatGPT·Claude에 붙여넣으세요)`);
  out.push('');
  out.push('### 0. 역할');
  out.push(
    `너는 한국에서 ${g.name} 분야의 베스트셀러·스테디셀러를 20년 넘게 기획해 온 프로 편집자다. 100만 부가 넘는 책의 목차와 도입부를 직접 다듬었고, 무엇이 독자를 3페이지 안에 붙잡고 무엇이 30페이지에서 이탈시키는지 안다. 지금부터 아래 재료만 가지고, 내 목소리로 한 권의 책을 만든다.`
  );
  out.push('');
  out.push('### 1. 재료');
  out.push(
    isStudio
      ? `위는 내가 ${books}권의 책을 읽으며 남긴 기록을 엮은 원고다. 재료: 책 ${books}권 · 밑줄 사진 ${photos}장 · 나의 언어 ${notes}편.`
      : `위는 내가 한 권의 책을 읽으며 남긴 기록이다. 재료: 책 1권 · 밑줄 사진 ${photos}장 · 나의 언어 ${notes}편.`
  );
  out.push(
    '재료는 위에 적힌 기록뿐이다. 없는 사실·사건·인용을 만들지 않는다. 인용은 위에 적힌 문장만 쓴다. 기록이 얇은 곳은 추측으로 채우지 말고, 기록에 있는 다른 장면으로 대체하거나 [여기에 내 경험 한 문장]처럼 빈칸으로 남긴다. 내가 실제로 쓴 표현과 고유명사(아이 이름, 지명, 물건)는 그대로 살린다.'
  );
  out.push('');
  out.push('### 2. 이 책의 자리 (타깃 독자 · 약속)');
  out.push(g.reader);
  out.push('이 독자가 서점에서 이 책을 집어 들었을 때, 30초 안에 “내 이야기다”라고 느끼게 만드는 것이 이 책의 일이다.');
  out.push('');
  out.push('### 3. 성공 공식 — 이 장르에서 독자가 끝까지 읽는 이유');
  out.push(g.formula);
  out.push('');
  out.push('### 4. 목차 설계');
  out.push(g.titles);
  out.push('챕터는 5~7개. 각 챕터 제목 아래에 어떤 기록(어느 책의 어떤 밑줄·메모)을 배치할지 명시한다. 도입부 챕터에서는 독자가 이 책을 끝까지 읽어야 할 이유를 한 문장으로 약속하고, 마지막 챕터에서는 그 약속을 회수한다.');
  out.push('');
  out.push('### 5. 챕터 하나의 리듬 (모든 챕터가 같은 리듬을 탄다)');
  out.push(g.rhythm);
  out.push('첫 문장은 요약이 아니라 장면이다. 훅은 20자 안팎의 한 줄로 끊고, “요즘”, “최근에” 같은 도입을 쓰지 않는다. 챕터 안에서 밑줄 문장은 한 번만, 문단과 분리해 한 줄로 놓는다.');
  out.push('');
  out.push('### 6. 문체 규칙');
  out.push(
    '화자는 나다. 1인칭으로 쓰고 “우리는”으로 일반화하지 않는다. 한 문장은 60자 안팎, 한 문단은 3~5문장. 긴 문장 다음에는 짧은 문장을 놓고, 같은 길이의 문장을 세 번 연속 쓰지 않는다. 형용사 대신 동작과 사물로 쓴다(설명하지 말고 보여준다). 숫자·시간·고유명사를 넣어 장면을 구체적으로 만든다.'
  );
  out.push('');
  out.push('### 7. 금지 목록');
  out.push(
    '“결론적으로”, “요약하자면”, “살펴보겠습니다”, “~라고 할 수 있습니다”, “~에 대해 알아보겠습니다”, “다양한 측면에서”, “긍정적인 영향을 미칩니다”, “시사하는 바가 큽니다”, “작은 변화가 큰 차이를 만듭니다”, “진정한”, “본질적으로”, “한마디로” — 이런 문장이 나오면 지우고 다시 쓴다. 이모지와 느낌표는 쓰지 않는다. 감정을 형용사로 먼저 말하지 않는다.'
  );
  out.push(g.ban);
  out.push('');
  out.push(isStudio ? '### 8. 여러 책 교차 편집 (신테시스)' : '### 8. 한 권 안의 재배치');
  out.push(
    isStudio
      ? '책마다 한 챕터씩 배분하지 말고 주제별로 재배치한다. 한 챕터 안에서 A책의 장면 → B책의 개념 → 내 삶의 결론 순으로 교차하고, 인용에는 출처 책 제목을 붙인다. 책들 사이에서 반복되는 단어와 감정을 연결어로 삼는다. 기록이 겹치면 가장 구체적인 장면 하나만 남긴다. 책 순서는 내가 고른 순서를 존중하되, 흐름상 더 나은 순서가 있으면 이유와 함께 제안한다.'
      : '한 권 안에서도 시간순으로 늘어놓지 말고 주제별로 재배치한다. 같은 이야기가 두 번 나오면 한 번만 남긴다. 기록이 많은 주제는 두 챕터로 나누고, 기록이 없는 주제는 챕터로 만들지 않는다.'
  );
  out.push('');
  out.push('### 9. 진행 방식과 출력 형식');
  out.push(
    '바로 본문을 쓰지 말고 두 단계로 간다. 1단계: 책 제목 후보 5개 + 한 줄 소개(20자) + 타깃 독자 1문장 + 목차(챕터 제목과 각 챕터에 들어갈 내 기록 지정)만 제시하고 멈춘다. 내가 고르거나 고치면 2단계에서 챕터 본문을 쓴다. 마크다운으로 쓰고 H1은 책 제목, H2는 챕터다. 표는 쓰지 않는다.'
  );
  out.push(g.deliver);
  out.push('');
  out.push('### 10. 마지막 자체 검수');
  out.push(
    '답을 내기 전에 스스로 점검하고, 통과하지 못한 항목은 고친 뒤에 답한다. ① 첫 문장이 요약이 아니라 장면인가? ② 챕터 제목만 이어 읽어도 흐름이 보이는가? ③ 내가 쓰지 않은 사실·인용이 들어갔는가? ④ 같은 문장 구조가 세 번 반복되는가? ⑤ 챕터마다 밑줄 문장이 하나씩 있는가? ⑥ 마지막이 요약이 아니라 여운이나 다음 행동으로 끝나는가? 그리고 마지막에 “고칠 곳 3가지”를 스스로 지적한다.'
  );

  return out.join('\n');
}

function genreName(genreId) {
  return (GENRE_PROMPTS[genreId] || GENRE_PROMPTS.essay).name;
}

function renderGenreChips(el, current) {
  if (!el) return;
  el.innerHTML = '';
  GENRES.forEach((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'genre-chip' + (g.id === current ? ' is-active' : '');
    b.dataset.genre = g.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', g.id === current ? 'true' : 'false');
    b.textContent = g.label;
    el.appendChild(b);
  });
}

function setGenre(where, genreId) {
  if (!GENRE_PROMPTS[genreId]) return;
  if (where === 'studio') {
    state.genreStudio = genreId;
    renderGenreChips($('#studioGenreChips'), genreId);
    renderStudioPreview();
  } else {
    state.genreBook = genreId;
    renderGenreChips($('#bookGenreChips'), genreId);
    renderBookPreview();
  }
  toast(`프롬프트를 ‘${genreName(genreId)}’ 장르로 바꿨어요.`);
}

function buildBookMarkdown(book, { includePrompt = true, genre = state.genreBook } = {}) {
  const photos = photosOf(book.id);
  const notes = notesOf(book.id);
  const lines = [];
  lines.push(`# ${book.title}`);
  if (book.author) lines.push(`**${book.author}**`);
  lines.push(`_${fmtDate(book.createdAt)}부터의 기록 · 밑줄 사진 ${photos.length}장 · 나의 언어 ${notes.length}편_`);
  if (book.summary && book.summary.trim()) {
    lines.push('', '## 이 책에 대하여', book.summary.trim());
  }
  if (photos.length) {
    lines.push('', '## 밑줄과 사진', '', photoLines(photos));
  }
  if (notes.length) {
    lines.push('', '## 나의 언어', '', noteBlock(notes));
  }
  if (!photos.length && !notes.length) {
    lines.push('', '_아직 남긴 기록이 없어요._');
  }
  if (includePrompt)
    lines.push('', '---', '', buildGenrePrompt(genre, { mode: 'book', bookCount: 1, photos: photos.length, notes: notes.length }));
  return lines.join('\n');
}

function buildStudioMarkdown({ title, intent, epilogue, books, includePrompt = true, genre = state.genreStudio }) {
  const all = books.map((b) => ({ book: b, photos: photosOf(b.id), notes: notesOf(b.id) }));
  const totalPhotos = all.reduce((s, x) => s + x.photos.length, 0);
  const totalNotes = all.reduce((s, x) => s + x.notes.length, 0);
  const lines = [];
  lines.push(`# ${title || '제목 없는 엮은 책'}`);
  lines.push(`_${books.length}권의 책에서 길어 올린 나의 기록 · ${fmtDate(Date.now())} 엮음 · 밑줄 ${totalPhotos}장 · 나의 언어 ${totalNotes}편_`);
  if (intent && intent.trim()) lines.push('', '## 기획 의도', intent.trim());

  lines.push('', '## 목차');
  all.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.book.title}${x.book.author ? ' — ' + x.book.author : ''} (밑줄 ${x.photos.length} · 언어 ${x.notes.length})`);
  });

  all.forEach((x, i) => {
    lines.push('', '---', '', `## ${i + 1}. ${x.book.title}`);
    if (x.book.author) lines.push(`**${x.book.author}**`);
    if (x.book.summary && x.book.summary.trim()) lines.push('', x.book.summary.trim());
    if (x.photos.length) lines.push('', '### 밑줄과 사진', '', photoLines(x.photos, 4));
    if (x.notes.length) lines.push('', '### 나의 언어', '', noteBlock(x.notes, 4));
    if (!x.photos.length && !x.notes.length) lines.push('', '_이 책에는 아직 기록이 없어요._');
  });

  if (epilogue && epilogue.trim()) lines.push('', '---', '', '## 에필로그', epilogue.trim());
  if (includePrompt)
    lines.push(
      '',
      '---',
      '',
      buildGenrePrompt(genre, { mode: 'studio', bookCount: books.length, photos: totalPhotos, notes: totalNotes })
    );
  return lines.join('\n');
}

function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(md) {
  const lines = String(md).split('\n');
  let html = '';
  let para = [];
  let listType = null;
  const flushPara = () => {
    if (para.length) {
      html += '<p>' + inlineMd(para.join('\n')) + '</p>';
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^####\s+/.test(line)) { flushPara(); closeList(); html += '<h4>' + inlineMd(line.slice(5)) + '</h4>'; }
    else if (/^###\s+/.test(line)) { flushPara(); closeList(); html += '<h3>' + inlineMd(line.slice(4)) + '</h3>'; }
    else if (/^##\s+/.test(line)) { flushPara(); closeList(); html += '<h2>' + inlineMd(line.slice(3)) + '</h2>'; }
    else if (/^#\s+/.test(line)) { flushPara(); closeList(); html += '<h1>' + inlineMd(line.slice(2)) + '</h1>'; }
    else if (/^---+\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; }
    else if (/^>\s?/.test(line)) { flushPara(); closeList(); html += '<blockquote>' + inlineMd(line.replace(/^>\s?/, '')) + '</blockquote>'; }
    else if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += '<li>' + inlineMd(line.replace(/^[-*]\s+/, '')) + '</li>';
    } else if (/^\d+\.\s+/.test(line)) {
      flushPara();
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += '<li>' + inlineMd(line.replace(/^\d+\.\s+/, '')) + '</li>';
    } else if (!line.trim()) { flushPara(); closeList(); }
    else { closeList(); para.push(line); }
  }
  flushPara();
  closeList();
  return html;
}

async function copyText(text, okMsg) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(okMsg || '복사했어요. ChatGPT에 붙여넣어 보세요.');
  } catch (e) {
    toast('복사하지 못했어요. 파일로 내려받아 주세요.');
  }
}

function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('파일을 내려받았어요.');
}

function currentBookMarkdown() {
  const book = bookById(state.currentBookId);
  if (!book) return '';
  return buildBookMarkdown(book, { includePrompt: $('#includePromptBook').checked, genre: state.genreBook });
}

function renderBookPreview() {
  const book = bookById(state.currentBookId);
  if (!book) return;
  const md = currentBookMarkdown();
  const box = $('#bookPreview');
  if (box) box.innerHTML = renderMarkdown(md);
  const photos = photosOf(book.id).length;
  const notes = notesOf(book.id).length;
  const stat = $('#bookPreviewStat');
  if (stat) stat.textContent = `${photos + notes}개 기록 · ${md.length.toLocaleString('ko-KR')}자`;
}

/* ---------------- studio ---------------- */
function enterWeaveMode() {
  if (!state.books.length) {
    toast('먼저 책을 한 권 추가해 주세요.');
    return;
  }
  state.weaveMode = true;
  state.selection.clear();
  renderShelf();
  updateSelectionBar();
  toast('책을 눌러 엮고 싶은 책을 골라보세요. 여러 권도 좋아요.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitWeaveMode() {
  state.weaveMode = false;
  state.selection.clear();
  renderShelf();
  updateSelectionBar();
}

function showStudio(fromSelection = true) {
  if (fromSelection) {
    state.studioBooks = state.books.filter((b) => state.selection.has(b.id)).map((b) => b.id);
  }
  if (!state.studioBooks.length) {
    toast('먼저 엮을 책을 골라주세요.');
    location.hash = '#shelf';
    state.weaveMode = true;
    showShelf();
    updateSelectionBar();
    return;
  }
  $('#view-shelf').hidden = true;
  $('#view-book').hidden = true;
  $('#view-studio').hidden = false;
  document.title = '내 책 엮기 — 내 서재';
  renderStudio();
  window.scrollTo({ top: 0 });
}

function renderStudio() {
  const list = $('#studioBooks');
  list.innerHTML = '';
  state.studioBooks.forEach((id, i) => {
    const book = bookById(id);
    if (!book) return;
    const li = document.createElement('li');
    const idx = document.createElement('span');
    idx.className = 'sb-index';
    idx.textContent = String(i + 1);
    const title = document.createElement('span');
    title.className = 'sb-title';
    title.textContent = `${book.title}${book.author ? ' · ' + book.author : ''}`;
    const ctrl = document.createElement('div');
    ctrl.className = 'sb-ctrl';
    const up = document.createElement('button');
    up.type = 'button'; up.textContent = '↑'; up.title = '위로'; up.dataset.move = 'up'; up.dataset.id = id;
    const down = document.createElement('button');
    down.type = 'button'; down.textContent = '↓'; down.title = '아래로'; down.dataset.move = 'down'; down.dataset.id = id;
    const rm = document.createElement('button');
    rm.type = 'button'; rm.textContent = '✕'; rm.title = '빼기'; rm.dataset.move = 'remove'; rm.dataset.id = id;
    ctrl.append(up, down, rm);
    li.append(idx, title, ctrl);
    list.appendChild(li);
  });
  $('#studioCount').textContent = `${state.studioBooks.length}권`;
  if (!$('#studioTitle').value) {
    $('#studioTitle').value = state.studioBooks.map((id) => bookById(id)?.title).filter(Boolean).slice(0, 2).join(' · ');
  }
  renderStudioPreview();
}

function studioBooksArray() {
  return state.studioBooks.map((id) => bookById(id)).filter(Boolean);
}

function renderStudioPreview() {
  const books = studioBooksArray();
  const md = buildStudioMarkdown({
    title: $('#studioTitle').value.trim(),
    intent: $('#studioIntent').value,
    epilogue: $('#studioEpilogue').value,
    books,
    includePrompt: $('#includePromptStudio').checked,
    genre: state.genreStudio,
  });
  $('#studioPreview').innerHTML = renderMarkdown(md);
  $('#studioStat').textContent = `${books.length}권 · ${md.length.toLocaleString('ko-KR')}자`;
  state.studioMarkdownCache = md;
}

function moveStudioBook(delta, id) {
  const i = state.studioBooks.indexOf(id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= state.studioBooks.length) return;
  [state.studioBooks[i], state.studioBooks[j]] = [state.studioBooks[j], state.studioBooks[i]];
  renderStudio();
}
function removeStudioBook(id) {
  state.studioBooks = state.studioBooks.filter((x) => x !== id);
  if (!state.studioBooks.length) {
    state.weaveMode = true;
    location.hash = '#shelf';
    toast('엮을 책을 다시 골라주세요.');
    return;
  }
  renderStudio();
}

/* ============================================================
   STORAGE / BACKUP
   ============================================================ */
async function refreshStorageChip() {
  const chip = $('#storageChipText');
  const photoBytes = state.photos.reduce((s, p) => s + (p.bytes || 0), 0);
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (!est) {
      if (chip) chip.textContent = `사진 ${state.photos.length}장`;
      return;
    }
    if (chip) chip.textContent = `사진 ${state.photos.length}장 · ${fmtBytes(est.usage)}`;
    return est;
  } catch (_) {
    if (chip) chip.textContent = `사진 ${state.photos.length}장 · ${fmtBytes(photoBytes)}`;
  }
}

async function refreshStoragePanel() {
  const line = $('#storageLine');
  const fill = $('#meterFill');
  const stats = $('#storageStats');
  const note = $('#persistNote');
  const photoBytes = state.photos.reduce((s, p) => s + (p.bytes || 0), 0);
  let persisted = false;
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (_) {}

  let est = null;
  try {
    if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate();
  } catch (_) {}

  stats.innerHTML = `
    <div class="stat"><strong>${state.books.length}</strong>권의 책</div>
    <div class="stat"><strong>${state.photos.length}</strong>장의 사진 (${fmtBytes(photoBytes)})</div>
    <div class="stat"><strong>${state.notes.length}</strong>편의 기록</div>
    <div class="stat"><strong>${persisted ? '영구' : '일반'}</strong>보관 등급</div>`;

  if (est && est.quota) {
    const pct = (est.usage / est.quota) * 100;
    fill.style.width = Math.max(1.5, Math.min(100, pct)).toFixed(1) + '%';
    fill.classList.toggle('warn', pct > 80);
    line.textContent = `사용 ${fmtBytes(est.usage)} / 여유 약 ${fmtBytes(est.quota - est.usage)} (전체 ${fmtBytes(est.quota)})`;
    note.textContent = persisted
      ? '이 기기에 영구 보관되도록 허용되어 있어요. 브라우저가 임의로 지우지 않아요.'
      : '영구 보관을 허용하면 저장공간이 부족해질 때 브라우저가 서재를 임의로 지우지 않아요.';
  } else {
    fill.style.width = '4%';
    line.textContent = `이 브라우저는 저장공간 정보를 제공하지 않아요. 사진 ${state.photos.length}장(${fmtBytes(photoBytes)})이 저장되어 있어요.`;
    note.textContent = '';
  }
  $('#persistBtn').disabled = persisted;
  $('#persistBtn').textContent = persisted ? '이미 영구 보관 중' : '이 기기에 영구 보관 허용';
}

async function requestPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) {
      toast('이 브라우저는 영구 보관을 지원하지 않아요.');
      return;
    }
    const granted = await navigator.storage.persist();
    toast(granted ? '영구 보관이 허용됐어요. 안심하고 모아두세요.' : '브라우저가 허용하지 않았어요. 홈 화면에 추가하면 더 안정적이에요.');
    refreshStoragePanel();
    refreshStorageChip();
  } catch (e) {
    toast('영구 보관 요청에 실패했어요: ' + e.message);
  }
}

async function backupJSON() {
  const btn = $('#backupBtn');
  const note = $('#backupNote');
  btn.disabled = true;
  btn.textContent = '준비 중…';
  try {
    const photos = [];
    for (const p of state.photos) {
      const rec = await dbGet('blobs', p.id);
      photos.push({ ...p, data: rec ? await blobToDataURL(rec.blob) : null });
    }
    const payload = {
      app: 'nae-seoje',
      version: 1,
      exportedAt: new Date().toISOString(),
      books: state.books,
      photos,
      notes: state.notes,
    };
    const json = JSON.stringify(payload);
    downloadText(`nae-seoje-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
    note.textContent = `백업 완료 · 책 ${state.books.length}권 · 사진 ${photos.length}장 · ${fmtBytes(json.length)}`;
  } catch (e) {
    note.textContent = '백업 실패: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'JSON 백업 내려받기';
  }
}

async function restoreJSON(file) {
  if (!file) return;
  const note = $('#backupNote');
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.books)) throw new Error('서재 백업 파일이 아니에요.');
    const ok = confirm(
      `백업 파일을 불러옵니다.\n책 ${payload.books.length}권 · 사진 ${(payload.photos || []).length}장 · 기록 ${(payload.notes || []).length}편\n현재 서재에 더할까요?`
    );
    if (!ok) return;
    let added = 0;
    for (const b of payload.books) {
      if (!b.id || !b.title) continue;
      await dbPut('books', b);
      added++;
    }
    for (const n of payload.notes || []) await dbPut('notes', n);
    for (const p of payload.photos || []) {
      const { data, ...meta } = p;
      await dbPut('photos', meta);
      if (data) await dbPut('blobs', { id: meta.id, blob: dataURLToBlob(data) });
    }
    await reloadAll();
    renderShelf();
    refreshStoragePanel();
    refreshStorageChip();
    if (state.currentBookId && bookById(state.currentBookId)) renderBook();
    note.textContent = `복원 완료 · 책 ${added}권을 더했어요.`;
    toast('백업을 복원했어요.');
  } catch (e) {
    note.textContent = '복원 실패: ' + e.message;
    toast('백업 파일을 읽지 못했어요.');
  } finally {
    $('#restoreFile').value = '';
  }
}

async function resetAll() {
  if (!confirm('서재의 모든 책·사진·기록을 지웁니다. 되돌릴 수 없어요.\n정말 지울까요?')) return;
  if (!confirm('마지막 확인: 백업하지 않은 기록은 사라져요. 그래도 지울까요?')) return;
  for (const s of STORES) await dbClear(s);
  urlCache.forEach((u) => URL.revokeObjectURL(u));
  urlCache.clear();
  state.books = [];
  state.photos = [];
  state.notes = [];
  state.selection.clear();
  state.weaveMode = false;
  state.currentBookId = null;
  $('#settingsDialog').close();
  location.hash = '#shelf';
  showShelf();
  refreshStorageChip();
  toast('서재를 비웠어요.');
}

/* ============================================================
   SAMPLE LIBRARY
   ============================================================ */
function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function quoteImageBlob(quote, source, page) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1200, 1500);
  bg.addColorStop(0, '#FBFAF6');
  bg.addColorStop(1, '#EFEAE0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 1500);
  ctx.strokeStyle = 'rgba(17,17,17,.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(72, 72, 1056, 1356);
  ctx.fillStyle = '#111111';
  ctx.font = '500 26px "Inter", "Noto Sans CJK KR", sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.fillText('UNDERLINE', 130, 196);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.strokeStyle = 'rgba(17,17,17,.22)';
  ctx.beginPath();
  ctx.moveTo(130, 232);
  ctx.lineTo(230, 232);
  ctx.stroke();
  ctx.fillStyle = '#111111';
  ctx.font = '300 58px "Noto Serif CJK KR", "Noto Serif KR", "Nanum Myeongjo", serif';
  const lines = wrapCanvasText(ctx, quote, 900);
  const lineH = 96;
  let y = 620 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l) => {
    ctx.fillText(l, 130, y);
    y += lineH;
  });
  ctx.fillStyle = '#85827A';
  ctx.font = '400 30px "Inter", "Noto Sans CJK KR", sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText(`${source}${page ? ' · p. ' + page : ''}`, 130, 1330);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return blob;
}

async function addSampleLibrary() {
  const now = Date.now();
  const day = 86400000;
  const samples = [
    {
      title: '덜어냄 연습',
      author: '한서윤',
      color: 4,
      summary: '많이 갖는 것이 아니라, 남길 것을 고르는 일에 대한 책. 읽고 나서 서랍 두 개를 비웠다.',
      notes: [
        { text: '덜어낸다는 건 비우는 게 아니라 고르는 일이다. 오늘 책상 위에서 손이 세 번 멈췄던 물건들을 떠올렸다.', day: 9 },
        { text: '아이 방 장난감도 이 기준으로 다시 보자. "언젠가 쓸 것"은 대부분 오지 않는다.', day: 4 },
      ],
      photos: [
        { quote: '덜어냄은 비움이 아니라 선택이다.', page: 128, caption: '여기서 한참 멈춰 있었다.', isQuote: true },
        { quote: '우리는 소유한 것만큼 관리해야 할 것을 갖는다.', page: 74, caption: '서랍을 열어본 날.' },
      ],
    },
    {
      title: '저녁의 문장들',
      author: '윤재하',
      color: 1,
      summary: '하루의 끝에 남는 문장들. 잠들기 전에 한 페이지씩 읽었다.',
      notes: [{ text: '잘 쉬는 것도 연습이 필요하다는 말이 오래 남았다. 나는 쉬는 시간에도 뭔가를 하고 있었다.', day: 6 }],
      photos: [{ quote: '아무것도 하지 않는 저녁이 하루를 완성한다.', page: 201, caption: '지민이 재운 뒤 읽은 페이지.' }],
    },
    {
      title: '작은 습관의 방향',
      author: '이도현',
      color: 0,
      summary: '습관은 의지가 아니라 환경의 문제라는 이야기. 현관에 운동화를 두었다.',
      notes: [{ text: '의지가 아니라 환경. 현관에 운동화를 꺼내 놓는 것만으로 아침이 조금 달라졌다.', day: 2 }],
      photos: [{ quote: '환경은 조용히 이긴다.', page: 41, caption: '현관 신발장 앞에서.' }],
    },
  ];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const bookId = uid();
    const createdAt = now - (12 - i * 3) * day;
    const book = {
      id: bookId,
      title: s.title,
      author: s.author,
      color: s.color,
      coverData: null,
      summary: s.summary,
      createdAt,
      updatedAt: now - i * day,
    };
    await dbPut('books', book);
    state.books.push(book);

    for (const n of s.notes) {
      const note = {
        id: uid(),
        bookId,
        text: n.text,
        source: Math.random() > 0.5 ? 'voice' : 'text',
        createdAt: now - n.day * day,
        updatedAt: now - n.day * day,
      };
      await dbPut('notes', note);
      state.notes.push(note);
    }
    for (const p of s.photos) {
      const blob = await quoteImageBlob(p.quote, s.title, p.page);
      const meta = {
        id: uid(),
        bookId,
        page: p.page,
        caption: p.caption,
        isQuote: !!p.isQuote,
        width: 1200,
        height: 1500,
        bytes: blob.size,
        type: 'image/jpeg',
        createdAt: now - 5 * day,
      };
      await dbPut('photos', meta);
      await dbPut('blobs', { id: meta.id, blob });
      state.photos.push(meta);
    }
  }
  renderShelf();
  refreshStorageChip();
  toast('샘플 서재 3권을 채웠어요. 예시 기록이니 지우고 쓰셔도 돼요.');
}

/* ============================================================
   EVENTS
   ============================================================ */
function wireEvents() {
  // routing
  window.addEventListener('hashchange', routeFromHash);
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => (location.hash = '#shelf')));

  // shelf
  $('#addBookBtn').addEventListener('click', () => openBookDialog());
  $('#searchInput').addEventListener('input', debounce(renderShelf, 120));
  $('#sortSelect').addEventListener('change', renderShelf);
  $('#weaveBtn').addEventListener('click', () => (state.weaveMode ? exitWeaveMode() : enterWeaveMode()));
  $('#sampleBtn').addEventListener('click', addSampleLibrary);
  window.addEventListener('resize', debounce(fillLastShelfRow, 160));

  $('#shelfGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.book-card');
    if (!card) return;
    const id = card.dataset.id;
    if (state.weaveMode) toggleSelection(id);
    else location.hash = '#book/' + id;
  });

  $('#shelfEmpty').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="add"]')) openBookDialog();
  });

  // selection bar
  $('#selectionCancel').addEventListener('click', exitWeaveMode);
  $('#selectionGo').addEventListener('click', () => {
    if (!state.selection.size) return;
    state.weaveMode = false;
    updateSelectionBar();
    location.hash = '#studio';
    showStudio(true);
    state.selection.clear();
    renderShelf();
  });

  // book dialog
  $('#bookForm').addEventListener('submit', submitBook);
  $('#bookTitleInput').addEventListener('input', paintCoverPreview);
  $('#bookAuthorInput').addEventListener('input', paintCoverPreview);
  $('#coverFile').addEventListener('change', (e) => handleCoverFile(e.target.files[0]));
  $('#coverClear').addEventListener('click', () => {
    state.coverDraft = null;
    paintCoverPreview();
  });
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    state.coverColor = Number(b.dataset.color);
    renderSwatches();
    paintCoverPreview();
  });

  // book view
  $$('.tabs .tab').forEach((t) =>
    t.addEventListener('click', () => {
      switchTab(t.dataset.tab);
      if (t.dataset.tab === 'export') renderBookPreview();
    })
  );
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit-book]')) openBookDialog(bookById(state.currentBookId));
    if (e.target.closest('[data-delete-book]')) deleteBook();
    if (e.target.closest('[data-add-photo]')) openPhotoDialog();
  });

  $('#photoFile').addEventListener('change', (e) => handlePhotoFile(e.target.files[0]));
  $('#cameraFile').addEventListener('change', (e) => handlePhotoFile(e.target.files[0]));
  $('#photoForm').addEventListener('submit', submitPhoto);
  const zone = $('#uploadZone');
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('is-drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag');
    })
  );
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.[0]) handlePhotoFile(e.dataTransfer.files[0]);
  });

  // lightbox
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbPrev').addEventListener('click', () => lightboxNav(-1));
  $('#lbNext').addEventListener('click', () => lightboxNav(1));
  $('#lbImage').addEventListener('click', () => $('#lbImage').classList.toggle('zoom'));
  $('#lbDelete').addEventListener('click', deleteCurrentPhoto);
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
  });

  // notes
  $('#saveNoteBtn').addEventListener('click', saveNote);
  $('#micBtn').addEventListener('click', toggleSpeech);
  $('#noteList').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-note]');
    const del = e.target.closest('[data-delete-note]');
    if (edit) {
      const note = state.notes.find((n) => n.id === edit.dataset.editNote);
      if (note) setNoteEditing(note);
    }
    if (del) deleteNote(del.dataset.deleteNote);
  });
  $('#noteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.editingNoteId) resetNoteEditor();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveNote();
  });

  // book export
  const saveSummary = debounce(async (bookId, value) => {
    const book = bookById(bookId);
    if (!book) return;
    book.summary = value;
    book.updatedAt = Date.now();
    await dbPut('books', book);
    if (state.currentBookId === bookId) renderBookPreview();
  }, 400);
  $('#bookSummary').addEventListener('input', (e) => saveSummary(state.currentBookId, e.target.value));
  $('#includePromptBook').addEventListener('change', renderBookPreview);
  renderGenreChips($('#bookGenreChips'), state.genreBook);
  renderGenreChips($('#studioGenreChips'), state.genreStudio);
  $('#bookGenreChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-genre]');
    if (chip) setGenre('book', chip.dataset.genre);
  });
  $('#studioGenreChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-genre]');
    if (chip) setGenre('studio', chip.dataset.genre);
  });
  document.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      if (copy.dataset.copy === 'book') copyText(currentBookMarkdown());
      else copyText(buildStudioMarkdown(studioPayload()), '엮은 원고를 복사했어요.');
      return;
    }
    const dl = e.target.closest('[data-download]');
    if (dl) {
      const ext = dl.dataset.ext;
      if (dl.dataset.download === 'book') {
        const book = bookById(state.currentBookId);
        if (!book) return;
        downloadText(`${sanitizeFilename(book.title)}.${ext}`, currentBookMarkdown(), ext === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8');
      } else {
        const payload = studioPayload();
        downloadText(`${sanitizeFilename(payload.title || '엮은 책')}.${ext}`, buildStudioMarkdown(payload), ext === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8');
      }
    }
  });

  // studio
  $('#studioTitle').addEventListener('input', debounce(renderStudioPreview, 200));
  $('#studioIntent').addEventListener('input', debounce(renderStudioPreview, 200));
  $('#studioEpilogue').addEventListener('input', debounce(renderStudioPreview, 200));
  $('#includePromptStudio').addEventListener('change', renderStudioPreview);
  $('#studioBooks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    const { move, id } = b.dataset;
    if (move === 'up') moveStudioBook(-1, id);
    else if (move === 'down') moveStudioBook(1, id);
    else removeStudioBook(id);
  });
  $('#addMoreBooks').addEventListener('click', () => {
    state.weaveMode = true;
    state.studioBooks.forEach((id) => state.selection.add(id));
    location.hash = '#shelf';
    showShelf();
    updateSelectionBar();
    toast('책을 더 골라주세요. 이미 고른 책도 표시되어 있어요.');
  });

  // settings
  $('#settingsBtn').addEventListener('click', () => openSettings());
  $('#storageChip').addEventListener('click', () => openSettings());
  $('#persistBtn').addEventListener('click', requestPersist);
  $('#refreshStorageBtn').addEventListener('click', () => {
    refreshStoragePanel();
    refreshStorageChip();
    toast('저장공간을 다시 확인했어요.');
  });
  $('#backupBtn').addEventListener('click', backupJSON);
  $('#restoreFile').addEventListener('change', (e) => restoreJSON(e.target.files[0]));
  $('#resetBtn').addEventListener('click', resetAll);

  // dialog close buttons
  $$('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = b.closest('dialog');
      if (d) d.close();
    })
  );
  ['bookDialog', 'photoDialog', 'settingsDialog'].forEach((id) => {
    const d = document.getElementById(id);
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  });
  $('#photoDialog').addEventListener('close', resetPhotoDialog);
}

function studioPayload() {
  return {
    title: $('#studioTitle').value.trim(),
    intent: $('#studioIntent').value,
    epilogue: $('#studioEpilogue').value,
    books: studioBooksArray(),
    includePrompt: $('#includePromptStudio').checked,
    genre: state.genreStudio,
  };
}

async function openSettings() {
  if (!$('#settingsDialog').open) $('#settingsDialog').showModal();
  await refreshStoragePanel();
  $('#backupNote').textContent = '';
}

async function deleteBook() {
  const book = bookById(state.currentBookId);
  if (!book) return;
  const pc = photosOf(book.id).length;
  const nc = notesOf(book.id).length;
  if (!confirm(`「${book.title}」을 서재에서 뺄까요?\n사진 ${pc}장과 기록 ${nc}편도 함께 지워지고, 되돌릴 수 없어요.`)) return;
  for (const p of photosOf(book.id)) {
    await dbDelete('photos', p.id);
    await dbDelete('blobs', p.id);
    dropPhotoURL(p.id);
  }
  for (const n of notesOf(book.id)) await dbDelete('notes', n.id);
  await dbDelete('books', book.id);
  await reloadAll();
  state.currentBookId = null;
  location.hash = '#shelf';
  showShelf();
  refreshStorageChip();
  toast('책을 서재에서 뺐어요.');
}

/* ============================================================
   BOOT
   ============================================================ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  wireEvents();
  ensureCancelEditBtn();
  if (!speechSupported()) {
    $('#micBtn').disabled = true;
    $('#micLabel').textContent = '음성 입력 미지원';
    $('#micBtn').title = '이 브라우저는 음성 입력을 지원하지 않아요.';
    setSpeechStatus('이 브라우저는 음성 입력(SpeechRecognition)을 지원하지 않아요. 타이핑으로 남겨주세요.');
  }
  try {
    await openDB();
    await reloadAll();
  } catch (e) {
    console.error(e);
    toast('저장소를 열지 못했어요: ' + e.message, 6000);
  }
  routeFromHash();
  if (!location.hash) showShelf();
  refreshStorageChip();
  registerSW();
}

document.addEventListener('DOMContentLoaded', boot);

/* expose a tiny hook for automated checks */
window.__seoje = {
  state,
  buildBookMarkdown,
  buildStudioMarkdown,
  renderShelf,
  photosOf,
  notesOf,
  openBook,
  showStudio,
  addSampleLibrary,
  refreshStoragePanel,
};
