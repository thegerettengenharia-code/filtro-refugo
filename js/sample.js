/* =============================================================================
 * sample.js — base de demonstração (determinística, sem internet)
 * Mesmos cabeçalhos da planilha Ref.Parcial.xlsx.
 * ========================================================================== */
(function (root) {
  'use strict';

  var HEADER = [
    'Item - Base', 'Item - Código', 'Item - Descrição', 'Dt Fundição', 'Turno',
    'Processo', 'Motivo Refugo', 'Data Apont.', 'Máq.', 'Nr Figura', 'Nr Molde',
    'Obs. Refugo', 'Kg Refugo', 'Qtde Refugo', 'CM Refugo'
  ];

  var BASES = ['Base A', 'Base B', 'Base C', 'Base D'];
  var DESCRICOES = [
    'Flange fundido', 'Cubo de roda', 'Suporte de motor', 'Tampa de caixa',
    'Eixo de transmissão', 'Bucha de bronze', 'Carcaça de bomba', 'Disco de freio'
  ];
  var TURNOS = ['A', 'B', 'C'];
  var PROCESSOS = ['Fundição', 'Macharia', 'Usinagem', 'Acabamento'];
  var MOTIVOS = [
    'Bolha', 'Rechupo', 'Rebarba', 'Trinca', 'Inclusão de areia',
    'Falta de material', 'Dimensional', 'Porosidade'
  ];
  var MOTIVOS_PESO = [18, 12, 22, 9, 14, 6, 8, 11];
  var MAQUINAS = ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-06', 'M-07', 'M-08'];
  var OBS = ['', '', '', 'Aguardando análise', 'Refugo parcial', 'Peça trincada na desmoldagem',
    'Cliente devolveu lote', 'Retrabalho não aprovado'];

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
  function pickWeighted(rand, arr, weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = rand() * total;
    for (i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  function pad(n, size) { var s = String(n); while (s.length < size) s = '0' + s; return s; }
  function ddmm(ms) {
    var d = new Date(ms);
    return pad(d.getDate(), 2) + '/' + pad(d.getMonth() + 1, 2) + '/' + d.getFullYear();
  }

  function build(rowCount) {
    var rand = mulberry32(20261107);
    var total = rowCount || 1200;
    var matrix = [HEADER.slice()];
    var today = new Date();
    var end = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    for (var i = 0; i < total; i++) {
      var base = pick(rand, BASES);
      var code = pad(120 + (i % 90), 5);
      var desc = pick(rand, DESCRICOES);
      var fundicao = end - Math.floor(rand() * 120) * 86400000;
      var apont = fundicao + Math.floor(rand() * 4) * 86400000;
      var motivo = pickWeighted(rand, MOTIVOS, MOTIVOS_PESO);
      var processo = pick(rand, PROCESSOS);
      var kg = Math.round((0.15 + rand() * 11.5) * 1000) / 1000;
      var qtde = 1 + Math.floor(rand() * 40);
      var cm = Math.round(kg * (16 + rand() * 9) * 100) / 100;
      var obs = pick(rand, OBS);
      var figura = 'FIG-' + pad(100 + (i % 45), 3);
      var molde = 'MLD-' + pad(20 + (i % 18), 2);

      if (i % 397 === 0) { kg = ''; }   // simula lacuna, como em planilha real
      if (i % 613 === 0) { obs = 'Verificar medida com o cliente'; }

      matrix.push([
        base, code, desc, ddmm(fundicao), pick(rand, TURNOS), processo, motivo,
        ddmm(apont), pick(rand, MAQUINAS), figura, molde, obs,
        kg, qtde, cm
      ]);
    }
    return matrix;
  }

  root.RefugoSample = { build: build, HEADER: HEADER };
})(window);
