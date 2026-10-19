// 解析/序列化契约测试：锁住 slkParser 的现有行为。
// 目的不是"证明算法正确"，而是任何会改变输出语义的改动都必须让这里失败、
// 由维护者明确确认后再更新期望值。跑法：node tests/parser-contract.test.js
const assert = require('assert');
const { parseSLK, stringifySLK } = require('../out/slkParser');

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

const CRLF = (lines) => lines.join('\r\n') + '\r\n';

const minimal = CRLF([
  'ID;PWXL;N;E',
  'B;Y3;X2;D0 0 2 1',
  'C;Y1;X1;K"unitID"',
  'C;X2;K"name"',
  'C;Y2;X1;K"hfoo"',
  'C;X2;K"Footman"',
  'C;Y3;X1;K"hpea"',
  'C;X2;K"Peasant"',
  'E',
]);

const styled = CRLF([
  'ID;PWXL;N;E',
  'P;PGeneral;0 0 0 0 0 0 0 0',
  'P;P0;0 0 0 0 0 0 0 0',
  'P;PDefault;0 0 0 0 0 0 0 0',
  'F;P0;DG0G8;M255',
  'B;Y3;X3;D0 0 2 2',
  'F;P0',
  'C;Y1;X1;K"unitID"',
  'C;X2;K"HP"',
  'C;X3;K"Name"',
  'C;Y2;X1;K"hfoo"',
  'F;SM1',
  'C;X2;K"420"',
  'F;SDM2',
  'C;X3;K"Footman"',
  'C;Y3;X1;K"hpea"',
  'C;X2;K"220"',
  'C;X3;K"Peasant"',
  'E',
]);

const quoted = [
  'ID;PWXL;N;E',
  'B;Y2;X2;D0 0 1 1',
  'C;Y1;X1;K"a;b""c"',
  'C;X2;K"second"',
  'C;Y2;X1;K"line1;line2"',
  'C;X2;K""',
  'E',
].join('\n');

const bom = '\uFEFFID;PWXL;N;E\nB;Y2;X2;D0 0 1 1\nC;Y1;X1;K"x"\nC;Y2;X1;K"1"\nE\n';

test('未修改的文件逐字节原样返回（CRLF）', () => {
  const d = parseSLK(minimal);
  assert.strictEqual(stringifySLK(d.rows, d), minimal);
});

test('未修改的文件逐字节原样返回（LF）', () => {
  const d = parseSLK(quoted);
  assert.strictEqual(stringifySLK(d.rows, d), quoted);
});

test('未修改的文件保留 BOM', () => {
  const d = parseSLK(bom);
  assert.strictEqual(stringifySLK(d.rows, d), bom);
  assert.strictEqual(d.hasBOM, true);
});

test('基础文件解析出正确的 grid', () => {
  const d = parseSLK(minimal);
  assert.deepStrictEqual(d.rows, [
    ['unitID', 'name'],
    ['hfoo', 'Footman'],
    ['hpea', 'Peasant'],
  ]);
  assert.strictEqual(d.maxCols, 2);
  assert.deepStrictEqual(d.tailLines, ['E']);
});

test('修改一个单元格后输出逐字节可预期', () => {
  const d = parseSLK(minimal);
  const rows = d.rows.map((r) => r.slice());
  rows[1][1] = '999';
  assert.strictEqual(
    stringifySLK(rows, d),
    CRLF([
      'ID;PWXL;N;E',
      'B;Y3;X2;D0 0 2 1',
      'C;Y1;X1;K"unitID"',
      'C;X2;K"name"',
      'C;Y2;X1;K"hfoo"',
      'C;X2;K999',
      'C;Y3;X1;K"hpea"',
      'C;X2;K"Peasant"',
      'E',
    ])
  );
});

test('引号、分号、双引号转义往返不变', () => {
  const d = parseSLK(quoted);
  assert.deepStrictEqual(d.rows, [
    ['a;b"c', 'second'],
    ['line1;line2', ''],
  ]);
  const rows = d.rows.map((r) => r.slice());
  rows[1][1] = '999';
  const out = stringifySLK(rows, d);
  assert.deepStrictEqual(parseSLK(out).rows, [
    ['a;b"c', 'second'],
    ['line1;line2', '999'],
  ]);
});

test('P 段/样式/F 记录在编辑后保留', () => {
  const d = parseSLK(styled);
  assert.strictEqual(d.styleCount, 3);
  const rows = d.rows.map((r) => r.slice());
  rows[1][1] = '999';
  const out = stringifySLK(rows, d);
  assert.ok(out.includes('P;P0;0 0 0 0 0 0 0 0'));
  assert.ok(out.includes('F;P0;DG0G8;M255'));
  // 当前实现把无坐标的 F 记录(bodyExtraLines)提到数据行之前，属于既有行为
  assert.ok(out.includes('F;SM1'));
  assert.ok(out.includes('F;SDM2'));
  assert.deepStrictEqual(parseSLK(out).rows, [
    ['unitID', 'HP', 'Name'],
    ['hfoo', '999', 'Footman'],
    ['hpea', '220', 'Peasant'],
  ]);
});

test('删除行后 B 记录尺寸同步、剩余行数据不串位', () => {
  const d = parseSLK(styled);
  const rows = d.rows.map((r) => r.slice());
  const rowOrigIdx = d.rows.map((_, i) => i);
  rows.splice(1, 1);
  rowOrigIdx.splice(1, 1);
  const out = stringifySLK(rows, d, rowOrigIdx);
  assert.ok(out.includes('B;Y2;X3;D0 0 1 2'));
  assert.deepStrictEqual(parseSLK(out).rows, [
    ['unitID', 'HP', 'Name'],
    ['hpea', '220', 'Peasant'],
  ]);
});

test('带坐标的越界样式引用被丢弃，避免 Excel 报损坏', () => {
  const text = CRLF([
    'ID;PWXL;N;E',
    'P;PGeneral;0 0 0 0 0 0 0 0',
    'B;Y2;X2;D0 0 1 1',
    'C;Y1;X1;K"a"',
    'C;X2;K"b"',
    'F;SM99;Y2;X2',
    'C;Y2;X1;K"1"',
    'C;X2;K"2"',
    'E',
  ]);
  const d = parseSLK(text);
  const rows = d.rows.map((r) => r.slice());
  rows[1][0] = '999';
  const out = stringifySLK(rows, d);
  assert.strictEqual(out.includes('SM99'), false);
});

test('既有行为：无坐标 F 记录（bodyExtra）不经过样式校验，原样前置输出', () => {
  // 这不是新语义，而是当前实现的事实。保留该测试是为了将来若有人修改
  // bodyExtraLines 的处理方式，能立刻发现语义变化。
  const text = CRLF([
    'ID;PWXL;N;E',
    'P;PGeneral;0 0 0 0 0 0 0 0',
    'B;Y2;X2;D0 0 1 1',
    'C;Y1;X1;K"a"',
    'F;SM99',
    'C;X2;K"b"',
    'C;Y2;X1;K"1"',
    'C;X2;K"2"',
    'E',
  ]);
  const d = parseSLK(text);
  const rows = d.rows.map((r) => r.slice());
  rows[1][1] = '999';
  const out = stringifySLK(rows, d);
  assert.deepStrictEqual(d.bodyExtraLines, ['F;SM99']);
  assert.ok(out.includes('F;SM99'));
});

test('新增行后 B 记录尺寸同步', () => {
  const d = parseSLK(minimal);
  const rows = d.rows.map((r) => r.slice());
  const rowOrigIdx = d.rows.map((_, i) => i);
  rows.push(['new', 'row']);
  rowOrigIdx.push(-1);
  const out = stringifySLK(rows, d, rowOrigIdx);
  assert.ok(out.includes('B;Y4;X2;D0 0 3 1'));
  assert.deepStrictEqual(parseSLK(out).rows[3], ['new', 'row']);
});

console.log('\n' + passed + ' passed');
