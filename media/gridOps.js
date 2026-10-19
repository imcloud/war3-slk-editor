/* 纯函数：选区矩阵、TSV 编解码、行列结构修改。
 * 不依赖 DOM，浏览器（window.SlkGridOps）和 Node（module.exports）都能用，
 * 这样表格逻辑可以在 tests/ 里直接跑。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SlkGridOps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeRange(a, b) {
    return {
      r1: Math.min(a.r, b.r),
      r2: Math.max(a.r, b.r),
      c1: Math.min(a.c, b.c),
      c2: Math.max(a.c, b.c),
    };
  }

  function clamp(n, min, max) {
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /** 把选区转成二维矩阵。sel: {mode, rows:[], cols:[], range:{r1,r2,c1,c2}} */
  function selectionMatrix(rows, maxCols, sel) {
    var out = [];
    var r, c, row, line;

    if (sel.mode === 'row') {
      var rs = (sel.rows || []).slice().sort(function (a, b) { return a - b; });
      for (var i = 0; i < rs.length; i++) {
        r = rs[i];
        row = rows[r] || [];
        line = [];
        for (c = 0; c < maxCols; c++) line.push(row[c] === undefined ? '' : String(row[c]));
        out.push(line);
      }
      return out;
    }

    if (sel.mode === 'col') {
      var cs = (sel.cols || []).slice().sort(function (a, b) { return a - b; });
      for (r = 1; r < rows.length; r++) {
        row = rows[r] || [];
        line = [];
        for (var j = 0; j < cs.length; j++) {
          var v = row[cs[j]];
          line.push(v === undefined ? '' : String(v));
        }
        out.push(line);
      }
      return out;
    }

    var rg = sel.range || { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    for (r = rg.r1; r <= rg.r2; r++) {
      row = rows[r] || [];
      line = [];
      for (c = rg.c1; c <= rg.c2; c++) {
        var cv = row[c];
        line.push(cv === undefined ? '' : String(cv));
      }
      out.push(line);
    }
    return out;
  }

  /** 含制表符/换行/引号的值用双引号包裹，Excel 可直接识别 */
  function encodeCell(value) {
    var s = String(value === undefined || value === null ? '' : value);
    if (/[\t\r\n"]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toTSV(matrix) {
    return matrix.map(function (line) {
      return line.map(encodeCell).join('\t');
    }).join('\n');
  }

  function parseTSV(text) {
    var s = String(text === null || text === undefined ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var cells = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === '\t') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        cells.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    // 末尾没有换行时把最后一行补上；末尾恰好是换行时忽略空行
    if (field !== '' || row.length > 0) {
      row.push(field);
      cells.push(row);
    }
    return cells;
  }

  /** 删除行，返回被删掉的行号（降序），供调用方同步 rowOrigIdx */
  function deleteRows(rows, rowOrigIdx, rowIdxs) {
    var list = [];
    var seen = {};
    for (var i = 0; i < rowIdxs.length; i++) {
      var r = rowIdxs[i];
      if (r >= 1 && r < rows.length && !seen[r]) { seen[r] = true; list.push(r); }
    }
    list.sort(function (a, b) { return b - a; });
    for (var k = 0; k < list.length; k++) {
      rows.splice(list[k], 1);
      if (rowOrigIdx) rowOrigIdx.splice(list[k], 1);
    }
    return list;
  }

  /** 删除列，返回新的 maxCols */
  function deleteCols(rows, maxCols, colIdxs) {
    var list = [];
    var seen = {};
    for (var i = 0; i < colIdxs.length; i++) {
      var c = colIdxs[i];
      if (c >= 0 && c < maxCols && !seen[c]) { seen[c] = true; list.push(c); }
    }
    if (list.length === 0) return maxCols;
    list.sort(function (a, b) { return b - a; });
    for (var r = 0; r < rows.length; r++) {
      if (!rows[r]) continue;
      for (var k = 0; k < list.length; k++) rows[r].splice(list[k], 1);
    }
    return maxCols - list.length;
  }

  /** 把 range 首行的值向下填充到其余行 */
  function fillDown(rows, range) {
    var src = (rows[range.r1] || []).slice();
    for (var r = range.r1 + 1; r <= range.r2; r++) {
      if (!rows[r]) rows[r] = [];
      for (var c = range.c1; c <= range.c2; c++) {
        rows[r][c] = src[c] === undefined ? '' : src[c];
      }
    }
  }

  function clearRange(rows, range) {
    for (var r = range.r1; r <= range.r2; r++) {
      if (!rows[r]) rows[r] = [];
      for (var c = range.c1; c <= range.c2; c++) rows[r][c] = '';
    }
  }

  /** 确保 rows 至少有 rowCount 行、每行至少 colCount 列 */
  function ensureSize(rows, rowOrigIdx, rowCount, colCount) {
    while (rows.length < rowCount) {
      var line = [];
      for (var c = 0; c < colCount; c++) line.push('');
      rows.push(line);
      if (rowOrigIdx) rowOrigIdx.push(-1);
    }
    for (var r = 0; r < rows.length; r++) {
      if (!rows[r]) rows[r] = [];
      while (rows[r].length < colCount) rows[r].push('');
    }
  }

  return {
    normalizeRange: normalizeRange,
    clamp: clamp,
    selectionMatrix: selectionMatrix,
    toTSV: toTSV,
    parseTSV: parseTSV,
    encodeCell: encodeCell,
    deleteRows: deleteRows,
    deleteCols: deleteCols,
    fillDown: fillDown,
    clearRange: clearRange,
    ensureSize: ensureSize,
  };
});
