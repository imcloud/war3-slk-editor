// 表格纯函数测试：node tests/gridOps.test.js
const assert = require('assert');
const Ops = require('../media/gridOps.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

// ---------- TSV ----------
test('parseTSV 处理普通二维数据', () => {
  assert.deepStrictEqual(Ops.parseTSV('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
});

test('parseTSV 忽略末尾换行', () => {
  assert.deepStrictEqual(Ops.parseTSV('a\tb\n'), [['a', 'b']]);
});

test('parseTSV 支持引号内的制表符/换行/双引号', () => {
  const text = '"a\tb"\t"line1\nline2"\t"say ""hi"""';
  assert.deepStrictEqual(Ops.parseTSV(text), [['a\tb', 'line1\nline2', 'say "hi"']]);
});

test('parseTSV 空字符串', () => {
  assert.deepStrictEqual(Ops.parseTSV(''), []);
});

test('toTSV 与 parseTSV 互逆（含特殊字符）', () => {
  const matrix = [['plain', 'with\ttab'], ['with\nnewline', 'quote"inside']];
  assert.deepStrictEqual(Ops.parseTSV(Ops.toTSV(matrix)), matrix);
});

// ---------- 选区矩阵 ----------
const rows = [
  ['id', 'hp', 'name'],
  ['hfoo', '420', 'Footman'],
  ['hpea', '220', 'Peasant'],
];

test('selectionMatrix 整行选择取全部列', () => {
  const m = Ops.selectionMatrix(rows, 3, { mode: 'row', rows: [2] });
  assert.deepStrictEqual(m, [['hpea', '220', 'Peasant']]);
});

test('selectionMatrix 整列选择跳过表头行', () => {
  const m = Ops.selectionMatrix(rows, 3, { mode: 'col', cols: [1] });
  assert.deepStrictEqual(m, [['420'], ['220']]);
});

test('selectionMatrix 矩形区域', () => {
  const m = Ops.selectionMatrix(rows, 3, { mode: 'cell', range: { r1: 1, r2: 2, c1: 1, c2: 2 } });
  assert.deepStrictEqual(m, [['420', 'Footman'], ['220', 'Peasant']]);
});

test('selectionMatrix 越界单元格补空串', () => {
  const m = Ops.selectionMatrix([['a']], 2, { mode: 'row', rows: [0] });
  assert.deepStrictEqual(m, [['a', '']]);
});

// ---------- 结构修改 ----------
test('deleteRows 降序删除并同步 rowOrigIdx', () => {
  const r = rows.map(x => x.slice());
  const orig = [0, 1, 2];
  const removed = Ops.deleteRows(r, orig, [1, 2]);
  assert.deepStrictEqual(removed, [2, 1]);
  assert.deepStrictEqual(r, [['id', 'hp', 'name']]);
  assert.deepStrictEqual(orig, [0]);
});

test('deleteRows 忽略表头行和越界索引', () => {
  const r = rows.map(x => x.slice());
  const removed = Ops.deleteRows(r, [0, 1, 2], [0, 99, -1]);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(r.length, 3);
});

test('deleteCols 删除多列并返回新列数', () => {
  const r = rows.map(x => x.slice());
  const newMax = Ops.deleteCols(r, 3, [0, 2]);
  assert.strictEqual(newMax, 1);
  assert.deepStrictEqual(r, [['hp'], ['420'], ['220']]);
});

test('fillDown 用首行填充余下区域', () => {
  const r = rows.map(x => x.slice());
  Ops.fillDown(r, { r1: 1, r2: 2, c1: 1, c2: 1 });
  assert.deepStrictEqual(r[1], ['hfoo', '420', 'Footman']);
  assert.deepStrictEqual(r[2], ['hpea', '420', 'Peasant']);
});

test('clearRange 只清内容不改结构', () => {
  const r = rows.map(x => x.slice());
  Ops.clearRange(r, { r1: 1, r2: 2, c1: 0, c2: 0 });
  assert.strictEqual(r.length, 3);
  assert.deepStrictEqual(r[1], ['', '420', 'Footman']);
});

test('ensureSize 补行补列并给新行 -1 的 rowOrigIdx', () => {
  const r = [['a']];
  const orig = [0];
  Ops.ensureSize(r, orig, 3, 2);
  assert.strictEqual(r.length, 3);
  assert.deepStrictEqual(r[2], ['', '']);
  assert.deepStrictEqual(orig, [0, -1, -1]);
});

console.log('\n' + passed + ' passed');
