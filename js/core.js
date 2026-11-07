/* =============================================================================
 * core.js - Núcleo de leitura, tipagem e filtragem
 * Sem dependências de DOM. Roda no navegador (window.RefugoCore) e no Node
 * (module.exports) para poder ser testado.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RefugoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MS_DAY = 86400000;
  var EMPTY_KEY = '\u0000vazio';
  var EMPTY_LABEL = '(vazio)';
  var NBSP = /[\u00A0\u1680\u2000-\u200D\u202F\u205F\u3000\uFEFF]/g;
  var DIACRITICS = /[\u0300-\u036f]/g;
  var collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  var nfCache = Object.create(null);
  var dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  var dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  /* ------------------------------------------------------------------ texto */

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return isNaN(value) ? '' : dateFmt.format(value);
    var s = String(value).replace(NBSP, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function normalizeText(value) {
    var s = cleanText(value);
    if (!s) return '';
    if (s.normalize) s = s.normalize('NFD').replace(DIACRITICS, '');
    return s.toLowerCase();
  }

  function slugify(value) {
    var n = normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return n || 'coluna';
  }

  function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return cleanText(value) === '';
    return false;
  }

  /* ------------------------------------------------------------------ número */

  /** Define como a coluna escreve números quando eles vêm como texto. */
  function detectNumberStyle(values) {
    var sample = [];
    for (var i = 0; i < values.length && sample.length < 400; i++) {
      var v = values[i];
      if (typeof v === 'string' && /[.,]/.test(v)) sample.push(cleanText(v));
    }
    if (!sample.length) return 'br';
    var both = false, dotOnly = [], commaOnly = [];
    for (var j = 0; j < sample.length; j++) {
      var s = sample[j];
      var hasDot = s.indexOf('.') > -1, hasComma = s.indexOf(',') > -1;
      if (hasDot && hasComma) {
        var d = s.lastIndexOf('.'), c = s.lastIndexOf(',');
        if (c > d) return 'br';
        both = true;
      } else if (hasComma) commaOnly.push(s);
      else if (hasDot) dotOnly.push(s);
    }
    if (both) return 'en';
    if (commaOnly.length) return 'br';
    if (dotOnly.length) {
      // 1.234 / 12.345.678 => separador de milhar (pt-BR)
      var looksGrouped = dotOnly.every(function (s) {
        return /^\d{1,3}(\.\d{3})+$/.test(s.replace(/[^\d.]/g, ''));
      });
      return looksGrouped ? 'br' : 'en';
    }
    return 'br';
  }

  /**
   * Converte texto em número aceitando pt-BR ("1.234,56"), en-US ("1,234.56"),
   * moeda ("R$ 12,50"), negativos entre parênteses e sufixos de unidade.
   */
  function parseNumber(value, style) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (value instanceof Date) return null;
    if (value === null || value === undefined) return null;

    var s = cleanText(value);
    if (!s) return null;

    var negative = /^\(.*\)$/.test(s);
    if (negative) s = s.slice(1, -1);
    s = s.replace(/R\$|US\$|USD|EUR|BRL/gi, '');
    s = s.replace(/[^0-9.,+\-]/g, '');
    if (!s || !/[0-9]/.test(s)) return null;

    if (s.charAt(0) === '-') { negative = true; s = s.slice(1); }
    s = s.replace(/[+\-]/g, '');
    s = s.replace(/[.,]+$/, '');
    if (!s) return null;

    var hasDot = s.indexOf('.') > -1, hasComma = s.indexOf(',') > -1, out;

    if (hasDot && hasComma) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) out = s.replace(/\./g, '').replace(',', '.');
      else out = s.replace(/,/g, '');
    } else if (hasComma) {
      var parts = s.split(',');
      if (parts.length > 2) out = s.replace(/,/g, '');
      else if (style === 'en') out = s.replace(',', '.');
      else out = s.replace(',', '.');
    } else if (hasDot) {
      out = style === 'en' ? s : s.replace(/\./g, '');
      // "12.5" isolado em coluna pt-BR: ponto com 1 ou 2 casas é decimal
      if (style !== 'en' && /^\d{1,3}(\.\d{1,2})$/.test(s)) out = s;
    } else {
      out = s;
    }

    if (!/^\d+(\.\d+)?$/.test(out)) return null;
    var n = Number(out);
    if (!isFinite(n)) return null;
    return negative ? -n : n;
  }

  /* -------------------------------------------------------------------- data */

  function serialToMs(serial) {
    var utc = Date.UTC(1899, 11, 30) + serial * MS_DAY;
    var d = new Date(Math.round(utc));
    return new Date(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()
    ).getTime();
  }

  function buildDate(y, m, d, hh, mm, ss) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (y < 100) y += y <= 69 ? 2000 : 1900;
    if (y < 1900 || y > 2200) return null;
    var dt = new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt.getTime();
  }

  function parseDate(value) {
    if (value instanceof Date) return isNaN(value) ? null : value.getTime();
    if (typeof value === 'number') {
      if (value > 20000 && value < 80000) return serialToMs(value);
      return null;
    }
    if (value === null || value === undefined) return null;
    var s = cleanText(value);
    if (!s) return null;

    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return buildDate(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return buildDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      var t = Date.parse(s);
      return isFinite(t) ? t : null;
    }
    return null;
  }

  /* ------------------------------------------------- edição (editor) */

  function decimalDigits(n) {
    var frac = Math.abs(n - Math.trunc(n));
    var digits = String(Math.round(frac * 1000) / 1000).split('.')[1];
    return digits ? Math.min(digits.length, 3) : 0;
  }

  function applyUnitDecimals(col) {
    if (col.type !== 'number') return;
    if (col.unit === 'kg') col.decimals = Math.max(col.decimals, 3);
    else if (col.unit === 'cm' || col.unit === 'money') col.decimals = Math.max(col.decimals, 2);
    if (col.max !== null && Math.abs(col.max) < 1 && col.max !== 0) col.decimals = Math.max(col.decimals, 2);
  }

  /** Recalcula estatísticas de uma coluna após edição. */
  function refreshColumnStats(dataset, colIndex) {
    var col = dataset.columns[colIndex];
    if (!col) return;
    col.filled = 0;
    col.invalid = 0;
    col.min = null;
    col.max = null;
    col.decimals = 0;
    var rows = dataset.rows;
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][colIndex];
      if (v === null || v === undefined) continue;
      if (col.type === 'number') {
        if (typeof v !== 'number' || !isFinite(v)) { col.invalid++; continue; }
        col.filled++;
        if (col.min === null || v < col.min) col.min = v;
        if (col.max === null || v > col.max) col.max = v;
        col.decimals = Math.max(col.decimals, decimalDigits(v));
      } else if (col.type === 'date') {
        if (typeof v !== 'number' || !isFinite(v)) { col.invalid++; continue; }
        col.filled++;
        if (col.min === null || v < col.min) col.min = v;
        if (col.max === null || v > col.max) col.max = v;
      } else {
        col.filled++;
      }
    }
    applyUnitDecimals(col);
  }

  function refreshAllStats(dataset) {
    for (var i = 0; i < dataset.columns.length; i++) refreshColumnStats(dataset, i);
    dataset._search = null;
    dataset._totals = Object.create(null);
  }

  /** Converte um texto digitado no valor interno do tipo da coluna. */
  function coerceCell(col, raw) {
    if (!col) return { ok: false, error: 'Coluna inválida.' };
    if (isEmpty(raw)) return { ok: true, value: null };
    if (col.type === 'number') {
      var n = parseNumber(raw, col.numberStyle);
      if (n === null) return { ok: false, error: 'Valor numérico inválido em "' + col.label + '".' };
      return { ok: true, value: n };
    }
    if (col.type === 'date') {
      var ms = parseDate(raw);
      if (ms === null) return { ok: false, error: 'Data inválida em "' + col.label + '". Use dia/mês/ano.' };
      return { ok: true, value: ms };
    }
    var txt = cleanText(raw);
    return { ok: true, value: txt === '' ? null : txt };
  }

  /** Aplica um valor digitado em uma célula e atualiza as estatísticas. */
  function setCellValue(dataset, rowIndex, colIndex, raw) {
    if (!dataset.rows[rowIndex]) return { ok: false, error: 'Linha inválida.' };
    var col = dataset.columns[colIndex];
    var res = coerceCell(col, raw);
    if (!res.ok) return res;
    dataset.rows[rowIndex][colIndex] = res.value;
    refreshColumnStats(dataset, colIndex);
    dataset._search = null;
    dataset._totals = Object.create(null);
    return { ok: true, value: res.value };
  }

  /** Cria uma linha vazia no fim da base. */
  function addRow(dataset) {
    var width = dataset.columns.length;
    var row = new Array(width);
    for (var i = 0; i < width; i++) row[i] = null;
    dataset.rows.push(row);
    var last = dataset.rowNumbers.length
      ? dataset.rowNumbers[dataset.rowNumbers.length - 1]
      : dataset.headerRowNumber;
    dataset.rowNumbers.push(last + 1);
    dataset.rowCount = dataset.rows.length;
    dataset._search = null;
    dataset._totals = Object.create(null);
    return dataset.rows.length - 1;
  }

  function removeRow(dataset, rowIndex) {
    if (!dataset.rows[rowIndex]) return false;
    dataset.rows.splice(rowIndex, 1);
    dataset.rowNumbers.splice(rowIndex, 1);
    dataset.rowCount = dataset.rows.length;
    dataset._search = null;
    dataset._totals = Object.create(null);
    return true;
  }

  /** Reinsere uma linha (usado pelo desfazer da exclusão). */
  function insertRow(dataset, rowIndex, values, rowNumber) {
    var width = dataset.columns.length;
    var row = new Array(width);
    for (var i = 0; i < width; i++) {
      row[i] = values && values[i] !== undefined ? values[i] : null;
    }
    var at = Math.max(0, Math.min(rowIndex, dataset.rows.length));
    dataset.rows.splice(at, 0, row);
    var num = rowNumber;
    if (num === null || num === undefined) {
      num = at > 0 && dataset.rowNumbers[at - 1] ? dataset.rowNumbers[at - 1] + 1 : dataset.headerRowNumber + 1;
    }
    dataset.rowNumbers.splice(at, 0, num);
    dataset.rowCount = dataset.rows.length;
    dataset._search = null;
    dataset._totals = Object.create(null);
    return at;
  }

  /** Cópia leve para a pilha de desfazer. */
  function snapshotDataset(dataset) {
    return {
      rows: dataset.rows.map(function (row) { return row.slice(); }),
      rowNumbers: dataset.rowNumbers.slice()
    };
  }

  function restoreSnapshot(dataset, snapshot) {
    if (!snapshot) return false;
    dataset.rows = snapshot.rows.map(function (row) { return row.slice(); });
    dataset.rowNumbers = snapshot.rowNumbers.slice();
    dataset.rowCount = dataset.rows.length;
    refreshAllStats(dataset);
    return true;
  }

  /** Texto do valor no formato aceito pelo editor. */
  function editableValue(dataset, colIdx, value) {
    var col = dataset.columns[colIdx];
    if (value === null || value === undefined) return '';
    if (col.type === 'number') return String(value).replace('.', ',');
    if (col.type === 'date') {
      var d = new Date(value);
      return String(d.getDate()).padStart(2, '0') + '/' +
        String(d.getMonth() + 1).padStart(2, '0') + '/' +
        d.getFullYear();
    }
    return String(value);
  }

  /* ------------------------------------------------------ reconhecimento */

  var KNOWN = [
    { match: ['item base'], role: 'text' },
    { match: ['item codigo', 'codigo item', 'cod item', 'codigo'], role: 'text' },
    { match: ['item descricao', 'descricao item', 'descricao'], role: 'text' },
    { match: ['dt fundicao', 'data fundicao'], role: 'date' },
    { match: ['turno'], role: 'text' },
    { match: ['processo'], role: 'text' },
    { match: ['motivo refugo', 'motivo'], role: 'text' },
    { match: ['data apont', 'data apontamento', 'dt apont'], role: 'date' },
    { match: ['maq', 'maquina'], role: 'text' },
    { match: ['nr figura', 'numero figura', 'figura'], role: 'text' },
    { match: ['nr molde', 'numero molde', 'molde'], role: 'text' },
    { match: ['obs refugo', 'observacao refugo', 'observacao', 'obs'], role: 'text' },
    { match: ['kg refugo', 'kg'], role: 'number' },
    { match: ['qtde refugo', 'qtd refugo', 'qtde', 'qtd', 'quantidade'], role: 'number' },
    { match: ['cm refugo', 'cm'], role: 'number' }
  ];

  function normHeader(label) {
    return normalizeText(label).replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function unitFromHeader(label) {
    var key = normHeader(label);
    if (/(^| )kg( |$)/.test(key)) return 'kg';
    if (/(^| )qtde( |$)/.test(key) || /(^| )qtd( |$)/.test(key) || /(^| )quantidade( |$)/.test(key)) return 'qty';
    if (/^cm( |$)/.test(key)) return 'cm';
    if (/(^| )(valor|custo|preco|total|montante|vlr)( |$)/.test(key)) return 'money';
    return null;
  }

  function roleFromHeader(label) {
    var key = normHeader(label);
    for (var i = 0; i < KNOWN.length; i++) {
      var entry = KNOWN[i];
      for (var j = 0; j < entry.match.length; j++) {
        if (key === entry.match[j]) return entry.role;
      }
    }
    if (/(^| )kg( |$)/.test(key) || /(^| )qtd(e)?( |$)/.test(key) || /^cm /.test(key)) return 'number';
    if (/^(dt|data) /.test(key)) return 'date';
    return null;
  }

  function detectType(values, role) {
    if (role === 'date' || role === 'number' || role === 'text') return role;
    var total = 0, num = 0, dt = 0;
    var style = detectNumberStyle(values);
    for (var i = 0; i < values.length && total < 3000; i++) {
      var v = values[i];
      if (isEmpty(v)) continue;
      total++;
      if (parseNumber(v, style) !== null) num++;
      if (parseDate(v) !== null) dt++;
    }
    if (!total) return 'text';
    if (dt / total >= 0.8) return 'date';
    if (num / total >= 0.85) return 'number';
    return 'text';
  }

  /* ------------------------------------------------ detecção do cabeçalho */

  function scoreHeaderRow(row) {
    var nonEmpty = 0, texty = 0, seen = Object.create(null), dupes = 0;
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (isEmpty(v)) continue;
      nonEmpty++;
      if (typeof v === 'string' || v instanceof Date) texty++;
      var k = normalizeText(v);
      if (!k) continue;
      if (seen[k]) dupes++; else seen[k] = 1;
    }
    if (nonEmpty < 3) return -1;
    return nonEmpty * 2 + texty - dupes * 3;
  }

  /** Procura a linha de cabeçalho nas primeiras linhas da matriz. */
  function detectHeaderRow(matrix) {
    var best = 0, bestScore = -1, limit = Math.min(matrix.length, 20);
    for (var i = 0; i < limit; i++) {
      var score = scoreHeaderRow(matrix[i] || []);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore < 0 ? 0 : best;
  }

  /* ------------------------------------------------------- construção base */

  function createDataset(options) {
    var matrix = options.matrix;
    var headerIndex = options.headerRowIndex != null ? options.headerRowIndex : detectHeaderRow(matrix);
    var headerRow = matrix[headerIndex] || [];
    var bodyRows = matrix.slice(headerIndex + 1);

    var width = 0;
    for (var r = 0; r < bodyRows.length; r++) width = Math.max(width, (bodyRows[r] || []).length);
    width = Math.max(width, headerRow.length);

    // descarta colunas totalmente vazias no final
    while (width > 0) {
      var hasHeader = !isEmpty(headerRow[width - 1]);
      var hasData = false;
      for (var i = 0; i < bodyRows.length; i++) {
        if (!isEmpty((bodyRows[i] || [])[width - 1])) { hasData = true; break; }
      }
      if (hasHeader || hasData) break;
      width--;
    }

    var headers = [], seen = Object.create(null);
    for (var c = 0; c < width; c++) {
      var label = cleanText(headerRow[c]);
      if (!label) label = 'Coluna ' + (c + 1);
      var key = slugify(label), base = key, n = 2;
      while (seen[key]) key = base + '-' + (n++);
      seen[key] = 1;
      headers.push({ label: label, key: key, index: c, role: roleFromHeader(label) });
    }

    // amostra por coluna (para tipagem e estilo numérico)
    var sampleByCol = headers.map(function () { return []; });
    var nonBlankRows = [];
    var rowNumbers = [];
    for (var b = 0; b < bodyRows.length; b++) {
      var row = bodyRows[b] || [];
      var any = false;
      for (var d = 0; d < width; d++) {
        var val = row[d];
        if (!isEmpty(val)) {
          any = true;
          if (sampleByCol[d].length < 3000) sampleByCol[d].push(val);
        }
      }
      if (any) {
        nonBlankRows.push(row);
        rowNumbers.push(headerIndex + b + 2); // linha real na planilha (1-based)
      }
    }

    var columns = headers.map(function (h) {
      var style = detectNumberStyle(sampleByCol[h.index]);
      var type = detectType(sampleByCol[h.index], h.role);
      return {
        key: h.key, label: h.label, index: h.index, role: h.role,
        unit: unitFromHeader(h.label),
        type: type, numberStyle: style, decimals: 0,
        min: null, max: null, invalid: 0, filled: 0, unique: 0
      };
    });

    var rows = new Array(nonBlankRows.length);
    for (var k = 0; k < nonBlankRows.length; k++) {
      var src = nonBlankRows[k];
      var out = new Array(width);
      for (var j = 0; j < width; j++) {
        var col = columns[j];
        var raw = src[j];
        if (isEmpty(raw)) { out[j] = null; continue; }
        if (col.type === 'number') {
          var num = parseNumber(raw, col.numberStyle);
          out[j] = num;
          if (num === null) col.invalid++;
          else {
            col.filled++;
            if (col.min === null || num < col.min) col.min = num;
            if (col.max === null || num > col.max) col.max = num;
            var frac = Math.abs(num - Math.trunc(num));
            var digits = String(Math.round(frac * 1000) / 1000).split('.')[1];
            col.decimals = Math.max(col.decimals, digits ? Math.min(digits.length, 3) : 0);
          }
        } else if (col.type === 'date') {
          var dt = parseDate(raw);
          out[j] = dt;
          if (dt === null) col.invalid++;
          else {
            col.filled++;
            if (col.min === null || dt < col.min) col.min = dt;
            if (col.max === null || dt > col.max) col.max = dt;
          }
        } else {
          var txt = cleanText(raw);
          out[j] = txt;
          col.filled++;
        }
      }
      rows[k] = out;
    }

    columns.forEach(function (col) {
      applyUnitDecimals(col);
    });

    return {
      columns: columns,
      rows: rows,
      rowNumbers: rowNumbers,
      rowCount: rows.length,
      headerRowIndex: headerIndex,
      headerRowNumber: headerIndex + 1,
      sourceWidth: width,
      sheetName: options.sheetName || '',
      fileName: options.fileName || '',
      _uniques: Object.create(null),
      _search: null
    };
  }

  /* ------------------------------------------------------------- formatação */

  function formatter(decimals) {
    var key = String(decimals);
    if (!nfCache[key]) {
      nfCache[key] = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }
    return nfCache[key];
  }

  function formatValue(dataset, colIdx, value) {
    var col = dataset.columns[colIdx];
    if (value === null || value === undefined || value === '') return '';
    if (col.type === 'number') return formatter(col.decimals).format(value);
    if (col.type === 'date') {
      var d = new Date(value);
      var hasTime = d.getHours() || d.getMinutes();
      return hasTime ? dateTimeFmt.format(d) : dateFmt.format(d);
    }
    return String(value);
  }

  function formatMetric(value, decimals) {
    return formatter(decimals == null ? 0 : decimals).format(value);
  }

  /** Texto curto usado em chips e resumos de filtro. */
  function describeFilter(dataset, filter) {
    if (!filter) return '';
    if (filter.type === 'text') {
      var n = filter.values instanceof Set ? filter.values.size : 0;
      if (n === 0) return 'nenhum valor';
      if (n === 1) {
        var only = filter.values.values().next().value;
        return only === EMPTY_KEY ? '(vazio)' : filter._label || '1 valor';
      }
      return n + ' valores';
    }
    if (filter.type === 'number') {
      var f = function (v) { return formatMetric(v, 0); };
      if (filter.min != null && filter.max != null) return f(filter.min) + ' a ' + f(filter.max);
      if (filter.min != null) return '≥ ' + f(filter.min);
      if (filter.max != null) return '≤ ' + f(filter.max);
    }
    if (filter.type === 'date') {
      var g = function (v) { return dateFmt.format(new Date(v)); };
      if (filter.from != null && filter.to != null) return g(filter.from) + ' a ' + g(filter.to);
      if (filter.from != null) return 'a partir de ' + g(filter.from);
      if (filter.to != null) return 'até ' + g(filter.to);
    }
    return '';
  }

  /* ------------------------------------------------------------- filtragem */

  function normalizeSetValue(value) {
    var n = normalizeText(value);
    return n || EMPTY_KEY;
  }

  function buildSearchBlob(dataset) {
    return dataset.rows.map(function (row) {
      var parts = new Array(row.length);
      for (var i = 0; i < row.length; i++) {
        var v = row[i];
        if (v === null) { parts[i] = ''; continue; }
        var col = dataset.columns[i];
        parts[i] = col.type === 'date' ? formatValue(dataset, i, v) : normalizeText(v);
      }
      return parts.join(' \u0001 ');
    });
  }

  function getSearchBlob(dataset) {
    if (!dataset._search) dataset._search = buildSearchBlob(dataset);
    return dataset._search;
  }

  function activeFilterList(filters) {
    var out = [];
    if (!filters) return out;
    for (var key in filters) {
      var f = filters[key];
      if (!f) continue;
      if (f.type === 'text') {
        if (f.values instanceof Set) out.push(key);
      } else if (f.type === 'number') {
        if (f.min != null || f.max != null) out.push(key);
      } else if (f.type === 'date') {
        if (f.from != null || f.to != null) out.push(key);
      }
    }
    return out;
  }

  /**
   * Filtra as linhas aplicando todos os filtros de coluna + busca global.
   * @returns {Uint32Array} índices das linhas que passaram
   */
  function filterRows(dataset, filters) {
    var rows = dataset.rows, cols = dataset.columns;
    var active = [];
    if (filters) {
      for (var key in filters) {
        var f = filters[key];
        if (!f) continue;
        if (f.type === 'text' && f.values instanceof Set) active.push({ col: key, f: f });
        else if (f.type === 'number' && (f.min != null || f.max != null)) active.push({ col: key, f: f });
        else if (f.type === 'date' && (f.from != null || f.to != null)) active.push({ col: key, f: f });
      }
    }

    var colIndexByKey = Object.create(null);
    for (var i = 0; i < cols.length; i++) colIndexByKey[cols[i].key] = i;

    var predicates = active.map(function (item) {
      var idx = colIndexByKey[item.col];
      var f = item.f;
      if (f.type === 'text') {
        var set = f.values;
        if (!set || set.size === 0) return function () { return false; };
        if (set.has(EMPTY_KEY)) {
          return function (row) {
            var v = row[idx];
            return v === null ? true : set.has(normalizeText(v));
          };
        }
        return function (row) {
          var v = row[idx];
          return v !== null && set.has(normalizeText(v));
        };
      }
      if (f.type === 'number') {
        return function (row) {
          var v = row[idx];
          if (v === null) return false;
          if (f.min != null && v < f.min) return false;
          if (f.max != null && v > f.max) return false;
          return true;
        };
      }
      return function (row) {
        var v = row[idx];
        if (v === null) return false;
        if (f.from != null && v < f.from) return false;
        if (f.to != null && v > f.to) return false;
        return true;
      };
    });

    var terms = String(filters && filters.__search || '').trim();
    var termList = [];
    if (terms) {
      var blob = getSearchBlob(dataset);
      termList = normalizeText(terms).split(' ').filter(Boolean);
      var out = [];
      for (var r = 0; r < rows.length; r++) {
        var ok = true;
        for (var p = 0; p < predicates.length; p++) if (!predicates[p](rows[r])) { ok = false; break; }
        if (!ok) continue;
        var hay = blob[r];
        var all = true;
        for (var t = 0; t < termList.length; t++) {
          if (hay.indexOf(termList[t]) === -1) { all = false; break; }
        }
        if (all) out.push(r);
      }
      return Uint32Array.from(out);
    }

    var result = [];
    for (var q = 0; q < rows.length; q++) {
      var keep = true;
      for (var s = 0; s < predicates.length; s++) if (!predicates[s](rows[q])) { keep = false; break; }
      if (keep) result.push(q);
    }
    return Uint32Array.from(result);
  }

  /** Índices de linha que passam em todos os filtros, exceto o da coluna informada. */
  function rowsExcept(dataset, filters, columnKey) {
    if (!filters) return null;
    var copy = Object.create(null);
    for (var k in filters) if (k !== columnKey) copy[k] = filters[k];
    copy.__search = filters.__search || '';
    return filterRows(dataset, copy);
  }

  /* ------------------------------------------------------------- agregação */

  function uniqueCounts(dataset, colIdx, rowIndices) {
    var map = new Map();
    var rows = dataset.rows;
    var iterate = rowIndices || null;
    var n = iterate ? iterate.length : rows.length;
    for (var i = 0; i < n; i++) {
      var idx = iterate ? iterate[i] : i;
      var v = rows[idx][colIdx];
      var key = v === null ? EMPTY_KEY : normalizeSetValue(v);
      var entry = map.get(key);
      if (entry) entry.count++;
      else map.set(key, { key: key, label: v === null ? EMPTY_LABEL : String(v), count: 1 });
    }
    return map;
  }

  function sumColumn(dataset, colIdx, rowIndices) {
    var s = 0, rows = dataset.rows;
    for (var i = 0; i < rowIndices.length; i++) {
      var v = rows[rowIndices[i]][colIdx];
      if (typeof v === 'number') s += v;
    }
    return s;
  }

  function groupSum(dataset, rowIndices, dimIdx, metricIdx) {
    var map = new Map();
    var rows = dataset.rows;
    for (var i = 0; i < rowIndices.length; i++) {
      var row = rows[rowIndices[i]];
      var raw = row[dimIdx];
      var key = raw === null ? EMPTY_KEY : normalizeSetValue(raw);
      var entry = map.get(key);
      if (!entry) {
        entry = { key: key, label: raw === null ? EMPTY_LABEL : String(raw), count: 0, total: 0 };
        map.set(key, entry);
      }
      entry.count++;
      if (metricIdx != null && typeof row[metricIdx] === 'number') entry.total += row[metricIdx];
    }
    return Array.from(map.values());
  }

  /* ---------------------------------------------------------------- ordenar */

  function sortIndices(dataset, indices, colIdx, direction) {
    var arr = Array.prototype.slice.call(indices);
    if (direction === 0) return arr;
    var rows = dataset.rows;
    var col = dataset.columns[colIdx];
    var factor = direction === 1 ? 1 : -1;
    arr.sort(function (a, b) {
      var va = rows[a][colIdx], vb = rows[b][colIdx];
      if (va === null && vb === null) return a - b;
      if (va === null) return 1;
      if (vb === null) return -1;
      var cmp;
      if (col.type === 'number' || col.type === 'date') cmp = va - vb;
      else cmp = collator.compare(String(va), String(vb));
      if (cmp === 0) return a - b;
      return cmp * factor;
    });
    return arr;
  }

  /* ---------------------------------------------------------------- export */

  function exportMatrix(dataset, rowIndices, typed) {
    var header = dataset.columns.map(function (c) { return c.label; });
    var out = [header];
    for (var i = 0; i < rowIndices.length; i++) {
      var row = dataset.rows[rowIndices[i]];
      var line = new Array(row.length);
      for (var j = 0; j < row.length; j++) {
        var v = row[j];
        if (v === null) line[j] = typed ? null : '';
        else if (typed) {
          var col = dataset.columns[j];
          if (col.type === 'number') line[j] = v;
          else if (col.type === 'date') line[j] = new Date(v);
          else line[j] = formatValue(dataset, j, v);
        } else line[j] = formatValue(dataset, j, v);
      }
      out.push(line);
    }
    return out;
  }

  /* ---------------------------------------------------------------- chaves */

  function columnByKey(dataset, key) {
    for (var i = 0; i < dataset.columns.length; i++) {
      if (dataset.columns[i].key === key) return dataset.columns[i];
    }
    return null;
  }

  return {
    EMPTY_KEY: EMPTY_KEY,
    EMPTY_LABEL: EMPTY_LABEL,
    MS_DAY: MS_DAY,
    cleanText: cleanText,
    normalizeText: normalizeText,
    slugify: slugify,
    isEmpty: isEmpty,
    parseNumber: parseNumber,
    parseDate: parseDate,
    serialToMs: serialToMs,
    detectNumberStyle: detectNumberStyle,
    detectType: detectType,
    detectHeaderRow: detectHeaderRow,
    createDataset: createDataset,
    formatValue: formatValue,
    formatMetric: formatMetric,
    formatter: formatter,
    describeFilter: describeFilter,
    normalizeSetValue: normalizeSetValue,
    getSearchBlob: getSearchBlob,
    activeFilterList: activeFilterList,
    filterRows: filterRows,
    rowsExcept: rowsExcept,
    uniqueCounts: uniqueCounts,
    sumColumn: sumColumn,
    groupSum: groupSum,
    sortIndices: sortIndices,
    exportMatrix: exportMatrix,
    columnByKey: columnByKey,
    decimalDigits: decimalDigits,
    applyUnitDecimals: applyUnitDecimals,
    refreshColumnStats: refreshColumnStats,
    refreshAllStats: refreshAllStats,
    coerceCell: coerceCell,
    setCellValue: setCellValue,
    addRow: addRow,
    removeRow: removeRow,
    insertRow: insertRow,
    snapshotDataset: snapshotDataset,
    restoreSnapshot: restoreSnapshot,
    editableValue: editableValue
  };
});

