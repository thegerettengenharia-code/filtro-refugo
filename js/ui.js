/* =============================================================================
 * ui.js — interface do Filtro de Refugo
 * Vanilla JS. Depende de core.js (RefugoCore) e de vendor/xlsx.full.min.js.
 * ========================================================================== */
(function () {
  'use strict';

  var C = window.RefugoCore;
  var XLSX = window.XLSX;
  var ROW_H = 38;
  var HEAD_H = 44;
  var OVERSCAN = 6;
  var ED_ROW_H = 42;
  var ED_HEAD_H = 56;
  var ED_OVERSCAN = 6;
  var MAX_FILE = 50 * 1024 * 1024;

  var fmtInt = new Intl.NumberFormat('pt-BR');
  var fmtPct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  var dom = {};
  var state = {
    dataset: null,
    sheets: [],
    sheetIndex: 0,
    fileName: '',
    filters: {},
    search: '',
    sort: { key: null, dir: 0 },
    visible: [],
    widths: {},
    baseWidths: {},
    manualResize: false,
    kpiCols: [],
    rankDim: '',
    rankMetric: '__count',
    view: [],
    lastWindow: { start: -1, end: -1, total: -1, version: -1 },
    openRow: null,
    popover: null,
    popoverAnchor: null,
    menu: null,
    version: 0,
    tab: 'analysis',
    edView: [],
    edFiltered: false,
    edSel: { row: null, col: null },
    edEditing: false,
    edVersion: 0,
    edWidths: {},
    edBaseWidths: {},
    edLastWindow: { start: -1, end: -1, total: -1, version: -1 },
    edScrollRaf: 0,
    history: [],
    dirty: 0
  };
  var toastTimer = 0;
  var deferredPrompt = null;
  var scrollRaf = 0;

  /* ------------------------------------------------------------- utilidades */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child !== null && child !== undefined) node.append(child);
      });
    }
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  function debounce(fn, ms) {
    var timer = 0;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function tick() {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { resolve(); });
      else setTimeout(resolve, 16);
    });
  }

  function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // Em telas de toque (celular/tablet) não focar campos automaticamente:
  // abrir o teclado sozinho esconde a lista e atrapalha a escolha.
  function canAutofocus() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return false;
    } catch (e) { /* ignora */ }
    return window.innerWidth > 820;
  }

  function toast(message, kind) {
    dom.toast.className = 'toast' + (kind === 'error' ? ' is-error' : '');
    dom.toast.replaceChildren(
      icon(kind === 'error' ? 'alert' : 'check'),
      el('span', { text: message })
    );
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.hidden = true; }, kind === 'error' ? 6500 : 3600);
  }

  function showLoading(title, text) {
    dom.loadingTitle.textContent = title;
    dom.loadingText.textContent = text || 'Processando no seu navegador.';
    dom.loading.hidden = false;
  }
  function hideLoading() { dom.loading.hidden = true; }

  function pctText(a, b) {
    if (!b) return '0%';
    return fmtPct.format((a / b) * 100) + '%';
  }

  function dayStart(ms) {
    var d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function dayEnd(ms) { return dayStart(ms) + 86399999; }
  function toInputDate(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fromInputDate(value, endOfDay) {
    if (!value) return null;
    var parts = value.split('-');
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!y || !m || !d) return null;
    return endOfDay
      ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
      : new Date(y, m - 1, d).getTime();
  }
  function inputNumber(value) {
    if (!value) return null;
    return C.parseNumber(value, 'br');
  }
  function numberInputValue(value) {
    return value === null || value === undefined ? '' : String(value).replace('.', ',');
  }

  /* ----------------------------------------------------------------- tema */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('refugo:theme', theme); } catch (err) { /* modo privado */ }
    var use = $('#themeIcon');
    if (use) use.setAttribute('href', theme === 'light' ? '#i-moon' : '#i-sun');
    var btn = dom.btnTheme;
    if (btn) btn.setAttribute('aria-label', theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro');
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem('refugo:theme') || ''; } catch (err) { saved = ''; }
    applyTheme(saved === 'light' ? 'light' : 'dark');
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  }

  /* ------------------------------------------------------------ arquivos */

  function countDataRows(matrix, headerIndex) {
    var count = 0;
    for (var i = headerIndex + 1; i < matrix.length; i++) {
      var row = matrix[i] || [];
      for (var j = 0; j < row.length; j++) {
        if (!C.isEmpty(row[j])) { count++; break; }
      }
    }
    return count;
  }

  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/).slice(0, 8).filter(function (l) { return l.trim().length; });
    if (!lines.length) return ';';
    var candidates = [';', ',', '\t', '|'];
    var best = ';', bestScore = -1;
    candidates.forEach(function (delim) {
      var counts = lines.map(function (line) { return line.split(delim).length; });
      var min = Math.min.apply(null, counts);
      var max = Math.max.apply(null, counts);
      var score = min >= 2 ? min * 10 - (max - min) : 0;
      if (score > bestScore) { bestScore = score; best = delim; }
    });
    return best;
  }

  function parseCsvText(text, delim) {
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* ignora CR */ }
      else field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) { return r.map(function (v) { return v.replace(NBSP_G, ' ').trim(); }); });
  }
  var NBSP_G = /[\u00A0\u202F\uFEFF]/g;

  function parseCsvBuffer(buffer) {
    var text = new TextDecoder('utf-8').decode(buffer);
    if (text.indexOf('\uFFFD') > -1) {
      try { text = new TextDecoder('windows-1252').decode(buffer); } catch (err) { /* mantém UTF-8 */ }
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return parseCsvText(text, detectDelimiter(text));
  }

  function confirmDiscardEdits() {
    if (!state.history.length) return true;
    var n = state.history.length;
    return window.confirm(
      'Há ' + (n === 1 ? '1 alteração' : n + ' alterações') +
      ' no editor que ainda não foram exportadas. Se continuar, elas serão descartadas. Deseja continuar?'
    );
  }

  async function openFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) {
      toast('Arquivo grande demais (limite de 50 MB).', 'error');
      return;
    }
    if (!confirmDiscardEdits()) return;
    showLoading('Lendo planilha…', file.name);
    try {
      await tick();
      var buffer = await file.arrayBuffer();
      if (/\.csv$/i.test(file.name) || /csv/i.test(file.type)) {
        var matrix = parseCsvBuffer(buffer);
        loadMatrix(matrix, { fileName: file.name, sheetName: 'CSV' });
      } else {
        var wb;
        try {
          wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
        } catch (err) {
          throw new Error('O arquivo não parece ser uma planilha válida do Excel.');
        }
        if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('A planilha não tem abas para ler.');
        var sheets = wb.SheetNames.map(function (name) {
          var sheetMatrix = XLSX.utils.sheet_to_json(wb.Sheets[name], {
            header: 1, raw: true, defval: null, blankrows: false
          });
          var headerRowIndex = C.detectHeaderRow(sheetMatrix);
          return {
            name: name,
            matrix: sheetMatrix,
            headerRowIndex: headerRowIndex,
            autoHeaderRowIndex: headerRowIndex,
            dataRows: countDataRows(sheetMatrix, headerRowIndex)
          };
        });
        state.fileName = file.name;
        state.sheets = sheets;
        var best = 0;
        for (var i = 1; i < sheets.length; i++) {
          if (sheets[i].dataRows > sheets[best].dataRows) best = i;
        }
        state.sheetIndex = best;
        buildFromSheet();
      }
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : 'Não consegui ler esta planilha.', 'error');
    } finally {
      hideLoading();
    }
  }

  function loadMatrix(matrix, options) {
    if (!matrix || !matrix.length) {
      toast('A planilha está vazia.', 'error');
      return;
    }
    var headerRowIndex = C.detectHeaderRow(matrix);
    state.fileName = (options && options.fileName) || 'Planilha';
    state.sheets = [{
      name: (options && options.sheetName) || 'Dados',
      matrix: matrix,
      headerRowIndex: headerRowIndex,
      autoHeaderRowIndex: headerRowIndex,
      dataRows: countDataRows(matrix, headerRowIndex)
    }];
    state.sheetIndex = 0;
    buildFromSheet();
  }

  function buildFromSheet() {
    var sheet = state.sheets[state.sheetIndex];
    if (!sheet) return;
    var ds = C.createDataset({
      matrix: sheet.matrix,
      headerRowIndex: sheet.headerRowIndex,
      fileName: state.fileName,
      sheetName: sheet.name
    });
    if (!ds.rowCount) {
      toast('A planilha foi lida, mas não há linhas de dados abaixo do cabeçalho.', 'error');
    }
    setDataset(ds);
  }

  /* ----------------------------------------------------------- dataset */

  function computeWidths(ds) {
    var widths = {};
    ds.columns.forEach(function (col) {
      var maxLen = col.label.length;
      var sample = Math.min(ds.rowCount, 160);
      for (var i = 0; i < sample; i++) {
        var value = ds.rows[i][col.index];
        if (value === null) continue;
        var text;
        if (col.type === 'date') text = '00/00/0000';
        else if (col.type === 'number') text = C.formatValue(ds, col.index, value);
        else text = String(value);
        if (text.length > maxLen) maxLen = text.length;
      }
      var extra = col.type === 'number' ? 26 : 30;
      var width = Math.round(Math.min(maxLen, 46) * 7.3 + extra);
      var cap = col.label === 'Obs. Refugo' || /obs|descri/i.test(col.label) ? 340 : 280;
      widths[col.key] = clamp(width, 86, cap);
    });
    return widths;
  }

  function setDataset(ds) {
    state.dataset = ds;
    state.filters = {};
    state.search = '';
    state.sort = { key: null, dir: 0 };
    state.visible = ds.columns.map(function (c) { return c.key; });
    state.baseWidths = computeWidths(ds);
    state.widths = Object.assign({}, state.baseWidths);
    state.edBaseWidths = Object.assign({}, state.baseWidths);
    state.edWidths = Object.assign({}, state.baseWidths);
    state.manualResize = false;
    state.view = ds.rows.map(function (_, i) { return i; });
    state.version++;
    state.lastWindow = { start: -1, end: -1, total: -1, version: -1 };
    ds._all = state.view.slice();
    ds._totals = Object.create(null);

    var numbers = ds.columns.filter(function (c) { return c.type === 'number'; });
    var preferred = [];
    ['kg', 'qty', 'cm'].forEach(function (unit) {
      numbers.forEach(function (col) { if (col.unit === unit) preferred.push(col); });
    });
    numbers.forEach(function (col) {
      if (preferred.indexOf(col) === -1) preferred.push(col);
    });
    state.kpiCols = preferred.slice(0, 3).map(function (c) { return c.key; });

    dom.search.value = '';
    dom.searchClear.hidden = true;
    dom.emptyState.hidden = true;
    dom.workspace.hidden = false;
    if (dom.filterHeroEmpty) dom.filterHeroEmpty.hidden = true;
    if (dom.filterHero) dom.filterHero.hidden = false;
    dom.btnExport.disabled = false;
    dom.btnEdit && (dom.btnEdit.disabled = false);
    dom.fileName.textContent = ds.fileName || 'Planilha';
    dom.fileName.title = ds.fileName || '';
    dom.fileMeta.textContent = fmtInt.format(ds.rowCount) + ' linhas · ' +
      ds.columns.length + ' colunas · cabeçalho na linha ' + ds.headerRowNumber;

    buildSheetSelect();
    applyCols();
    renderHead();
    renderChips();
    updateFooter();
    renderRows(true);
    dom.gridScroll.scrollTop = 0;
    dom.gridScroll.scrollLeft = 0;
    resetEditorState();
    applyEdCols();
    renderFilterButtons();
    requestAnimationFrame(function () {
      fitWidths();
      edFitWidths();
    });
  }

  function buildSheetSelect() {
    var multi = state.sheets.length > 1;
    dom.sheetWrap.hidden = !multi;
    dom.sheetSelect.replaceChildren();
    state.sheets.forEach(function (sheet, index) {
      var opt = el('option', { value: String(index), text: sheet.name + ' (' + fmtInt.format(sheet.dataRows) + ' linhas)' });
      if (index === state.sheetIndex) opt.selected = true;
      dom.sheetSelect.append(opt);
    });
  }

  /* ------------------------------------------------------------- colunas */

  function applyCols() {
    var template = state.visible.map(function (key) {
      return Math.round(state.widths[key] || 120) + 'px';
    }).join(' ');
    dom.grid.style.setProperty('--cols', template || '1fr');
  }

  function fitWidths() {
    if (state.manualResize || !state.dataset) return;
    var available = dom.gridScroll.clientWidth;
    if (!available) return;
    var sum = 0;
    state.visible.forEach(function (key) { sum += state.widths[key]; });
    if (sum >= available - 1) return;
    var extra = available - sum;
    var baseSum = 0;
    state.visible.forEach(function (key) { baseSum += state.baseWidths[key] || 1; });
    state.visible.forEach(function (key) {
      var share = (state.baseWidths[key] || 1) / (baseSum || 1);
      state.widths[key] = Math.round(state.widths[key] + extra * share);
    });
    applyCols();
  }

  function recomputeWidths() {
    if (!state.dataset) return;
    if (!state.manualResize) {
      state.widths = Object.assign({}, state.baseWidths);
      fitWidths();
    }
    applyCols();
  }

  function isFilterActive(col) {
    if (!col) return false;
    var filter = state.filters[col.key];
    if (!filter) return false;
    if (filter.type === 'text') return filter.values instanceof Set;
    if (filter.type === 'number') return filter.min !== null || filter.max !== null;
    if (filter.type === 'date') return filter.from !== null || filter.to !== null;
    return false;
  }

  function activeFilterKeys() {
    var ds = state.dataset;
    if (!ds) return [];
    return Object.keys(state.filters).filter(function (key) {
      return isFilterActive(C.columnByKey(ds, key));
    });
  }

  /* ----------------------------------------------------------- cabeçalho */

  function renderHead() {
    var ds = state.dataset;
    if (!ds) return;
    applyCols();
    var frag = document.createDocumentFragment();
    state.visible.forEach(function (key) {
      var col = C.columnByKey(ds, key);
      if (!col) return;
      var active = isFilterActive(col);
      var dir = state.sort.key === key ? state.sort.dir : 0;
      var cell = el('div', { class: 'gh', role: 'columnheader' });
      if (dir) cell.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');

      var sortBtn = el('button', {
        class: 'gh-sort', type: 'button', title: 'Ordenar por ' + col.label
      });
      sortBtn.append(
        el('span', { class: 'gh-label', text: col.label }),
        icon(dir === -1 ? 'arrow-down' : 'arrow-up')
      );
      sortBtn.addEventListener('click', function () { toggleSort(col); });

      var filterBtn = el('button', {
        class: 'gh-filter' + (active ? ' is-active has-value' : ''),
        type: 'button',
        title: 'Filtrar ' + col.label,
        'aria-label': 'Filtrar ' + col.label
      });
      filterBtn.dataset.filterKey = key;
      filterBtn.append(icon('filter'));
      filterBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        openFilter(col, filterBtn);
      });

      var resize = el('div', { class: 'gh-resize', title: 'Arraste para ajustar a largura' });
      bindResize(resize, col);

      cell.append(sortBtn, filterBtn, resize);
      frag.append(cell);
    });
    dom.gridHead.replaceChildren(frag);
  }

  function updateHeaderState() {
    var ds = state.dataset;
    if (!ds) return;
    Array.prototype.forEach.call(dom.gridHead.children, function (cell, index) {
      var key = state.visible[index];
      if (!key) return;
      var col = C.columnByKey(ds, key);
      var active = isFilterActive(col);
      var filterBtn = cell.querySelector('.gh-filter');
      if (filterBtn) {
        filterBtn.classList.toggle('is-active', active);
        filterBtn.classList.toggle('has-value', active);
        filterBtn.setAttribute('aria-label', (active ? 'Filtro ativo em ' : 'Filtrar ') + col.label);
      }
      var dir = state.sort.key === key ? state.sort.dir : 0;
      if (dir) cell.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      else cell.removeAttribute('aria-sort');
      var use = cell.querySelector('.gh-sort use');
      if (use) use.setAttribute('href', dir === -1 ? '#i-arrow-down' : '#i-arrow-up');
    });
  }

  function bindResize(handle, col) {
    handle.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var startX = event.clientX;
      var startWidth = state.widths[col.key];
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(event.pointerId); } catch (err) { /* ignora */ }
      }
      function onMove(ev) {
        state.widths[col.key] = clamp(startWidth + (ev.clientX - startX), 70, 640);
        state.manualResize = true;
        applyCols();
      }
      function onUp() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        renderRows(true);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  function toggleSort(col) {
    if (state.sort.key !== col.key) state.sort = { key: col.key, dir: 1 };
    else if (state.sort.dir === 1) state.sort = { key: col.key, dir: -1 };
    else state.sort = { key: null, dir: 0 };
    applyView(true);
  }

  /* -------------------------------------------------------------- linhas */

  function renderRows(force) {
    var ds = state.dataset;
    if (!ds) return;
    var total = state.view.length;
    var scroller = dom.gridScroll;
    var y = Math.max(0, scroller.scrollTop - HEAD_H);
    var viewport = scroller.clientHeight || 600;
    var start = Math.max(0, Math.floor(y / ROW_H) - OVERSCAN);
    var count = Math.ceil(viewport / ROW_H) + OVERSCAN * 2;
    var end = Math.min(total, start + count);

    dom.gridCanvas.style.height = (total * ROW_H) + 'px';

    if (!force &&
        state.lastWindow.start === start &&
        state.lastWindow.end === end &&
        state.lastWindow.total === total &&
        state.lastWindow.version === state.version) return;

    state.lastWindow = { start: start, end: end, total: total, version: state.version };
    dom.gridRows.style.transform = 'translateY(' + (start * ROW_H) + 'px)';

    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) frag.append(buildRow(state.view[i], i));
    dom.gridRows.replaceChildren(frag);
    if (state.openRow !== null) markOpenRow(state.openRow);
  }

  function buildRow(viewIndex, position) {
    var ds = state.dataset;
    var row = ds.rows[viewIndex];
    var node = el('div', {
      class: 'grid-row', role: 'row', tabindex: '0',
      'aria-rowindex': String(position + 1)
    });
    node.dataset.row = String(viewIndex);

    state.visible.forEach(function (key) {
      var col = C.columnByKey(ds, key);
      var value = row[col.index];
      var text = value === null ? '' : C.formatValue(ds, col.index, value);
      var cls = 'cell';
      if (col.type === 'number') cls += ' num';
      else if (col.type === 'date') cls += ' date';
      if (col.key === 'item-descricao' || col.key === 'item-base') cls += ' is-key';
      var cell = el('div', { class: cls, role: 'cell' });
      cell.dataset.col = String(col.index);
      if (text) {
        cell.textContent = text;
        if (text.length > 34) cell.title = text;
      } else {
        cell.append(el('span', { class: 'is-empty', text: '—' }));
      }
      node.append(cell);
    });

    node.addEventListener('click', function () { openDrawer(viewIndex); });
    node.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDrawer(viewIndex);
      }
    });
    node.addEventListener('contextmenu', function (event) { openRowMenu(event, viewIndex); });
    return node;
  }

  function markOpenRow(viewIndex) {
    Array.prototype.forEach.call(dom.gridRows.children, function (row) {
      row.classList.toggle('is-open', Number(row.dataset.row) === viewIndex);
    });
  }

  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      renderRows(false);
    });
  }

  /* ---------------------------------------------------------------- KPI */

  function makeKpi(label, value, sub, metric) {
    var card = el('article', { class: 'kpi' + (metric ? ' is-metric' : '') });
    card.append(
      el('p', { class: 'kpi-label', text: label, title: label }),
      el('p', { class: 'kpi-value', text: value, title: value }),
      el('p', { class: 'kpi-sub', text: sub })
    );
    return card;
  }

  function renderKpis() {
    // Função mantida por compatibilidade, mas não renderiza mais na versão simplificada
    return;
  }

  /* -------------------------------------------------------------- chips */

  function filterSummary(col, filter) {
    if (filter.type === 'text') {
      var n = filter.values.size;
      if (n === 0) return 'nenhum valor';
      if (n === 1) {
        var only = Array.from(filter.values)[0];
        return only === C.EMPTY_KEY ? '(vazio)' : (filter.onlyLabel || '1 valor');
      }
      return n + ' valores';
    }
    return C.describeFilter(state.dataset, filter);
  }

  function renderChips() {
    var ds = state.dataset;
    if (!ds) return;
    var keys = activeFilterKeys();
    var frag = document.createDocumentFragment();

    keys.forEach(function (key) {
      var col = C.columnByKey(ds, key);
      var filter = state.filters[key];
      var chip = el('div', { class: 'chip' });
      var open = el('button', { class: 'chip-open', type: 'button', title: 'Editar filtro de ' + col.label });
      open.append(
        el('span', { class: 'chip-label', text: col.label }),
        el('span', { class: 'chip-value', text: filterSummary(col, filter) })
      );
      open.addEventListener('click', function () { openFilter(col, chip); });
      var remove = el('button', { class: 'chip-x', type: 'button', 'aria-label': 'Remover filtro de ' + col.label, title: 'Remover filtro' });
      remove.append(icon('x'));
      remove.addEventListener('click', function () {
        delete state.filters[key];
        applyView(true);
      });
      chip.append(open, remove);
      frag.append(chip);
    });

    if (keys.length || state.search) {
      var clear = el('button', { class: 'chip-clear', type: 'button', text: 'Limpar tudo' });
      clear.addEventListener('click', clearAll);
      frag.append(clear);
    }
    dom.chipBar.replaceChildren(frag);
    dom.chipBar.hidden = !(keys.length || state.search);
  }

  function renderFilterButtons() {
    var ds = state.dataset;
    if (!ds || !dom.filterHeroCats) return;
    if (dom.filterHeroEmpty) dom.filterHeroEmpty.hidden = true;
    if (dom.filterHero) dom.filterHero.hidden = false;

    // Agrupar colunas por tipo
    var cats = {
      text: { label: 'Texto', icon: 'i-filter', cols: [] },
      number: { label: 'Número', icon: 'i-bar', cols: [] },
      date: { label: 'Data', icon: 'i-arrow-up', cols: [] }
    };
    ds.columns.forEach(function (col) {
      var key = col.type === 'text' ? 'text' : col.type === 'number' ? 'number' : 'date';
      cats[key].cols.push(col);
    });

    var frag = document.createDocumentFragment();
    var anyActive = false;

    Object.keys(cats).forEach(function (catKey) {
      var cat = cats[catKey];
      if (!cat.cols.length) return;
      var catFrag = document.createDocumentFragment();
      var catTitle = el('div', { class: 'filter-hero-cat-title', text: cat.label });
      catFrag.append(catTitle);
      var grid = el('div', { class: 'filter-hero-cat-grid' });
      cat.cols.forEach(function (col) {
        var isActive = !!state.filters[col.key];
        if (isActive) anyActive = true;
        var btn = el('button', {
          class: 'filter-hero-btn' + (isActive ? ' is-active' : ''),
          type: 'button',
          title: col.label
        });
        btn.append(icon(col.type === 'text' ? 'filter' : col.type === 'number' ? 'bar' : 'arrow-up'), el('span', { text: col.label }));
        btn.addEventListener('click', function (event) {
          event.stopPropagation();
          // Toggle: se já ativo, remove; senão abre filtro
          if (isActive) {
            delete state.filters[col.key];
            applyView(true);
            renderFilterButtons();
          } else {
            openFilter(col, btn);
          }
        });
        grid.append(btn);
      });
      catFrag.append(grid);
      frag.append(catFrag);
    });

    // Botão para selecionar colunas visíveis
    var colsBtn = el('button', { class: 'filter-hero-btn', type: 'button' });
    colsBtn.append(icon('columns'), el('span', { text: 'Colunas visíveis' }));
    colsBtn.addEventListener('click', function () {
      openColumnsPopover(colsBtn);
    });
    grid = el('div', { class: 'filter-hero-cat-grid' });
    grid.append(colsBtn);
    var catFrag2 = el('div', { class: 'filter-hero-cat' });
    catFrag2.append(el('div', { class: 'filter-hero-cat-title', text: 'Exibição' }));
    catFrag2.append(grid);
    frag.append(catFrag2);

    // Botão limpar todos
    var activeKeys = activeFilterKeys();
    if (activeKeys.length > 0) {
      var clearBtn = el('button', { class: 'filter-clear-all is-danger', type: 'button' });
      clearBtn.textContent = 'Limpar todos os filtros (' + activeKeys.length + ')';
      clearBtn.addEventListener('click', function () {
        clearAll();
        renderFilterButtons();
      });
      frag.appendChild(clearBtn);
    }

    dom.filterHeroCats.replaceChildren(frag);
  }

  /* ----------------------------------------------------------- ranking - REMOVIDO NA VERSÃO SIMPLIFICADA */

  function buildRankControls() {
    // Função mantida por compatibilidade, mas não implementada
    return;
  }

  function renderInsights() {
    var ds = state.dataset;
    if (!ds) return;
    var dim = C.columnByKey(ds, state.rankDim);
    if (!dim) {
      dom.rankList.replaceChildren(el('li', { class: 'rank-empty', text: 'Sem colunas de texto para agrupar.' }));
      return;
    }
    var metric = state.rankMetric === '__count' ? null : C.columnByKey(ds, state.rankMetric);
    var groups = C.groupSum(ds, state.view, dim.index, metric ? metric.index : null);
    groups.forEach(function (group) { group.value = metric ? group.total : group.count; });
    groups = groups.filter(function (g) { return g.value > 0 || metric === null; });
    groups.sort(function (a, b) {
      return b.value - a.value || String(a.label).localeCompare(String(b.label), 'pt-BR');
    });

    var top = groups.slice(0, 6);
    if (!top.length) {
      dom.rankList.replaceChildren(el('li', { class: 'rank-empty', text: 'Nenhum dado com os filtros atuais.' }));
      return;
    }
    var max = top[0].value || 1;
    var frag = document.createDocumentFragment();
    top.forEach(function (group, index) {
      var item = el('li');
      var button = el('button', { class: 'rank-item', type: 'button', title: 'Filtrar por ' + group.label });
      var bar = el('span', { class: 'rank-bar' });
      bar.style.width = Math.max(2, (group.value / max) * 100) + '%';
      button.append(
        bar,
        el('span', { class: 'rank-pos', text: String(index + 1).padStart(2, '0') }),
        el('span', { class: 'rank-name', text: group.label }),
        el('span', { class: 'rank-val', text: metric ? C.formatMetric(group.value, metric.decimals) : fmtInt.format(group.value) })
      );
      button.addEventListener('click', function () { applyRankFilter(dim, group); });
      item.append(button);
      frag.append(item);
    });
    dom.rankList.replaceChildren(frag);
  }

  function applyRankFilter(col, group) {
    if (group.key === C.EMPTY_KEY) {
      setTextFilter(col, [C.EMPTY_KEY], '(vazio)');
    } else {
      setTextFilter(col, [group.key], group.label);
    }
  }

  function setTextFilter(col, keys, label) {
    state.filters[col.key] = {
      type: 'text',
      values: new Set(keys),
      onlyLabel: keys.length === 1 ? (label || (keys[0] === C.EMPTY_KEY ? '(vazio)' : keys[0])) : ''
    };
    applyView(true);
  }

  /* ------------------------------------------------------------- saúde */

  function renderQuality() {
    var ds = state.dataset;
    // Removido - painel de saúde da planilha não é mais necessário na versão simplificada
  }

  function updateFooter() {
    var ds = state.dataset;
    if (!ds) return;
    var keys = activeFilterKeys();
    var parts = [fmtInt.format(state.view.length) + ' de ' + fmtInt.format(ds.rowCount) + ' linhas'];
    if (keys.length) parts.push(keys.length + (keys.length === 1 ? ' filtro ativo' : ' filtros ativos'));
    if (state.search) parts.push('busca "' + state.search + '"');
    dom.rowInfo.textContent = parts.join(' · ');
    dom.btnClearFilters.disabled = !keys.length && !state.search;

    var invalid = ds.columns.reduce(function (sum, c) { return sum + c.invalid; }, 0);
    if (invalid) {
      dom.qualityNote.hidden = false;
      dom.qualityNote.replaceChildren(icon('alert'), el('span', { text: fmtInt.format(invalid) + ' valores não reconhecidos' }));
      dom.qualityNote.title = 'Veja a coluna "Saúde da planilha" para saber quais colunas têm valores fora do formato.';
    } else {
      dom.qualityNote.hidden = true;
    }
    renderEmptyNote();
  }

  function renderEmptyNote() {
    var ds = state.dataset;
    if (!ds) return;
    var note = dom.noResults;
    if (state.view.length > 0) { note.hidden = true; return; }
    note.hidden = false;
    var strong = note.querySelector('strong');
    var span = note.querySelector('span');
    if (ds.rowCount === 0) {
      strong.textContent = 'Nenhuma linha de dados encontrada';
      span.textContent = 'Confira se o cabeçalho está na linha correta em Ajustes, ou se a aba escolhida tem registros.';
    } else {
      strong.textContent = 'Nenhuma linha com esses filtros';
      span.textContent = 'Relaxe um filtro ou limpe tudo para voltar a ver os registros.';
    }
  }

  /* --------------------------------------------------------------- editor */

  function allRowIndices(ds) {
    var arr = new Array(ds.rows.length);
    for (var i = 0; i < arr.length; i++) arr[i] = i;
    return arr;
  }

  function edColumnLetter(index) {
    var n = index + 1, out = '';
    while (n > 0) {
      var rest = (n - 1) % 26;
      out = String.fromCharCode(65 + rest) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
  }

  function resetEditorState() {
    var ds = state.dataset;
    state.edView = ds ? allRowIndices(ds) : [];
    state.edFiltered = false;
    state.edSel = { row: null, col: null };
    state.edEditing = false;
    state.edEditInput = null;
    state.edEditInfo = null;
    state.history = [];
    state.dirty = 0;
    state.edLastWindow = { start: -1, end: -1, total: -1, version: -1 };
    if (dom.edFiltered) dom.edFiltered.checked = false;
    if (dom.edGridScroll) {
      dom.edGridScroll.scrollTop = 0;
      dom.edGridScroll.scrollLeft = 0;
    }
    applyEdCols();
    renderEdHead();
    renderEdRows(true);
    updateEdFx();
    updateEdCount();
    updateEdDirty();
  }

  function applyEdCols() {
    if (!dom.edGrid) return;
    var ds = state.dataset;
    if (!ds) {
      dom.edGrid.style.setProperty('--cols', '1fr');
      return;
    }
    var template = ds.columns.map(function (col) {
      return Math.round(state.edWidths[col.key] || 120) + 'px';
    }).join(' ');
    dom.edGrid.style.setProperty('--cols', template || '1fr');
  }

  function edFitWidths() {
    var ds = state.dataset;
    if (!ds || !dom.edGridScroll || dom.editorPanel.hidden) return;
    var available = dom.edGridScroll.clientWidth;
    if (!available) return;
    var sum = 0, baseSum = 0;
    ds.columns.forEach(function (col) {
      sum += state.edWidths[col.key] || 120;
      baseSum += state.edBaseWidths[col.key] || 1;
    });
    if (sum >= available - 1) { applyEdCols(); return; }
    var extra = available - sum;
    ds.columns.forEach(function (col) {
      var share = (state.edBaseWidths[col.key] || 1) / (baseSum || 1);
      state.edWidths[col.key] = Math.round((state.edWidths[col.key] || 120) + extra * share);
    });
    applyEdCols();
  }

  function renderEdHead() {
    var ds = state.dataset;
    if (!ds) { dom.edGridHead.replaceChildren(); return; }
    applyEdCols();
    var frag = document.createDocumentFragment();
    ds.columns.forEach(function (col, index) {
      var cell = el('div', { class: 'ed-gh', role: 'columnheader', title: col.label + ' (' + col.type + ')' });
      cell.append(
        el('span', { class: 'ed-gh-letter', text: edColumnLetter(index) }),
        el('span', { class: 'ed-gh-name', text: col.label })
      );
      frag.append(cell);
    });
    dom.edGridHead.replaceChildren(frag);
  }

  function updateEdCount() {
    var ds = state.dataset;
    if (!dom.edCount) return;
    if (!ds) { dom.edCount.textContent = '—'; return; }
    var total = ds.rowCount;
    var shown = state.edFiltered ? state.edView.length : total;
    dom.edCount.textContent = state.edFiltered
      ? fmtInt.format(shown) + ' de ' + fmtInt.format(total) + ' linhas'
      : fmtInt.format(total) + ' linhas · ' + ds.columns.length + ' colunas';
  }

  function updateEdDirty() {
    var n = state.history.length;
    if (dom.edDirty) {
      dom.edDirty.hidden = n === 0;
      dom.edDirty.textContent = n === 1 ? '1 alteração' : fmtInt.format(n) + ' alterações';
      dom.edDirty.title = 'As alterações ficam na memória até você exportar.';
    }
    if (dom.edUndo) dom.edUndo.disabled = n === 0;
    updateTabsNote();
  }

  function updateTabsNote() {
    if (!dom.tabsNote) return;
    var n = state.history.length;
    if (n) {
      dom.tabsNote.textContent = n === 1 ? '1 alteração em memória' : fmtInt.format(n) + ' alterações em memória';
    } else {
      dom.tabsNote.textContent = state.tab === 'editor' ? 'Sem alterações' : '';
    }
  }

  function updateEdFx() {
    var ds = state.dataset;
    var sel = state.edSel;
    var col = ds && sel.row !== null && sel.col !== null ? ds.columns[sel.col] : null;
    var row = col ? ds.rows[sel.row] : null;
    var valid = !!row && !!col;
    dom.edFxInput.disabled = !valid;
    dom.edFxApply.disabled = !valid;
    dom.edDeleteRow.disabled = !valid;
    if (!valid) {
      dom.edFxRef.textContent = '—';
      dom.edFxRef.title = 'Célula selecionada';
      dom.edFxInput.value = '';
      dom.edFxInput.placeholder = 'Selecione uma célula para editar…';
      return;
    }
    var rowNumber = ds.rowNumbers[sel.row];
    dom.edFxRef.textContent = edColumnLetter(sel.col) + rowNumber;
    dom.edFxRef.title = col.label + ' · linha ' + rowNumber;
    dom.edFxInput.placeholder = col.label + (
      col.type === 'number' ? ' (número)' : col.type === 'date' ? ' (dia/mês/ano)' : ''
    );
    dom.edFxInput.value = C.editableValue(ds, col.index, row[col.index]);
  }

  function renderEdRows(force) {
    var ds = state.dataset;
    if (!ds) return;
    var total = state.edView.length;
    var scroller = dom.edGridScroll;
    var y = Math.max(0, scroller.scrollTop - ED_HEAD_H);
    var viewport = scroller.clientHeight || 480;
    var start = Math.max(0, Math.floor(y / ED_ROW_H) - ED_OVERSCAN);
    var count = Math.ceil(viewport / ED_ROW_H) + ED_OVERSCAN * 2;
    var end = Math.min(total, start + count);

    dom.edCanvas.style.height = (total * ED_ROW_H) + 'px';

    var selKey = String(state.edSel.row) + ':' + String(state.edSel.col);
    if (!force &&
        state.edLastWindow.start === start &&
        state.edLastWindow.end === end &&
        state.edLastWindow.total === total &&
        state.edLastWindow.selKey === selKey) return;

    state.edLastWindow = { start: start, end: end, total: total, selKey: selKey };
    dom.edRows.style.transform = 'translateY(' + (start * ED_ROW_H) + 'px)';

    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) frag.append(buildEdRow(state.edView[i], i));
    dom.edRows.replaceChildren(frag);
  }

  function buildEdRow(rowIndex, position) {
    var ds = state.dataset;
    var row = ds.rows[rowIndex];
    var node = el('div', {
      class: 'ed-row' + (state.edSel.row === rowIndex ? ' is-active-row' : ''),
      role: 'row',
      'aria-rowindex': String(position + 1)
    });
    node.dataset.row = String(rowIndex);

    ds.columns.forEach(function (col, colIndex) {
      var value = row[col.index];
      var text = value === null || value === undefined ? '' : C.formatValue(ds, col.index, value);
      var cls = 'ed-cell';
      if (col.type === 'number') cls += ' num';
      else if (col.type === 'date') cls += ' date';
      var selected = state.edSel.row === rowIndex && state.edSel.col === colIndex;
      if (selected) cls += ' is-selected';
      var cell = el('div', {
        class: cls, role: 'gridcell', 'aria-selected': selected ? 'true' : 'false'
      });
      cell.dataset.col = String(colIndex);
      if (text) {
        cell.textContent = text;
        if (text.length > 30) cell.title = text;
      } else {
        cell.append(el('span', { class: 'is-empty', text: '\u00a0' }));
      }
      node.append(cell);
    });

    return node;
  }

  function findEdCell(rowIndex, colIndex) {
    var rows = dom.edRows.children;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i].dataset.row) === rowIndex) {
        return rows[i].querySelector('.ed-cell[data-col="' + colIndex + '"]');
      }
    }
    return null;
  }

  function ensureEdVisible(rowIndex, colIndex) {
    var ds = state.dataset;
    if (!ds) return;
    var pos = state.edView.indexOf(rowIndex);
    if (pos < 0) return;
    var scroller = dom.edGridScroll;
    var top = ED_HEAD_H + pos * ED_ROW_H;
    var bottom = top + ED_ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    }
    var left = 0;
    for (var i = 0; i < colIndex; i++) left += state.edWidths[ds.columns[i].key] || 120;
    var width = state.edWidths[ds.columns[colIndex].key] || 120;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (left + width > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = left + width - scroller.clientWidth;
    }
  }

  function selectEdCell(rowIndex, colIndex) {
    var ds = state.dataset;
    if (!ds || !ds.rows[rowIndex] || !ds.columns[colIndex]) return;
    if (state.edEditing) finishInlineEdit(true);
    state.edSel = { row: rowIndex, col: colIndex };
    ensureEdVisible(rowIndex, colIndex);
    renderEdRows(true);
    updateEdFx();
    try { dom.edGridScroll.focus({ preventScroll: true }); } catch (err) { dom.edGridScroll.focus(); }
  }

  function computeEdMove(sel, dir) {
    var ds = state.dataset;
    if (!ds || sel.row === null) return null;
    var pos = state.edView.indexOf(sel.row);
    if (pos < 0) return null;
    var row = sel.row, col = sel.col, nextPos = pos;
    if (dir === 'down') nextPos = pos + 1;
    else if (dir === 'up') nextPos = pos - 1;
    else if (dir === 'right') col = col + 1;
    else if (dir === 'left') col = col - 1;
    if (nextPos < 0 || nextPos >= state.edView.length) return null;
    if (col < 0 || col >= ds.columns.length) return null;
    if (nextPos !== pos) row = state.edView[nextPos];
    return { row: row, col: col };
  }

  function moveEdSelection(dir) {
    var next = computeEdMove(state.edSel, dir);
    if (!next) return false;
    selectEdCell(next.row, next.col);
    return true;
  }

  function handleEdCellTap(rowIndex, colIndex) {
    if (state.edEditing) return;
    if (state.edSel.row === rowIndex && state.edSel.col === colIndex) {
      beginEdit(rowIndex, colIndex);
      return;
    }
    selectEdCell(rowIndex, colIndex);
  }

  function onEdPointerDown(event) {
    if (event.target.closest && event.target.closest('.cell-input')) return;
    var cell = event.target.closest ? event.target.closest('.ed-cell') : null;
    if (!cell) return;
    var rowNode = cell.closest('.ed-row');
    if (!rowNode) return;
    event.preventDefault();
    var rowIndex = Number(rowNode.dataset.row);
    var colIndex = Number(cell.dataset.col);
    if (state.edEditing) finishInlineEdit(true);
    handleEdCellTap(rowIndex, colIndex);
  }

  function beginEdit(rowIndex, colIndex, seed) {
    var ds = state.dataset;
    if (!ds || !ds.rows[rowIndex] || !ds.columns[colIndex]) return;
    if (state.edEditing) finishInlineEdit(true);
    state.edSel = { row: rowIndex, col: colIndex };
    state.edEditing = true;
    state.edEditInfo = { row: rowIndex, col: colIndex };
    ensureEdVisible(rowIndex, colIndex);
    renderEdRows(true);
    updateEdFx();
    var cell = findEdCell(rowIndex, colIndex);
    if (!cell) {
      state.edEditing = false;
      state.edEditInfo = null;
      return;
    }
    var col = ds.columns[colIndex];
    var input = el('input', {
      class: 'cell-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      'aria-label': 'Editar ' + col.label
    });
    input.value = seed !== undefined ? seed : C.editableValue(ds, col.index, ds.rows[rowIndex][col.index]);
    cell.append(input);
    state.edEditInput = input;

    input.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        var dir = event.shiftKey ? 'up' : 'down';
        finishInlineEdit(true, dir);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        finishInlineEdit(true, event.shiftKey ? 'left' : 'right');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishInlineEdit(false);
      }
    });
    input.addEventListener('blur', function () {
      if (state.edEditing && state.edEditInfo &&
          state.edEditInfo.row === rowIndex && state.edEditInfo.col === colIndex) {
        finishInlineEdit(true);
      }
    });

    try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
    if (seed === undefined) input.select();
    else {
      var len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (err) { /* ignora */ }
    }
  }

  function finishInlineEdit(commit, dir) {
    if (!state.edEditing) return;
    var input = state.edEditInput;
    var info = state.edEditInfo;
    var raw = input ? input.value : '';
    state.edEditing = false;
    state.edEditInput = null;
    state.edEditInfo = null;
    if (input && input.parentNode) input.remove();
    if (!commit || !info) {
      renderEdRows(true);
      updateEdFx();
      return;
    }
    var ok = commitCell(info.row, info.col, raw, dir || null);
    if (!ok) beginEdit(info.row, info.col, raw);
  }

  function commitCell(rowIndex, colIndex, raw, dir) {
    var ds = state.dataset;
    if (!ds || !ds.rows[rowIndex] || !ds.columns[colIndex]) return false;
    var before = ds.rows[rowIndex][colIndex];
    var res = C.setCellValue(ds, rowIndex, colIndex, raw);
    if (!res.ok) {
      toast(res.error || 'Valor inválido.', 'error');
      return false;
    }
    if (!Object.is(before, res.value)) {
      state.history.push({ type: 'cell', row: rowIndex, col: colIndex, before: before, after: res.value });
      if (state.history.length > 120) state.history.shift();
    }
    var next = dir ? computeEdMove({ row: rowIndex, col: colIndex }, dir) : null;
    if (next) state.edSel = next;
    refreshEditorAfterMutation();
    if (next) ensureEdVisible(next.row, next.col);
    return true;
  }

  function refreshEditorAfterMutation() {
    var ds = state.dataset;
    if (!ds) return;
    renderQuality();
    applyView(false);
    updateEdDirty();
  }

  function addEditorRow() {
    var ds = state.dataset;
    if (!ds) return;
    if (state.edEditing) finishInlineEdit(true);
    var index = C.addRow(ds);
    state.history.push({ type: 'add', row: index });
    if (state.history.length > 120) state.history.shift();
    state.edFiltered = false;
    if (dom.edFiltered) dom.edFiltered.checked = false;
    state.edSel = { row: index, col: 0 };
    refreshEditorAfterMutation();
    selectEdCell(index, 0);
    beginEdit(index, 0);
    toast('Nova linha criada — preencha os campos e confirme.');
  }

  function deleteEditorRow() {
    var ds = state.dataset;
    var sel = state.edSel;
    if (!ds || sel.row === null || !ds.rows[sel.row]) {
      toast('Selecione uma linha para excluir.', 'error');
      return;
    }
    if (state.edEditing) finishInlineEdit(false);
    var rowNumber = ds.rowNumbers[sel.row];
    state.history.push({
      type: 'remove',
      row: sel.row,
      values: ds.rows[sel.row].slice(),
      rowNumber: rowNumber
    });
    if (state.history.length > 120) state.history.shift();
    C.removeRow(ds, sel.row);
    C.refreshAllStats(ds);
    state.edSel = { row: null, col: null };
    refreshEditorAfterMutation();
    toast('Linha ' + fmtInt.format(rowNumber) + ' excluída. Dá para desfazer.');
  }

  function undoEditor() {
    var ds = state.dataset;
    if (!ds || !state.history.length) return;
    if (state.edEditing) finishInlineEdit(false);
    var entry = state.history.pop();
    if (entry.type === 'cell') {
      ds.rows[entry.row][entry.col] = entry.before;
      C.refreshColumnStats(ds, entry.col);
      ds._search = null;
      ds._totals = Object.create(null);
      state.edSel = { row: entry.row, col: entry.col };
    } else if (entry.type === 'add') {
      C.removeRow(ds, entry.row);
      C.refreshAllStats(ds);
      if (state.edSel.row === entry.row) state.edSel = { row: null, col: null };
    } else if (entry.type === 'remove') {
      C.insertRow(ds, entry.row, entry.values, entry.rowNumber);
      C.refreshAllStats(ds);
      state.edSel = { row: entry.row, col: 0 };
    }
    refreshEditorAfterMutation();
    toast('Alteração desfeita.');
  }

  function buildEdView(resetScroll) {
    var ds = state.dataset;
    if (!ds) return;
    state.edView = state.edFiltered ? state.view.slice() : allRowIndices(ds);
    if (resetScroll) {
      dom.edGridScroll.scrollTop = 0;
      dom.edGridScroll.scrollLeft = 0;
      state.edLastWindow = { start: -1, end: -1, total: -1, version: -1 };
    }
    if (state.edSel.row !== null && state.edView.indexOf(state.edSel.row) === -1) {
      state.edSel = { row: null, col: null };
    }
    updateEdCount();
    updateEdFx();
    renderEdRows(true);
  }

  function syncEditorFromAnalysis() {
    var ds = state.dataset;
    if (!ds) return;
    if (state.edFiltered) state.edView = state.view.slice();
    else if (state.edView.length !== ds.rows.length) state.edView = allRowIndices(ds);
    if (state.edSel.row !== null && state.edView.indexOf(state.edSel.row) === -1) {
      state.edSel = { row: null, col: null };
      state.edEditing = false;
      state.edEditInput = null;
      state.edEditInfo = null;
    }
    updateEdCount();
    updateEdFx();
    if (dom.editorPanel && !dom.editorPanel.hidden) renderEdRows(true);
  }

  function onEdScroll() {
    if (state.edEditing) return;
    if (state.edScrollRaf) return;
    state.edScrollRaf = requestAnimationFrame(function () {
      state.edScrollRaf = 0;
      renderEdRows(false);
    });
  }

  function onEdKeyDown(event) {
    if (state.edEditing) return;
    var ds = state.dataset;
    if (!ds) return;
    var key = event.key;
    var nav = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2',
      'Delete', 'Backspace', 'Tab', 'Home', 'End'];
    if (state.edSel.row === null) {
      if (nav.indexOf(key) > -1 && state.edView.length) {
        event.preventDefault();
        selectEdCell(state.edView[0], 0);
      }
      return;
    }
    var handled = true;
    if (key === 'ArrowDown') moveEdSelection('down');
    else if (key === 'ArrowUp') moveEdSelection('up');
    else if (key === 'ArrowLeft') moveEdSelection('left');
    else if (key === 'ArrowRight') moveEdSelection('right');
    else if (key === 'Enter' || key === 'F2') beginEdit(state.edSel.row, state.edSel.col);
    else if (key === 'Delete' || key === 'Backspace') commitCell(state.edSel.row, state.edSel.col, '', null);
    else if (key === 'Tab') moveEdSelection(event.shiftKey ? 'left' : 'right');
    else if (key === 'Home') selectEdCell(state.edSel.row, 0);
    else if (key === 'End') selectEdCell(state.edSel.row, ds.columns.length - 1);
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      beginEdit(state.edSel.row, state.edSel.col, key);
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function applyFxValue() {
    var sel = state.edSel;
    if (sel.row === null || sel.col === null || dom.edFxInput.disabled) return;
    commitCell(sel.row, sel.col, dom.edFxInput.value, null);
    if (!dom.edFxInput.disabled) {
      try { dom.edFxInput.focus({ preventScroll: true }); } catch (err) { dom.edFxInput.focus(); }
      dom.edFxInput.select();
    }
  }

  function onFxKeyDown(event) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (state.edSel.row === null) return;
      commitCell(state.edSel.row, state.edSel.col, dom.edFxInput.value, event.shiftKey ? 'up' : 'down');
      try { dom.edFxInput.focus({ preventScroll: true }); } catch (err) { dom.edFxInput.focus(); }
      dom.edFxInput.select();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (state.edSel.row === null) return;
      commitCell(state.edSel.row, state.edSel.col, dom.edFxInput.value, event.shiftKey ? 'left' : 'right');
      try { dom.edFxInput.focus({ preventScroll: true }); } catch (err) { dom.edFxInput.focus(); }
      dom.edFxInput.select();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      updateEdFx();
      dom.edFxInput.blur();
    }
  }

  function openEditorModal() {
    if (!state.dataset) return;
    if (dom.editorModal) dom.editorModal.hidden = false;
    buildEdView(true);
    if (state.edEditing) finishInlineEdit(true);
    state.tab = 'editor';
  }
  function closeEditorModal() {
    if (dom.editorModal) dom.editorModal.hidden = true;
    if (state.editorModalOpen) {
      state.edEditing = false;
      state.edEditInput = null;
      state.edEditInfo = null;
    }
  }

  function toggleEditor() {
    if (!state.dataset) return;
    if (dom.editorModal.hidden) {
      openEditorModal();
    } else {
      closeEditorModal();
    }
  }

  /* ------------------------------------------------------- aplicar visão */

  function applyView(resetScroll) {
    var ds = state.dataset;
    if (!ds) return;
    state.version++;
    var filters = Object.assign({}, state.filters);
    filters.__search = state.search;
    var indices = C.filterRows(ds, filters);
    if (state.sort.key && state.sort.dir) {
      var col = C.columnByKey(ds, state.sort.key);
      state.view = C.sortIndices(ds, indices, col.index, state.sort.dir);
    } else {
      state.view = Array.prototype.slice.call(indices);
    }
    if (resetScroll) {
      dom.gridScroll.scrollTop = 0;
      state.lastWindow = { start: -1, end: -1, total: -1, version: -1 };
    }
    renderRows(true);
    renderChips();
    updateHeaderState();
    updateFooter();
    syncEditorFromAnalysis();
    renderFilterButtons();
  }

  /* --------------------------------------------------------- popover base */

  function closePopover(restoreFocus) {
    if (!state.popover) return;
    var node = state.popover;
    var anchor = state.popoverAnchor;
    state.popover = null;
    state.popoverAnchor = null;
    node.remove();
    document.body.classList.remove('popover-open');
    if (restoreFocus && anchor && document.contains(anchor)) anchor.focus();
  }

  function openPopover(content, anchor, label) {
    closePopover(false);
    closeMenu();
    var pop = el('div', { class: 'popover', role: 'dialog', 'aria-label': label || 'Filtro' });
    pop.append(content);
    document.body.append(pop);
    positionFloating(pop, anchor);
    state.popover = pop;
    state.popoverAnchor = anchor;
    document.body.classList.add('popover-open');
  }

  function positionFloating(node, anchor) {
    var margin = 8;
    var rect = anchor.getBoundingClientRect();
    var width = node.offsetWidth;
    var height = node.offsetHeight;
    var left = clamp(rect.right - width, margin, window.innerWidth - width - margin);
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  function popoverHeader(title, subtitle) {
    var head = el('div', { class: 'pop-head' });
    var text = el('div');
    text.append(el('h3', { text: title }));
    if (subtitle) text.append(el('p', { text: subtitle }));
    var close = el('button', { class: 'pop-close', type: 'button', 'aria-label': 'Fechar' });
    close.append(icon('x'));
    close.addEventListener('click', function () { closePopover(true); });
    head.append(text, close);
    return head;
  }

  /* --------------------------------------------------- filtros: texto */

  function openTextFilter(col, anchor) {
    var ds = state.dataset;
    var existing = state.filters[col.key];
    // Nada marcado = mostrar tudo. Tocar em um valor mantém apenas ele.
    var selected = existing && existing.type === 'text' ? new Set(existing.values) : new Set();
    var counts = C.uniqueCounts(ds, col.index, C.rowsExcept(ds, state.filters, col.key));
    var options = Array.from(counts.values()).sort(function (a, b) {
      return b.count - a.count || String(a.label).localeCompare(String(b.label), 'pt-BR');
    });
    var total = options.length;
    var labelByKey = new Map();
    options.forEach(function (opt) { labelByKey.set(opt.key, opt.label); });

    var root = el('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '8px';
    root.style.width = '340px';
    root.style.maxWidth = 'calc(100vw - 24px)';
    
    root.append(popoverHeader('Filtrar: ' + col.label, fmtInt.format(total) + ' valores distintos'));

    var search = null;
    if (total > 8) {
      search = el('input', {
        class: 'pop-input', type: 'text', placeholder: 'Buscar valor…',
        'aria-label': 'Buscar valor na lista', autocomplete: 'off', spellcheck: 'false'
      });
      search.style.width = '100%';
      search.style.boxSizing = 'border-box';
    }

    var list = el('div', { class: 'pop-list', role: 'group', 'aria-label': 'Valores da coluna' });
    list.style.maxHeight = '340px';
    list.style.overflowY = 'auto';
    list.style.marginBottom = '8px';

    var foot = el('div', { class: 'pop-foot' });
    foot.style.display = 'flex';
    foot.style.justifyContent = 'space-between';
    foot.style.alignItems = 'center';
    
    var countLabel = el('span');
    countLabel.style.fontSize = '12px';
    countLabel.style.color = 'var(--muted)';
    
    var btns = el('div', { class: 'pop-btns', style: { display: 'flex', gap: '6px' } });
    var applyBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Aplicar' });
    applyBtn.addEventListener('click', function () { persistAndClose(); });
    var doneBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Concluir' });
    doneBtn.style.background = 'var(--accent)';
    doneBtn.style.color = 'var(--accent-text)';
    doneBtn.addEventListener('click', function () { persistAndClose(); });
    btns.append(applyBtn, doneBtn);
    foot.append(countLabel, btns);

    var clearBtn = null;
    var colFilterActive = state.filters[col.key] && state.filters[col.key].type === 'text' && state.filters[col.key].values && state.filters[col.key].values.size > 0;
    if (colFilterActive) {
      clearBtn = el('button', { class: 'link-btn is-danger', type: 'button', text: 'Limpar este filtro' });
      clearBtn.addEventListener('click', function () {
        selected = new Set();
        delete state.filters[col.key];
        applyView(true);
        renderListOnly();
        updateCount();
        closePopover(true);
        toast('Filtro de ' + col.label + ' removido.');
      });
    }

    function updateCount() {
      if (!selected.size) {
        countLabel.textContent = fmtInt.format(total) + ' valores disponíveis';
        countLabel.style.color = 'var(--muted)';
        countLabel.style.fontWeight = '500';
      } else {
        countLabel.textContent = selected.size + ' selecionado' + (selected.size > 1 ? 's' : '') + ' de ' + fmtInt.format(total);
        countLabel.style.color = 'var(--accent-text)';
        countLabel.style.fontWeight = '700';
      }
      // Destacar botão Concluir quando há seleção
      if (selected.size > 0 && selected.size < total) {
        doneBtn.style.background = 'var(--accent)';
        doneBtn.style.color = 'var(--accent-text)';
        doneBtn.style.fontWeight = '700';
      } else if (selected.size === total) {
        doneBtn.style.background = 'var(--accent-soft)';
        doneBtn.style.color = 'var(--accent-text)';
        doneBtn.style.fontWeight = '700';
      } else {
        doneBtn.style.background = 'var(--surface-2)';
        doneBtn.style.color = 'var(--text-2)';
        doneBtn.style.fontWeight = '600';
      }
    }

    function applyFiltersSilently() {
      if (!selected.size || selected.size === total) {
        delete state.filters[col.key];
      } else {
        var onlyKey = selected.size === 1 ? Array.from(selected)[0] : null;
        state.filters[col.key] = {
          type: 'text',
          values: new Set(selected),
          onlyLabel: onlyKey === C.EMPTY_KEY ? '(vazio)' : (onlyKey !== null ? labelByKey.get(onlyKey) : '')
        };
      }
      applyView(false); // não reseta scroll para não perder posição
    }

    function persistAndClose() {
      applyFiltersSilently();
      closePopover(true);
    }

    function renderListOnly() {
      var query = search ? C.normalizeText(search.value) : '';
      var shown = options.filter(function (opt) {
        return !query || C.normalizeText(opt.label).indexOf(query) > -1;
      }).slice(0, 300);
      
      var frag = document.createDocumentFragment();
      if (!shown.length) frag.append(el('p', { class: 'pop-note', text: 'Nenhum valor encontrado.' }));
      
      shown.forEach(function (opt) {
        var isSelected = selected.has(opt.key);
        var wrap = el('label', { class: 'pop-opt' + (opt.key === C.EMPTY_KEY ? ' is-empty' : '') + (isSelected ? ' is-selected' : '') });
        var box = el('input', { type: 'checkbox' });
        box.checked = isSelected;
        box.style.marginRight = '12px';
        box.addEventListener('change', function (event) {
          event.stopPropagation();
          if (box.checked) selected.add(opt.key);
          else selected.delete(opt.key);
          renderListOnly();
          updateCount();
        });
        var labelSpan = el('span', { text: opt.label, title: opt.label });
        labelSpan.style.flex = '1';
        labelSpan.style.minWidth = '0';
        labelSpan.style.overflow = 'hidden';
        labelSpan.style.textOverflow = 'ellipsis';
        labelSpan.style.whiteSpace = 'nowrap';
        labelSpan.style.fontWeight = isSelected ? '700' : '500';
        labelSpan.style.color = isSelected ? 'var(--text)' : 'var(--text-2)';
        var countEm = el('em', { text: fmtInt.format(opt.count) });
        countEm.style.fontStyle = 'normal';
        countEm.style.fontSize = '12px';
        countEm.style.color = isSelected ? 'var(--accent-text)' : 'var(--muted)';
        countEm.style.fontWeight = '600';
        
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '10px';
        wrap.style.padding = '14px 16px';
        wrap.style.borderRadius = '10px';
        wrap.style.cursor = 'pointer';
        wrap.style.fontSize = '15px';
        wrap.style.border = '1px solid ' + (isSelected ? 'var(--accent)' : 'transparent');
        wrap.style.background = isSelected ? 'var(--accent-soft)' : 'transparent';
        wrap.addEventListener('click', function (event) {
          if (event.target.tagName === 'INPUT') return;
          box.checked = !box.checked;
          if (box.checked) selected.add(opt.key);
          else selected.delete(opt.key);
          renderListOnly();
          updateCount();
        });
        wrap.append(box, labelSpan, countEm);
        frag.append(wrap);
      });
      list.replaceChildren(frag);
    }

    root.append(search || document.createTextNode(''), clearBtn || document.createTextNode(''), list, foot);
    renderListOnly();
    updateCount();
    openPopover(root, anchor, 'Filtrar ' + col.label);
    if (search && canAutofocus()) setTimeout(function () { search.focus(); }, 30);
  }

  /* -------------------------------------------------- filtros: número */

  function openNumberFilter(col, anchor) {
    var existing = state.filters[col.key];
    var current = existing && existing.type === 'number' ? existing : { min: null, max: null };
    var root = el('div');
    root.append(popoverHeader('Filtrar: ' + col.label,
      'Valores de ' + C.formatMetric(col.min === null ? 0 : col.min, col.decimals) +
      ' a ' + C.formatMetric(col.max === null ? 0 : col.max, col.decimals)));

    var minInput = el('input', {
      class: 'pop-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
      placeholder: 'mínimo', 'aria-label': 'Valor mínimo', value: numberInputValue(current.min)
    });
    var maxInput = el('input', {
      class: 'pop-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
      placeholder: 'máximo', 'aria-label': 'Valor máximo', value: numberInputValue(current.max)
    });
    var row = el('div', { class: 'pop-row' });
    row.append(
      el('label', { class: 'pop-row', style: { flex: '1', minWidth: '0' } }, [minInput]),
      el('span', { class: 'pop-label', text: 'até' }),
      el('label', { class: 'pop-row', style: { flex: '1', minWidth: '0' } }, [maxInput])
    );
    var hint = el('p', { class: 'pop-note', text: 'Deixe um campo vazio para filtrar só de um lado. Aceita vírgula decimal.' });
    var error = el('p', { class: 'pop-error' });
    var links = el('div', { class: 'pop-links' });
    var clear = el('button', { class: 'link-btn muted', type: 'button', text: 'Limpar filtro' });
    links.append(clear);

    function apply() {
      var min = inputNumber(minInput.value.trim());
      var max = inputNumber(maxInput.value.trim());
      error.classList.remove('is-on');
      if (minInput.value.trim() && min === null) {
        error.textContent = 'Valor mínimo inválido. Use apenas números (ex.: 12,5).';
        error.classList.add('is-on');
        return;
      }
      if (maxInput.value.trim() && max === null) {
        error.textContent = 'Valor máximo inválido. Use apenas números (ex.: 12,5).';
        error.classList.add('is-on');
        return;
      }
      if (min !== null && max !== null && min > max) {
        error.textContent = 'O mínimo não pode ser maior que o máximo.';
        error.classList.add('is-on');
        return;
      }
      if (min === null && max === null) delete state.filters[col.key];
      else state.filters[col.key] = { type: 'number', min: min, max: max };
      applyView(true);
    }

    var debounced = debounce(apply, 280);
    [minInput, maxInput].forEach(function (input) {
      input.addEventListener('input', debounced);
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); apply(); }
      });
    });
    clear.addEventListener('click', function () {
      minInput.value = '';
      maxInput.value = '';
      delete state.filters[col.key];
      applyView(true);
      error.classList.remove('is-on');
    });

    var foot = el('div', { class: 'pop-foot' });
    var done = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Concluir' });
    done.addEventListener('click', function () { closePopover(true); });
    foot.append(el('span', { text: 'Aplica enquanto você digita' }), done);

    root.append(row, hint, error, links, foot);
    openPopover(root, anchor, 'Filtrar ' + col.label);
    if (canAutofocus()) setTimeout(function () { minInput.focus(); }, 30);
  }

  /* ---------------------------------------------------- filtros: data */

  function datePresets() {
    var now = Date.now();
    var today = dayStart(now);
    var d = new Date(today);
    var year = d.getFullYear(), month = d.getMonth();
    var yesterday = today - 86400000;
    var last7 = today - 6 * 86400000;
    var monthStart = new Date(year, month, 1).getTime();
    var prevMonthStart = new Date(year, month - 1, 1).getTime();
    var prevMonthEnd = new Date(year, month, 0, 23, 59, 59, 999).getTime();
    var yearStart = new Date(year, 0, 1).getTime();
    return {
      today: dayEnd(today),
      now: now,
      list: [
        { id: 'today', label: 'Hoje', from: today, to: dayEnd(today) },
        { id: 'yesterday', label: 'Ontem', from: yesterday, to: dayEnd(yesterday) },
        { id: 'last7', label: 'Últimos 7 dias', from: last7, to: dayEnd(today) },
        { id: 'month', label: 'Este mês', from: monthStart, to: dayEnd(today) },
        { id: 'prev', label: 'Mês passado', from: prevMonthStart, to: prevMonthEnd },
        { id: 'year', label: 'Este ano', from: yearStart, to: dayEnd(today) }
      ]
    };
  }

  function openDateFilter(col, anchor) {
    var existing = state.filters[col.key];
    var current = existing && existing.type === 'date'
      ? existing
      : { from: null, to: null };
    var presets = datePresets();

    var root = el('div');
    root.append(popoverHeader('Filtrar: ' + col.label,
      'De ' + C.formatValue(state.dataset, col.index, col.min) + ' a ' + C.formatValue(state.dataset, col.index, col.max)));

    var presetRow = el('div', { class: 'pop-presets' });
    var fromInput = el('input', { class: 'pop-input', type: 'date', 'aria-label': 'Data inicial', value: current.from !== null ? toInputDate(current.from) : '' });
    var toInput = el('input', { class: 'pop-input', type: 'date', 'aria-label': 'Data final', value: current.to !== null ? toInputDate(current.to) : '' });

    function markPreset(id) {
      Array.prototype.forEach.call(presetRow.children, function (btn) {
        btn.classList.toggle('is-active', btn.dataset.preset === id);
      });
    }

    function apply(from, to, presetId) {
      if (from !== null && to !== null && from > to) {
        var tmp = from; from = to; to = tmp;
        fromInput.value = toInputDate(from);
        toInput.value = toInputDate(to);
      }
      if (from === null && to === null) delete state.filters[col.key];
      else state.filters[col.key] = { type: 'date', from: from, to: to };
      markPreset(presetId || '');
      applyView(true);
    }

    presets.list.forEach(function (preset) {
      var btn = el('button', { class: 'preset', type: 'button', text: preset.label });
      btn.dataset.preset = preset.id;
      if (current.from === preset.from && current.to === preset.to) btn.classList.add('is-active');
      btn.addEventListener('click', function () {
        fromInput.value = toInputDate(preset.from);
        toInput.value = toInputDate(preset.to);
        apply(preset.from, preset.to, preset.id);
      });
      presetRow.append(btn);
    });

    var range = el('div', { class: 'pop-row', style: { marginTop: '2px' } });
    range.append(
      el('label', { class: 'pop-row', style: { flex: '1', minWidth: '0' } }, [fromInput]),
      el('span', { class: 'pop-label', text: 'até' }),
      el('label', { class: 'pop-row', style: { flex: '1', minWidth: '0' } }, [toInput])
    );

    function applyInputs() {
      apply(fromInputDate(fromInput.value, false), fromInputDate(toInput.value, true), '');
    }
    fromInput.addEventListener('change', applyInputs);
    toInput.addEventListener('change', applyInputs);

    var links = el('div', { class: 'pop-links' });
    var clearBtn = el('button', { class: 'link-btn muted', type: 'button', text: 'Tudo (limpar)' });
    clearBtn.addEventListener('click', function () {
      fromInput.value = '';
      toInput.value = '';
      delete state.filters[col.key];
      markPreset('');
      applyView(true);
    });
    links.append(clearBtn);

    var foot = el('div', { class: 'pop-foot' });
    var done = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Concluir' });
    done.addEventListener('click', function () { closePopover(true); });
    foot.append(el('span', { text: 'Datas no formato dia/mês/ano' }), done);

    root.append(presetRow, range, links, foot);
    openPopover(root, anchor, 'Filtrar ' + col.label);
    if (canAutofocus()) setTimeout(function () { fromInput.focus(); }, 30);
  }

  /* --------------------------------------------------- filtro unificado: texto/número/data */

  function openUnifiedFilter(col, anchor, filterType) {
    var ds = state.dataset;
    var existing = state.filters[col.key];
    var selected = new Set();
    var counts = C.uniqueCounts(ds, col.index, C.rowsExcept(ds, state.filters, col.key));
    var options = Array.from(counts.values()).sort(function (a, b) {
      return b.count - a.count || String(a.label).localeCompare(String(b.label), 'pt-BR');
    });
    var total = options.length;
    var labelByKey = new Map();
    options.forEach(function (opt) { labelByKey.set(opt.key, opt.label); });

    if (existing && existing.type === filterType && existing.values && existing.values instanceof Set) {
      existing.values.forEach(function (v) { selected.add(v); });
    } else if (filterType === 'number' && existing) {
      var min = existing.min, max = existing.max;
      options.forEach(function (opt) {
        var v = parseFloat(opt.key);
        if (!isNaN(v) && (min === null || v >= min) && (max === null || v <= max)) selected.add(opt.key);
      });
    } else if (filterType === 'date' && existing) {
      var from = existing.from, to = existing.to;
      options.forEach(function (opt) {
        var d = new Date(opt.key).getTime();
        if (!isNaN(d) && (from === null || d >= from) && (to === null || d <= to)) selected.add(opt.key);
      });
    }

    var root = el('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '8px';
    root.style.width = '340px';
    root.style.maxWidth = 'calc(100vw - 24px)';

    root.append(popoverHeader('Filtrar: ' + col.label, fmtInt.format(total) + ' valores distintos'));

    var search = null;
    if (total > 6) {
      search = el('input', {
        class: 'pop-input', type: 'text', placeholder: 'Buscar valor…',
        'aria-label': 'Buscar valor na lista', autocomplete: 'off', spellcheck: 'false'
      });
      search.style.width = '100%';
      search.style.boxSizing = 'border-box';
    }

    var list = el('div', { class: 'pop-list', role: 'group', 'aria-label': 'Valores da coluna' });
    list.style.maxHeight = '360px';
    list.style.overflowY = 'auto';
    list.style.marginBottom = '8px';

    var foot = el('div', { class: 'pop-foot' });
    foot.style.display = 'flex';
    foot.style.justifyContent = 'space-between';
    foot.style.alignItems = 'center';

    var countLabel = el('span');
    countLabel.style.fontSize = '12px';
    countLabel.style.color = 'var(--muted)';

    var btns = el('div', { class: 'pop-btns', style: { display: 'flex', gap: '6px' } });
    var applyBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Aplicar' });
    applyBtn.addEventListener('click', function () { persistAndClose(); });
    var doneBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Concluir' });
    doneBtn.style.background = 'var(--accent)';
    doneBtn.style.color = 'var(--accent-text)';
    doneBtn.addEventListener('click', function () { persistAndClose(); });
    btns.append(applyBtn, doneBtn);
    foot.append(countLabel, btns);

    var clearBtn = null;
    var colFilterActive = state.filters[col.key] && state.filters[col.key].values && state.filters[col.key].values.size > 0;
    if (colFilterActive) {
      clearBtn = el('button', { class: 'link-btn is-danger', type: 'button', text: 'Limpar este filtro' });
      clearBtn.addEventListener('click', function () {
        selected = new Set();
        delete state.filters[col.key];
        applyView(true);
        renderListOnly();
        updateCount();
        closePopover(true);
        toast('Filtro de ' + col.label + ' removido.');
      });
    }

    function updateCount() {
      if (!selected.size) {
        countLabel.textContent = fmtInt.format(total) + ' valores disponíveis';
        countLabel.style.color = 'var(--muted)';
        countLabel.style.fontWeight = '500';
      } else {
        countLabel.textContent = selected.size + ' selecionado' + (selected.size > 1 ? 's' : '') + ' de ' + fmtInt.format(total);
        countLabel.style.color = 'var(--accent-text)';
        countLabel.style.fontWeight = '700';
      }
      if (selected.size > 0 && selected.size < total) {
        doneBtn.style.background = 'var(--accent)';
        doneBtn.style.color = 'var(--accent-text)';
        doneBtn.style.fontWeight = '700';
      } else if (selected.size === total && selected.size > 0) {
        doneBtn.style.background = 'var(--accent-soft)';
        doneBtn.style.color = 'var(--accent-text)';
        doneBtn.style.fontWeight = '700';
      } else {
        doneBtn.style.background = 'var(--surface-2)';
        doneBtn.style.color = 'var(--text-2)';
        doneBtn.style.fontWeight = '600';
      }
    }

    function applyFiltersSilently() {
      if (!selected.size || selected.size === total) {
        delete state.filters[col.key];
      } else {
        state.filters[col.key] = {
          type: filterType,
          values: new Set(selected),
          onlyLabel: selected.size === 1 ? labelByKey.get(Array.from(selected)[0]) : ''
        };
      }
      applyView(false);
    }

    function persistAndClose() {
      applyFiltersSilently();
      closePopover(true);
    }

    function renderListOnly() {
      var query = search ? C.normalizeText(search.value) : '';
      var shown = options.filter(function (opt) {
        return !query || C.normalizeText(opt.label).indexOf(query) > -1;
      }).slice(0, 300);

      var frag = document.createDocumentFragment();
      if (!shown.length) frag.append(el('p', { class: 'pop-note', text: 'Nenhum valor encontrado.' }));

      shown.forEach(function (opt) {
        var isSelected = selected.has(opt.key);
        var wrap = el('label', { class: 'pop-opt' + (opt.key === C.EMPTY_KEY ? ' is-empty' : '') + (isSelected ? ' is-selected' : '') });
        var box = el('input', { type: 'checkbox' });
        box.checked = isSelected;
        box.style.marginRight = '12px';
        box.addEventListener('change', function (event) {
          event.stopPropagation();
          if (box.checked) selected.add(opt.key);
          else selected.delete(opt.key);
          renderListOnly();
          updateCount();
        });
        var labelSpan = el('span', { text: opt.label, title: opt.label });
        labelSpan.style.flex = '1';
        labelSpan.style.minWidth = '0';
        labelSpan.style.overflow = 'hidden';
        labelSpan.style.textOverflow = 'ellipsis';
        labelSpan.style.whiteSpace = 'nowrap';
        labelSpan.style.fontWeight = isSelected ? '700' : '500';
        labelSpan.style.color = isSelected ? 'var(--text)' : 'var(--text-2)';
        var countEm = el('em', { text: fmtInt.format(opt.count) });
        countEm.style.fontStyle = 'normal';
        countEm.style.fontSize = '12px';
        countEm.style.color = isSelected ? 'var(--accent-text)' : 'var(--muted)';
        countEm.style.fontWeight = '600';

        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '10px';
        wrap.style.padding = '14px 16px';
        wrap.style.borderRadius = '10px';
        wrap.style.cursor = 'pointer';
        wrap.style.fontSize = '15px';
        wrap.style.border = '1px solid ' + (isSelected ? 'var(--accent)' : 'transparent');
        wrap.style.background = isSelected ? 'var(--accent-soft)' : 'transparent';
        wrap.addEventListener('click', function (event) {
          if (event.target.tagName === 'INPUT') return;
          box.checked = !box.checked;
          if (box.checked) selected.add(opt.key);
          else selected.delete(opt.key);
          renderListOnly();
          updateCount();
        });
        wrap.append(box, labelSpan, countEm);
        frag.append(wrap);
      });
      list.replaceChildren(frag);
    }

    root.append(search || document.createTextNode(''), clearBtn || document.createTextNode(''), list, foot);
    renderListOnly();
    updateCount();
    openPopover(root, anchor, 'Filtrar ' + col.label);
    if (search && canAutofocus()) setTimeout(function () { search.focus(); }, 30);
  }

  /* --------------------------------------------------------------- menu */

  function closeMenu() {
    if (!state.menu) return;
    state.menu.remove();
    state.menu = null;
  }

  function showMenu(items, x, y, note) {
    closeMenu();
    var menu = el('div', { class: 'menu', role: 'menu' });
    if (note) menu.append(el('div', { class: 'menu-note', text: note }));
    items.forEach(function (item) {
      if (item === '-') { menu.append(el('div', { class: 'menu-sep' })); return; }
      var btn = el('button', { class: 'menu-item', type: 'button', role: 'menuitem' });
      btn.append(icon(item.icon || 'chevron-right'), el('span', { text: item.label }));
      btn.addEventListener('click', function () {
        closeMenu();
        if (item.action) item.action();
      });
      menu.append(btn);
    });
    document.body.append(menu);
    var width = menu.offsetWidth;
    var height = menu.offsetHeight;
    menu.style.left = Math.round(clamp(x, 8, window.innerWidth - width - 8)) + 'px';
    menu.style.top = Math.round(clamp(y, 8, window.innerHeight - height - 8)) + 'px';
    state.menu = menu;
  }

  function openRowMenu(event, viewIndex) {
    event.preventDefault();
    var cellNode = event.target.closest('.cell');
    if (!cellNode) return;
    var ds = state.dataset;
    var colIndex = Number(cellNode.dataset.col);
    var col = ds.columns[colIndex];
    var value = ds.rows[viewIndex][colIndex];
    var items = [];

    if (col.type === 'text' && value !== null) {
      var key = C.normalizeSetValue(value);
      items.push({
        icon: 'filter',
        label: 'Filtrar por "' + (String(value).length > 26 ? String(value).slice(0, 26) + '…' : value) + '"',
        action: function () { setTextFilter(col, [key], col.label === C.EMPTY_LABEL ? '(vazio)' : String(value)); }
      });
    }
    if (value !== null) {
      items.push({
        icon: 'copy',
        label: 'Copiar valor',
        action: function () { copyText(C.formatValue(ds, colIndex, value), 'Valor copiado.'); }
      });
    }
    items.push('-');
    items.push({ icon: 'info', label: 'Ver detalhes da linha', action: function () { openDrawer(viewIndex); } });
    showMenu(items, event.clientX, event.clientY, col.label);
  }

  /* ---------------------------------------------------------- colunas */

  function openColumnsPopover(anchor) {
    var ds = state.dataset;
    if (!ds) return;
    var selected = new Set(state.visible);
    var root = el('div');
    root.append(popoverHeader('Colunas visíveis', ds.columns.length + ' colunas na planilha'));

    var list = el('div', { class: 'pop-list' });
    var foot = el('div', { class: 'pop-foot' });
    var countLabel = el('span');
    var allBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Mostrar todas' });

    var typeLabel = { text: 'texto', number: 'número', date: 'data' };

    function refresh() {
      countLabel.textContent = selected.size + ' de ' + ds.columns.length + ' visíveis';
    }

    ds.columns.forEach(function (col) {
      var wrap = el('label', { class: 'pop-opt' });
      var box = el('input', { type: 'checkbox' });
      box.checked = selected.has(col.key);
      box.addEventListener('change', function () {
        if (box.checked) selected.add(col.key);
        else if (selected.size === 1) {
          box.checked = true;
          toast('Mantenha pelo menos uma coluna visível.', 'error');
          return;
        } else selected.delete(col.key);
        state.visible = ds.columns.map(function (c) { return c.key; }).filter(function (k) { return selected.has(k); });
        renderHead();
        renderRows(true);
        fitWidths();
        refresh();
      });
      wrap.append(box, el('span', { text: col.label, title: col.label }), el('em', { text: typeLabel[col.type] || '' }));
      list.append(wrap);
    });

    allBtn.addEventListener('click', function () {
      selected = new Set(ds.columns.map(function (c) { return c.key; }));
      state.visible = Array.from(selected);
      Array.prototype.forEach.call(list.querySelectorAll('input'), function (box) { box.checked = true; });
      renderHead();
      renderRows(true);
      fitWidths();
      refresh();
    });

    foot.append(countLabel, allBtn);
    root.append(list, foot);
    refresh();
    openPopover(root, anchor, 'Colunas visíveis');
  }

  /* ---------------------------------------------------------- ajustes */

  function openSettingsPopover(anchor) {
    if (!state.dataset) return;
    var sheet = state.sheets[state.sheetIndex];
    var root = el('div');
    root.append(popoverHeader('Ajustes da planilha', sheet ? sheet.name : ''));

    var note = el('p', {
      class: 'pop-note',
      text: 'O aplicativo procura sozinho a linha de cabeçalho. Se a planilha tem título ou subtítulo acima, informe a linha correta abaixo.'
    });
    var input = el('input', {
      class: 'pop-input', type: 'number', min: '1', max: String(sheet.matrix.length),
      value: String(sheet.headerRowIndex + 1), 'aria-label': 'Linha do cabeçalho'
    });
    var row = el('div', { class: 'pop-row' });
    row.append(el('span', { class: 'pop-label', text: 'Cabeçalho na linha' }), input);

    var info = el('p', { class: 'pop-note', text: 'Linhas de dados detectadas: ' + fmtInt.format(sheet.dataRows) + '.' });

    var foot = el('div', { class: 'pop-foot' });
    var auto = el('button', { class: 'link-btn muted', type: 'button', text: 'Usar detecção automática' });
    var applyBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Reaplicar leitura' });

    auto.addEventListener('click', function () {
      input.value = String((sheet.autoHeaderRowIndex || 0) + 1);
    });
    applyBtn.addEventListener('click', function () {
      var line = Number(input.value);
      if (!line || line < 1 || line > sheet.matrix.length) {
        toast('Informe uma linha válida (entre 1 e ' + sheet.matrix.length + ').', 'error');
        return;
      }
      if (!confirmDiscardEdits()) return;
      sheet.headerRowIndex = line - 1;
      closePopover(false);
      buildFromSheet();
      toast('Leitura refeita com o cabeçalho na linha ' + line + '.');
    });

    foot.append(auto, applyBtn);
    root.append(note, row, info, foot);
    openPopover(root, anchor, 'Ajustes da planilha');
    if (canAutofocus()) setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  /* ----------------------------------------------------------- detalhes */

  function openDrawer(viewIndex) {
    var ds = state.dataset;
    if (!ds) return;
    var row = ds.rows[viewIndex];
    state.openRow = viewIndex;
    dom.drawerTitle.textContent = 'Linha ' + fmtInt.format(ds.rowNumbers[viewIndex]);
    var dl = el('dl', { class: 'details' });
    ds.columns.forEach(function (col) {
      var value = row[col.index];
      var text = value === null ? '—' : C.formatValue(ds, col.index, value);
      var wrap = el('div', { class: 'detail' });
      var dd = el('dd', { class: col.type === 'text' ? '' : 'mono', text: text });
      if (value !== null && String(text).length > 30) dd.title = text;
      wrap.append(el('dt', { text: col.label }), dd);
      dl.append(wrap);
    });
    dom.drawerBody.replaceChildren(dl);
    dom.drawer.hidden = false;
    dom.drawerScrim.hidden = false;
    markOpenRow(viewIndex);
    dom.drawerClose.focus();
  }

  function closeDrawer() {
    dom.drawer.hidden = true;
    dom.drawerScrim.hidden = true;
    if (state.openRow !== null) {
      markOpenRow(-1);
      state.openRow = null;
    }
  }

  function copyText(text, message) {
    var done = function () { toast(message || 'Copiado.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    var area = el('textarea', { style: { position: 'fixed', opacity: '0', top: '0' } });
    area.value = text;
    document.body.append(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast('Não foi possível copiar.', 'error'); }
    area.remove();
  }

  /* ----------------------------------------------------------- exportar */

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function fileBase(suffix) {
    var name = (state.dataset && state.dataset.fileName) || 'Refugo';
    name = name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40);
    return name + '_' + (suffix || 'dados') + '_' + stamp();
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = el('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.append(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 1200);
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    return /[;"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function buildCsv(ds, view) {
    var aoa = C.exportMatrix(ds, view, false);
    var lines = aoa.map(function (row) { return row.map(csvCell).join(';'); });
    return '\uFEFF' + lines.join('\r\n');
  }

  function exportCsvFile(view, suffix) {
    var ds = state.dataset;
    if (!ds) return;
    if (!view || !view.length) { toast('Não há linhas para exportar.', 'error'); return; }
    var csv = buildCsv(ds, view);
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileBase(suffix) + '.csv');
    toast(fmtInt.format(view.length) + ' linhas exportadas em CSV.');
  }

  function exportXlsxFile(view, suffix) {
    var ds = state.dataset;
    if (!ds) return;
    if (!view || !view.length) { toast('Não há linhas para exportar.', 'error'); return; }
    try {
      var aoa = C.exportMatrix(ds, view, true);
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ds.columns.forEach(function (col, i) {
        var z = null;
        if (col.type === 'date') z = 'dd/mm/yyyy';
        else if (col.type === 'number') z = col.decimals > 0 ? '#,##0.' + new Array(col.decimals + 1).join('0') : '#,##0';
        if (!z) return;
        for (var r = 1; r <= view.length; r++) {
          var addr = XLSX.utils.encode_cell({ r: r, c: i });
          var cell = ws[addr];
          if (cell && cell.t === 'n' && cell.v !== null && cell.v !== undefined) cell.z = z;
        }
      });
      ws['!cols'] = ds.columns.map(function (col) {
        return { wch: clamp(Math.round((state.edWidths[col.key] || state.widths[col.key] || 120) / 7.4), 8, 46) };
      });
      ws['!rows'] = [{ hpt: 22 }];
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: view.length, c: ds.columns.length - 1 }
        })
      };
      var sheetName = suffix === 'todas' ? 'Dados' : 'Filtrado';
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, fileBase(suffix) + '.xlsx');
      toast(fmtInt.format(view.length) + ' linhas exportadas em Excel.');
    } catch (err) {
      console.error(err);
      toast('Não foi possível gerar o Excel. Tente o CSV.', 'error');
    }
  }

  function openExportMenu() {
    var ds = state.dataset;
    if (!ds) return;
    var rect = dom.btnExport.getBoundingClientRect();
    var filtered = state.view;
    var total = ds.rowCount;
    var hasFilter = filtered.length !== total;
    var showFiltered = hasFilter && filtered.length > 0;
    var items = [];

    if (showFiltered) {
      items.push({
        icon: 'table',
        label: 'Excel — linhas filtradas (' + fmtInt.format(filtered.length) + ')',
        action: function () { exportXlsxFile(filtered, 'filtrado'); }
      });
    }
    items.push({
      icon: 'table',
      label: 'Excel — todas as linhas (' + fmtInt.format(total) + ')',
      action: function () { exportXlsxFile(allRowIndices(ds), 'todas'); }
    });
    items.push('-');
    if (showFiltered) {
      items.push({
        icon: 'file',
        label: 'CSV — linhas filtradas (' + fmtInt.format(filtered.length) + ')',
        action: function () { exportCsvFile(filtered, 'filtrado'); }
      });
    }
    items.push({
      icon: 'file',
      label: 'CSV — todas as linhas (' + fmtInt.format(total) + ')',
      action: function () { exportCsvFile(allRowIndices(ds), 'todas'); }
    });

    var note;
    if (state.history.length) {
      note = (state.history.length === 1 ? '1 alteração' : fmtInt.format(state.history.length) + ' alterações') +
        ' em memória entram na exportação';
    } else if (hasFilter && !filtered.length) {
      note = 'Nenhuma linha no filtro atual — exporte todas as linhas';
    } else if (hasFilter) {
      note = fmtInt.format(filtered.length) + ' de ' + fmtInt.format(total) + ' linhas no filtro atual';
    } else {
      note = fmtInt.format(total) + ' linhas na planilha';
    }
    showMenu(items, rect.right - 300, rect.bottom + 6, note);
  }

  /* --------------------------------------------------------- limpar tudo */

  function clearAll() {
    state.filters = {};
    state.search = '';
    dom.search.value = '';
    dom.searchClear.hidden = true;
    applyView(true);
    closePopover(false);
    closeMenu();
    toast('Filtros limpos.');
  }

  function loadSample() {
    if (!window.RefugoSample) { toast('Exemplo indisponível.', 'error'); return; }
    if (!confirmDiscardEdits()) return;
    showLoading('Montando exemplo…', '1.200 registros de refugo');
    setTimeout(function () {
      loadMatrix(window.RefugoSample.build(), { fileName: 'Exemplo_Refugo.xlsx', sheetName: 'Exemplo' });
      hideLoading();
      toast('Base de exemplo carregada. Clique nos filtros do cabeçalho para explorar.');
    }, 120);
  }

  /* ------------------------------------------------------------- eventos */

  function bindEvents() {
    dom.btnTheme.addEventListener('click', toggleTheme);
    [dom.btnOpen, dom.btnChange, dom.btnPick].forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        dom.fileInput.click();
      });
    });
    dom.btnExport.addEventListener('click', openExportMenu);
    dom.btnEdit && dom.btnEdit.addEventListener('click', function () { openEditorModal(); });
    dom.btnInstall && dom.btnInstall.addEventListener('click', function () { installPWA(); });
    dom.btnEditClose && dom.btnEditClose.addEventListener('click', function () { closeEditorModal(); });
    dom.btnSample.addEventListener('click', loadSample);
    dom.btnColumns.addEventListener('click', function () { openColumnsPopover(dom.btnColumns); });
    dom.btnClearFilters.addEventListener('click', clearAll);
    dom.btnNoResultsClear.addEventListener('click', clearAll);

    dom.fileInput.addEventListener('change', function () {
      var file = dom.fileInput.files && dom.fileInput.files[0];
      dom.fileInput.value = '';
      if (file) openFile(file);
    });

    dom.search.addEventListener('input', debounce(function () {
      state.search = dom.search.value.trim();
      dom.searchClear.hidden = !state.search;
      applyView(true);
    }, 150));
    dom.searchClear.addEventListener('click', function () {
      state.search = '';
      dom.search.value = '';
      dom.searchClear.hidden = true;
      applyView(true);
      dom.search.focus();
    });

    dom.sheetSelect.addEventListener('change', function () {
      var next = Number(dom.sheetSelect.value) || 0;
      if (next === state.sheetIndex) return;
      if (!confirmDiscardEdits()) {
        dom.sheetSelect.value = String(state.sheetIndex);
        return;
      }
      state.sheetIndex = next;
      buildFromSheet();
      toast('Aba "' + state.sheets[state.sheetIndex].name + '" carregada.');
    });

    dom.gridScroll.addEventListener('scroll', onScroll, { passive: true });
    dom.edFiltered.addEventListener('change', function () {
      var ds = state.dataset;
      if (!ds) return;
      state.edFiltered = dom.edFiltered.checked;
      buildEdView(true);
      if (state.edFiltered) {
        toast(fmtInt.format(state.edView.length) + ' de ' + fmtInt.format(ds.rowCount) + ' linhas visíveis no editor.');
      }
    });
    dom.edGridScroll.addEventListener('scroll', onEdScroll, { passive: true });
    dom.edGridScroll.addEventListener('pointerdown', onEdPointerDown);
    dom.edGridScroll.addEventListener('keydown', onEdKeyDown);
    dom.edAddRow.addEventListener('click', addEditorRow);
    dom.edDeleteRow.addEventListener('click', deleteEditorRow);
    dom.edUndo.addEventListener('click', undoEditor);
    dom.edFxApply.addEventListener('click', applyFxValue);
    dom.edFxInput.addEventListener('keydown', onFxKeyDown);

    dom.gridRows.addEventListener('contextmenu', function (event) {
      var rowNode = event.target.closest('.grid-row');
      if (!rowNode) return;
      openRowMenu(event, Number(rowNode.dataset.row));
    });

    dom.drawerClose.addEventListener('click', closeDrawer);
    dom.drawerCloseFoot.addEventListener('click', closeDrawer);
    dom.drawerScrim.addEventListener('click', closeDrawer);
    dom.drawerCopy.addEventListener('click', function () {
      if (state.openRow === null) return;
      var ds = state.dataset;
      var values = ds.columns.map(function (col) {
        var value = ds.rows[state.openRow][col.index];
        return value === null ? '' : C.formatValue(ds, col.index, value);
      });
      copyText(values.join('\t'), 'Registro copiado — dá para colar no Excel.');
    });

    // arrastar e soltar
    var dropzone = dom.dropzone;
    ['dragenter', 'dragover'].forEach(function (type) {
      document.addEventListener(type, function (event) {
        if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') > -1) {
          event.preventDefault();
          if (!dom.workspace.hidden) dropzone.classList.remove('is-over');
          else dropzone.classList.add('is-over');
        }
      });
    });
    document.addEventListener('dragleave', function (event) {
      if (!event.relatedTarget) dropzone.classList.remove('is-over');
    });
    document.addEventListener('drop', function (event) {
      if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
      event.preventDefault();
      dropzone.classList.remove('is-over');
      openFile(event.dataTransfer.files[0]);
    });

    dropzone.addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      dom.fileInput.click();
    });
    dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dom.fileInput.click();
      }
    });

    window.addEventListener('resize', debounce(function () {
      if (!state.dataset) return;
      recomputeWidths();
      renderRows(true);
      if (dom.editorPanel && !dom.editorPanel.hidden) {
        applyEdCols();
        edFitWidths();
        renderEdRows(true);
      }
      // Removido closePopover(false) para evitar fechar ao abrir o teclado no mobile
      closeMenu();
    }, 160));

    document.addEventListener('pointerdown', function (event) {
      if (state.popover && !state.popover.contains(event.target) &&
          !(state.popoverAnchor && state.popoverAnchor.contains(event.target))) {
        closePopover(false);
      }
      if (state.menu && !state.menu.contains(event.target)) closeMenu();
    }, true);

    document.addEventListener('scroll', function (event) {
      // Removido closePopover(false) para evitar fechar ao abrir o teclado no mobile
      if (state.menu) closeMenu();
    }, true);

    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var tag = (target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable;

      if (event.key === 'Escape') {
        if (state.menu) { closeMenu(); return; }
        if (!dom.drawer.hidden) { closeDrawer(); return; }
        if (state.popover) { closePopover(true); return; }
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        dom.search.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        dom.fileInput.click();
      }
    });
  }

  /* ----------------------------------------------------------------- api */

  function exposeApi() {
    window.RefugoApp = {
      openFile: openFile,
      loadMatrix: loadMatrix,
      loadSample: loadSample,
      getState: function () { return state; },
      applyView: applyView,
      clearAll: clearAll,
      setSearch: function (text) {
        state.search = String(text || '');
        dom.search.value = state.search;
        dom.searchClear.hidden = !state.search;
        applyView(true);
      },
      setFilter: function (key, filter) {
        if (filter) state.filters[key] = filter;
        else delete state.filters[key];
        applyView(true);
      },
      setTextFilter: function (key, values) {
        var col = C.columnByKey(state.dataset, key);
        if (col) setTextFilter(col, values);
      },
      csvString: function () {
        return state.dataset ? buildCsv(state.dataset, state.view) : '';
      }
    };
  }

  function installPWA() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choiceResult) {
        if (choiceResult.outcome === 'accepted') {
          toast('Aplicativo instalado!');
        } else {
          toast('Instalação cancelada.');
        }
        deferredPrompt = null;
        if (dom.btnInstall) dom.btnInstall.hidden = true;
      });
    } else {
      // Fallback: instruções de instalação manual por plataforma
      var msg = 'Para instalar: ';
      if (navigator.userAgent.includes('Android')) {
        msg += 'toque nos 3 pontos (⋮) do Chrome → "Adicionar à tela inicial".';
      } else if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
        msg += 'toque em Compartilhar → "Adicionar à Tela de Início".';
      } else {
        msg += 'use o menu do navegador → "Instalar aplicativo" ou "Adicionar à área de trabalho".';
      }
      toast(msg, 'info');
    }
  }

  function cacheDom() {
    dom.btnTheme = $('#btnTheme');
    dom.btnOpen = $('#btnOpen');
    dom.btnExport = $('#btnExport');
    dom.btnPick = $('#btnPick');
    dom.btnSample = $('#btnSample');
    dom.btnChange = $('#btnChange');
    dom.btnEdit = $('#btnEdit');
    dom.btnInstall = $('#btnInstall');
    dom.btnColumns = $('#btnColumns');
    dom.btnClearFilters = $('#btnClearFilters');
    dom.filterHeroCats = $('#filterHeroCats');
    dom.filterHero = $('#filterHero');
    dom.filterHeroEmpty = $('#filterHeroEmpty');
    dom.btnNoResultsClear = $('#btnNoResultsClear');
    dom.fileInput = $('#fileInput');
    dom.emptyState = $('#emptyState');
    dom.workspace = $('#workspace');
    dom.dropzone = $('#dropzone');
    dom.fileName = $('#fileName');
    dom.fileMeta = $('#fileMeta');
    dom.search = $('#search');
    dom.searchClear = $('#searchClear');
    dom.sheetWrap = $('#sheetWrap');
    dom.sheetSelect = $('#sheetSelect');
    dom.chipBar = $('#chipBar');
    dom.grid = $('#grid');
    dom.gridScroll = $('#gridScroll');
    dom.gridHead = $('#gridHead');
    dom.gridCanvas = $('#gridCanvas');
    dom.gridRows = $('#gridRows') || (function () {
      var node = el('div', { class: 'grid-rows' });
      node.id = 'gridRows';
      node.setAttribute('role', 'rowgroup');
      dom.gridCanvas.append(node);
      return node;
    })();
    dom.noResults = $('#noResults');
    dom.rowInfo = $('#rowInfo');
    dom.qualityNote = $('#qualityNote');
    dom.loading = $('#loading');
    dom.loadingTitle = $('#loadingTitle');
    dom.loadingText = $('#loadingText');
    dom.drawer = $('#drawer');
    dom.drawerScrim = $('#drawerScrim');
    dom.drawerTitle = $('#drawerTitle');
    dom.drawerBody = $('#drawerBody');
    dom.drawerClose = $('#drawerClose');
    dom.drawerCloseFoot = $('#drawerCloseFoot');
    dom.drawerCopy = $('#drawerCopy');
    dom.toast = $('#toast');

    dom.editorModal = $('#editorModal');
    dom.btnEditClose = $('#btnEditClose');
    dom.editorPanel = $('#editorPanel');
    dom.edFxInput = $('#edFxInput');
    dom.edFxRef = $('#edFxRef');
    dom.edFxApply = $('#edFxApply');
    dom.edFiltered = $('#edFiltered');
    dom.edCount = $('#edCount');
    dom.edGridScroll = $('#edGridScroll');
    dom.edGrid = $('#edGrid');
    dom.edGridHead = $('#edGridHead');
    dom.edCanvas = $('#edCanvas');
    dom.edRows = $('#edRows') || (function () {
      var node = el('div', { class: 'ed-rows' });
      node.id = 'edRows';
      node.setAttribute('role', 'rowgroup');
      dom.edCanvas.append(node);
      return node;
    })();
    dom.edAddRow = $('#edAddRow');
    dom.edDeleteRow = $('#edDeleteRow');
    dom.edUndo = $('#edUndo');
    dom.edDirty = $('#edDirty');
  }

  function init() {
    cacheDom();
    initTheme();
    bindEvents();
    exposeApi();
    
    // Captura o evento de instalação do PWA
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (dom.btnInstall) dom.btnInstall.hidden = false;
    });
    
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      if (dom.btnInstall) dom.btnInstall.hidden = true;
      toast('Aplicativo instalado com sucesso!');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
