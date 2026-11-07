/* Testes do núcleo: node tests/core.test.js */
'use strict';
const assert = require('assert');
const C = require('../js/core.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    console.error(err && err.stack || err);
    process.exitCode = 1;
  }
}

console.log('\nTexto e normalização');
test('remove acentos, NBSP e espaços duplicados', () => {
  assert.strictEqual(C.normalizeText('  Máq.\u00A0 01 '), 'maq. 01');
  assert.strictEqual(C.normalizeText('FUNDIÇÃO'), 'fundicao');
  assert.strictEqual(C.cleanText('\u00A0 Item   A '), 'Item A');
});

console.log('\nNúmeros');
test('formatos pt-BR', () => {
  assert.strictEqual(C.parseNumber('1.234,56'), 1234.56);
  assert.strictEqual(C.parseNumber('12,5'), 12.5);
  assert.strictEqual(C.parseNumber('R$ 1.234,56'), 1234.56);
  assert.strictEqual(C.parseNumber('(123,45)'), -123.45);
  assert.strictEqual(C.parseNumber('-10'), -10);
  assert.strictEqual(C.parseNumber('2,5 kg'), 2.5);
});
test('formatos en-US', () => {
  assert.strictEqual(C.parseNumber('1,234.56'), 1234.56);
  assert.strictEqual(C.parseNumber('0.5'), 0.5);
});
test('rejeita texto', () => {
  assert.strictEqual(C.parseNumber('abc'), null);
  assert.strictEqual(C.parseNumber(''), null);
  assert.strictEqual(C.parseNumber(null), null);
});
test('detecta estilo da coluna', () => {
  assert.strictEqual(C.detectNumberStyle(['1.234,56', '2,5']), 'br');
  assert.strictEqual(C.detectNumberStyle(['1,234.56', '0.5']), 'en');
  assert.strictEqual(C.detectNumberStyle(['1.234', '2.345']), 'br');
});

console.log('\nDatas');
test('dd/mm/aaaa, aaaa-mm-dd e serial do Excel', () => {
  const a = C.parseDate('07/11/2026');
  const b = C.parseDate('2026-11-07');
  assert.strictEqual(a, new Date(2026, 10, 7).getTime());
  assert.strictEqual(a, b);
  assert.strictEqual(C.parseDate(46333), new Date(2026, 10, 7).getTime());
  assert.strictEqual(C.parseDate(new Date(2026, 10, 7)), new Date(2026, 10, 7).getTime());
});
test('data inválida não passa', () => {
  assert.strictEqual(C.parseDate('31/02/2026'), null);
  assert.strictEqual(C.parseDate('1234'), null);
  assert.strictEqual(C.parseDate(''), null);
});

console.log('\nCabeçalho e base');
const header = ['Item - Base', 'Item - Código', 'Item - Descrição', 'Dt Fundição', 'Turno',
  'Processo', 'Motivo Refugo', 'Data Apont.', 'Máq.', 'Nr Figura', 'Nr Molde',
  'Obs. Refugo', 'Kg Refugo', 'Qtde Refugo', 'CM Refugo'];
const matrix = [
  ['Relatório de refugo - teste'],
  [],
  header,
  ['Base A', '000123', 'Peça de aço', new Date(2026, 0, 5), 'A', 'Fundição', 'Bolha', new Date(2026, 0, 6), 'M1', 'F-01', '100', 'observação', 1.5, 2, 10.5],
  ['Base B', '000124', 'Peça de alumínio', '10/01/2026', 'B', 'Fundição', 'Rebarba', '11/01/2026', 'M2', 'F-02', '101', '', '2,25', '3', 'R$ 20,00'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ['Base C', '000125', 'Peça quebrada', '31/01/2026', 'A', 'Usinagem', 'Trinca', '01/02/2026', 'M1', 'F-03', '102', 'linha\ncom quebra', '0,75', '1', '5'],
  ['Base D', '000126', 'Peça ok', 'data ruim', 'C', 'Usinagem', 'Trinca', '', 'M3', 'F-04', '103', '', 'x', 'y', 'z']
];

test('encontra a linha de cabeçalho', () => {
  assert.strictEqual(C.detectHeaderRow(matrix), 2);
});

const ds = C.createDataset({ matrix, headerRowIndex: 2, fileName: 'teste.xlsx', sheetName: 'Sheet1' });
test('reconhece as colunas e os tipos', () => {
  assert.strictEqual(ds.columns.length, 15);
  assert.strictEqual(ds.rowCount, 4, 'ignora linha totalmente vazia');
  assert.strictEqual(ds.columns[3].type, 'date');
  assert.strictEqual(ds.columns[7].type, 'date');
  assert.strictEqual(ds.columns[12].type, 'number');
  assert.strictEqual(ds.columns[8].type, 'text', 'Máq. é categórica');
  assert.strictEqual(ds.columns[1].type, 'text', 'código preserva zeros');
  assert.strictEqual(ds.rows[0][1], '000123');
  assert.strictEqual(ds.rows[1][12], 2.25);
  assert.strictEqual(ds.rows[1][14], 20);
  assert.strictEqual(ds.rowNumbers[0], 4, 'linha real na planilha');
});
test('conta valores inválidos sem quebrar', () => {
  assert.strictEqual(ds.columns[12].invalid, 1);
  assert.strictEqual(ds.columns[13].invalid, 1);
  assert.strictEqual(ds.columns[3].invalid, 1);
});
test('formata para pt-BR', () => {
  assert.strictEqual(C.formatValue(ds, 3, ds.rows[1][3]), '10/01/2026');
  assert.strictEqual(C.formatValue(ds, 14, ds.rows[1][14]), '20,00');
});

console.log('\nFiltros');
test('filtro de texto múltiplo', () => {
  const filters = { '__search': '' };
  filters[ds.columns[6].key] = { type: 'text', values: new Set([C.normalizeSetValue('Trinca')]) };
  const idx = C.filterRows(ds, filters);
  assert.deepStrictEqual(Array.from(idx), [2, 3]);
});
test('filtro numérico e de data', () => {
  const filters = { '__search': '' };
  filters[ds.columns[12].key] = { type: 'number', min: 1, max: 3 };
  filters[ds.columns[3].key] = { type: 'date', from: C.parseDate('01/01/2026'), to: C.parseDate('31/01/2026') };
  const idx = C.filterRows(ds, filters);
  assert.deepStrictEqual(Array.from(idx), [0, 1]);
});
test('busca global ignora acento e casa em qualquer coluna', () => {
  const idx = C.filterRows(ds, { '__search': 'usinagem trinca' });
  assert.deepStrictEqual(Array.from(idx), [2, 3]);
  const idx2 = C.filterRows(ds, { '__search': 'peca quebrada' });
  assert.deepStrictEqual(Array.from(idx2), [2]);
});
test('valor vazio pode ser filtrado', () => {
  const filters = { '__search': '' };
  filters[ds.columns[11].key] = { type: 'text', values: new Set([C.EMPTY_KEY]) };
  assert.deepStrictEqual(Array.from(C.filterRows(ds, filters)), [1, 3]);
});
test('rowsExcept isola os outros filtros', () => {
  const filters = { '__search': '' };
  filters[ds.columns[6].key] = { type: 'text', values: new Set(['trinca']) };
  filters[ds.columns[8].key] = { type: 'text', values: new Set(['m1']) };
  const others = C.rowsExcept(ds, filters, ds.columns[8].key);
  assert.deepStrictEqual(Array.from(others), [2, 3]);
});

console.log('\nAgregação e ordenação');
test('soma por coluna', () => {
  const all = C.filterRows(ds, { '__search': '' });
  assert.strictEqual(C.sumColumn(ds, 12, all), 4.5);
  assert.strictEqual(C.sumColumn(ds, 14, all), 35.5);
});
test('agrupa por motivo', () => {
  const all = C.filterRows(ds, { '__search': '' });
  const groups = C.groupSum(ds, all, 6, 12).sort((a, b) => b.total - a.total);
  assert.strictEqual(groups[0].label, 'Rebarba');
  assert.strictEqual(groups[0].total, 2.25);
  assert.strictEqual(groups[0].count, 1);
  const trinca = groups.find((g) => g.label === 'Trinca');
  assert.strictEqual(trinca.count, 2);
  assert.strictEqual(trinca.total, 0.75);
});
test('ordena com vazios no fim', () => {
  const all = C.filterRows(ds, { '__search': '' });
  const asc = C.sortIndices(ds, all, 12, 1);
  assert.strictEqual(ds.rows[asc[0]][12], 0.75);
  assert.strictEqual(ds.rows[asc[asc.length - 1]][12], null);
});
test('exporta cabeçalho + linhas', () => {
  const all = C.filterRows(ds, { '__search': '' });
  const m = C.exportMatrix(ds, all, true);
  assert.strictEqual(m.length, 5);
  assert.strictEqual(m[0][0], 'Item - Base');
  assert.strictEqual(m[2][12], 2.25);
});

console.log('\n' + passed + ' testes passaram' + (process.exitCode ? ' (com falhas)' : ''));

