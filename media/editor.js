window.addEventListener('error', function (ev) {
  var box = document.getElementById('error-box');
  if (!box) return;
  var tpl = (window.__SLK_I18N__ && window.__SLK_I18N__['error.script']) || '[JS error] {message}';
  box.style.display = 'block';
  box.textContent = tpl.replace('{message}', ev.message || String(ev.error || ''));
});

(function () {
  'use strict';

  var vscode = acquireVsCodeApi();
  var Ops = window.SlkGridOps;
  var I18N = window.__SLK_I18N__ || {};

  function t(key, params) {
    var s = I18N[key];
    if (s === undefined) s = key;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] === undefined ? m : String(params[k]);
    });
  }

  var ROW_HEIGHT = 27;
  var BUFFER = 5;
  var CELL_WIDTH = 150;
  var CELL_WIDTH_COLLAPSED = 44;
  var NUM_WIDTH = 60;
  var NUM_WIDTH_COLLAPSED = 44;
  var UNDO_LIMIT = 60;

  var rows = [];
  var rowOrigIdx = [];
  var maxCols = 0;
  var filteredIndices = [];
  var collapsedCols = {};
  var lastStartIdx = -1;
  var isTicking = false;
  var rowPool = [];
  var poolColCount = -1;
  var headerCells = [];
  var editingCell = null;
  var editingOriginal = '';
  var changeTimer = null;

  // 选区模型：单元格矩形 + 整行集合 + 整列集合
  var sel = {
    mode: 'cell', // 'cell' | 'row' | 'col'
    r: 1,
    c: 0,
    anchor: { r: 1, c: 0 },
    range: null, // {r1,r2,c1,c2}
    rows: new Set(),
    cols: new Set(),
    rowAnchor: null,
    colAnchor: null,
  };

  var undoStack = [];
  var redoStack = [];

  var getEl = function (id) { return document.getElementById(id); };
  var bodyContainer = getEl('body-container');
  var headerRow = getEl('header-row');
  var rowsLayer = getEl('rows-layer');
  var phantom = getEl('phantom');
  var infoSpan = getEl('info');
  var searchInput = getEl('search-input');
  var errorBox = getEl('error-box');

  function clamp(n, min, max) {
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function numWidth() { return collapsedCols[-1] ? NUM_WIDTH_COLLAPSED : NUM_WIDTH; }
  function cellWidth(c) { return collapsedCols[c] ? CELL_WIDTH_COLLAPSED : CELL_WIDTH; }
  function totalWidth() {
    var w = numWidth();
    for (var c = 0; c < maxCols; c++) w += cellWidth(c);
    return w;
  }
  function colLeft(c) {
    var left = numWidth();
    for (var i = 0; i < c; i++) left += cellWidth(i);
    return left;
  }

  function setCls(el, name, on) {
    if (!el) return;
    var has = el.classList.contains(name);
    if (on && !has) el.classList.add(name);
    else if (!on && has) el.classList.remove(name);
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.style.display = 'block';
    errorBox.textContent = message;
  }

  // ================= 渲染 =================

  function renderHeader() {
    if (!headerRow) return;
    headerRow.innerHTML = '';
    headerCells = [];

    var thNum = document.createElement('div');
    thNum.className = 'cell-num';
    var spanNum = document.createElement('span');
    spanNum.textContent = '#';
    thNum.appendChild(spanNum);
    headerRow.appendChild(thNum);

    var firstRow = rows[0] || [];
    for (var c = 0; c < maxCols; c++) {
      var th = document.createElement('div');
      th.className = 'cell';
      th.dataset.c = c;
      if (collapsedCols[c]) th.classList.add('col-collapsed');
      if (!collapsedCols[c]) {
        var name = (firstRow[c] !== undefined && firstRow[c] !== '') ? firstRow[c] : t('col.defaultName', { n: c + 1 });
        var spanText = document.createElement('span');
        spanText.textContent = name;
        th.appendChild(spanText);
      }
      var toggleBtn = document.createElement('button');
      toggleBtn.className = 'col-toggle-btn';
      toggleBtn.textContent = collapsedCols[c] ? '»' : '«';
      toggleBtn.dataset.c = c;
      toggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var col = parseInt(this.dataset.c, 10);
        if (isNaN(col)) return;
        collapsedCols[col] = !collapsedCols[col];
        forceRelayout();
      });
      th.appendChild(toggleBtn);
      headerRow.appendChild(th);
      headerCells.push(th);
    }
  }

  function createDataRow() {
    var el = document.createElement('div');
    el.className = 'data-row';
    var cellNum = document.createElement('div');
    cellNum.className = 'cell-num';
    el.appendChild(cellNum);
    var cells = [];
    for (var c = 0; c < maxCols; c++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      el.appendChild(cell);
      cells.push(cell);
    }
    return { el: el, cellNum: cellNum, cells: cells, currentR: null };
  }

  function ensurePool(targetCount) {
    if (poolColCount !== maxCols) {
      rowsLayer.innerHTML = '';
      rowPool = [];
      var size = Math.max(targetCount + 10, 50);
      for (var i = 0; i < size; i++) {
        var row = createDataRow();
        rowsLayer.appendChild(row.el);
        rowPool.push(row);
      }
      poolColCount = maxCols;
      return;
    }
    while (rowPool.length < targetCount) {
      var extra = createDataRow();
      rowsLayer.appendChild(extra.el);
      rowPool.push(extra);
    }
  }

  function forceRelayout() {
    poolColCount = -1;
    lastStartIdx = -1;
    renderHeader();
    updateVirtualScroll(true);
    updateSelectedClass();
  }

  function updateFilter(resetScroll) {
    var kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var oldTop = bodyContainer ? bodyContainer.scrollTop : 0;

    filteredIndices = [];
    if (!kw) {
      for (var i = 1; i < rows.length; i++) filteredIndices.push(i);
    } else {
      for (var r = 1; r < rows.length; r++) {
        var rowData = rows[r] || [];
        for (var c = 0; c < rowData.length; c++) {
          var v = rowData[c];
          if (v !== undefined && String(v).toLowerCase().indexOf(kw) !== -1) {
            filteredIndices.push(r);
            break;
          }
        }
      }
    }

    if (filteredIndices.length > 0) {
      if (filteredIndices.indexOf(sel.r) === -1) sel.r = filteredIndices[0];
    }
    sel.c = clamp(sel.c, 0, Math.max(0, maxCols - 1));

    lastStartIdx = -1;
    updateVirtualScroll(true);
    updateSelectedClass();
    updateInfo();
    if (bodyContainer) bodyContainer.scrollTop = resetScroll ? 0 : oldTop;
  }

  function rowInRange(r, c) {
    var rg = sel.range;
    if (!rg || sel.mode !== 'cell') return false;
    return r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
  }

  function updateVirtualScroll(force) {
    if (!bodyContainer || !rowsLayer) return;

    var dataCount = filteredIndices.length;
    var scrollTop = bodyContainer.scrollTop || 0;
    var viewportHeight = bodyContainer.clientHeight || window.innerHeight || 600;

    var startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    var endIdx = Math.min(dataCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);

    if (!force && startIdx === lastStartIdx) return;
    lastStartIdx = startIdx;
    commitEditing();

    var targetCount = Math.max(0, endIdx - startIdx);
    ensurePool(targetCount);

    var totalH = dataCount * ROW_HEIGHT;
    if (phantom.style.height !== totalH + 'px') phantom.style.height = totalH + 'px';
    var totalW = totalWidth();
    if (phantom.style.width !== totalW + 'px') phantom.style.width = totalW + 'px';

    rowsLayer.style.transform = 'translateY(' + (startIdx * ROW_HEIGHT) + 'px)';

    if (force) for (var p = 0; p < rowPool.length; p++) rowPool[p].currentR = null;

    for (var i = 0; i < rowPool.length; i++) {
      var row = rowPool[i];

      if (i >= targetCount) {
        if (row.el.style.display !== 'none') row.el.style.display = 'none';
        continue;
      }

      var dataIdx = startIdx + i;
      var r = filteredIndices[dataIdx];

      if (r === undefined || !rows[r]) {
        if (row.el.style.display !== 'none') row.el.style.display = 'none';
        continue;
      }
      if (row.el.style.display === 'none') row.el.style.display = '';

      var topStr = (i * ROW_HEIGHT) + 'px';
      if (row.el.style.top !== topStr) row.el.style.top = topStr;

      if (!force && row.currentR === r) continue;
      row.currentR = r;

      applyRowClasses(row, r);
    }
  }

  function applyRowClasses(row, r) {
    var rStr = String(r);
    if (row.cellNum.textContent !== rStr) row.cellNum.textContent = rStr;
    row.cellNum.dataset.r = r;

    setCls(row.cellNum, 'col-collapsed', !!collapsedCols[-1]);

    var rowSel = sel.mode === 'row' && sel.rows.has(r);
    setCls(row.cellNum, 'row-selected', rowSel);

    var rowData = rows[r] || [];

    for (var c = 0; c < maxCols; c++) {
      var cell = row.cells[c];
      var val = rowData[c] !== undefined ? rowData[c] : '';
      if (cell.textContent !== val) cell.textContent = val;

      if (cell.dataset.r !== rStr) { cell.dataset.r = r; cell.dataset.c = c; }

      setCls(cell, 'col-collapsed', !!collapsedCols[c]);
      setCls(cell, 'cell-row-sel', rowSel);
      setCls(cell, 'cell-col-sel', sel.mode === 'col' && sel.cols.has(c));
      setCls(cell, 'cell-range', rowInRange(r, c));
      setCls(cell, 'cell-selected', sel.r === r && sel.c === c);
    }
  }

  function updateSelectedClass() {
    for (var i = 0; i < rowPool.length; i++) {
      var row = rowPool[i];
      if (row.currentR === null) continue;
      applyRowClasses(row, row.currentR);
    }
    for (var c = 0; c < headerCells.length; c++) {
      setCls(headerCells[c], 'col-selected', sel.mode === 'col' && sel.cols.has(c));
    }
  }

  function ensureRowVisible(realRowIdx) {
    var fi = filteredIndices.indexOf(realRowIdx);
    if (fi === -1) return false;
    var top = fi * ROW_HEIGHT;
    var bottom = top + ROW_HEIGHT;
    var viewTop = bodyContainer.scrollTop;
    var viewBottom = viewTop + bodyContainer.clientHeight;
    if (top < viewTop) { bodyContainer.scrollTop = top; return true; }
    if (bottom > viewBottom) { bodyContainer.scrollTop = bottom - bodyContainer.clientHeight; return true; }
    return false;
  }

  function ensureCellVisible(r, c) {
    var scrolled = ensureRowVisible(r);
    var left = colLeft(c);
    var w = cellWidth(c);
    var viewLeft = bodyContainer.scrollLeft;
    var viewRight = viewLeft + bodyContainer.clientWidth;
    var sticky = numWidth();
    if (left < viewLeft + sticky) {
      bodyContainer.scrollLeft = Math.max(0, left - sticky);
      scrolled = true;
    } else if (left + w > viewRight) {
      bodyContainer.scrollLeft = left + w - bodyContainer.clientWidth;
      scrolled = true;
    }
    if (scrolled) updateVirtualScroll(true);
    return scrolled;
  }

  function getCellEl(r, c) {
    return rowsLayer.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  // ================= 编辑 =================

  function commitEditing() {
    if (!editingCell) return;
    var target = editingCell;
    editingCell = null;
    var input = rowsLayer.querySelector('input.cell-editor');
    if (!input) return;
    var value = input.value;
    var parent = input.parentElement;
    if (parent) parent.textContent = value;

    if (value !== editingOriginal) {
      pushUndo({ kind: 'cell', r: target.r, c: target.c, before: editingOriginal, after: value });
      if (!rows[target.r]) rows[target.r] = [];
      rows[target.r][target.c] = value;
      updateInfo();
      notifyChange();
    }
  }

  function cancelEditing() {
    if (!editingCell) return;
    var input = rowsLayer.querySelector('input.cell-editor');
    editingCell = null;
    if (input && input.parentElement) input.parentElement.textContent = editingOriginal;
  }

  function startEditing(cellEl, r, c, initialText) {
    commitEditing();
    if (!cellEl) return;
    editingCell = { r: r, c: c };
    editingOriginal = (rows[r] && rows[r][c] !== undefined) ? String(rows[r][c]) : '';

    var input = document.createElement('input');
    input.className = 'cell-editor';
    input.type = 'text';
    input.value = initialText !== undefined ? initialText : editingOriginal;

    input.addEventListener('blur', function () { commitEditing(); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEditing();
        moveActive(1, 0, false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEditing();
        tabMove(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing();
      }
    });

    cellEl.textContent = '';
    cellEl.appendChild(input);
    input.focus();
    if (initialText === undefined) input.select();
    else {
      var len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }

  function beginEditAt(r, c, initialText) {
    ensureCellVisible(r, c);
    var cellEl = getCellEl(r, c);
    if (!cellEl) return;
    selectCell(r, c, {});
    startEditing(cellEl, r, c, initialText);
  }

  // ================= 选区 =================

  function currentSelection() {
    return {
      mode: sel.mode,
      rows: Array.from(sel.rows),
      cols: Array.from(sel.cols),
      range: sel.range || { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c },
    };
  }

  function selectCell(r, c, opts) {
    opts = opts || {};
    commitEditing();
    if (opts.shift) {
      var a = sel.anchor || { r: r, c: c };
      sel.range = Ops.normalizeRange(a, { r: r, c: c });
    } else {
      sel.anchor = { r: r, c: c };
      sel.range = { r1: r, r2: r, c1: c, c2: c };
    }
    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = r;
    sel.c = c;
    refreshSelection();
  }

  function selectRow(r, opts) {
    opts = opts || {};
    commitEditing();
    if (opts.shift && sel.rowAnchor !== null) {
      var lo = Math.min(sel.rowAnchor, r);
      var hi = Math.max(sel.rowAnchor, r);
      sel.rows = new Set();
      for (var i = lo; i <= hi; i++) sel.rows.add(i);
    } else if (opts.ctrl) {
      if (sel.rows.has(r)) sel.rows.delete(r);
      else sel.rows.add(r);
      sel.rowAnchor = r;
    } else {
      sel.rows = new Set([r]);
      sel.rowAnchor = r;
    }
    sel.mode = sel.rows.size ? 'row' : 'cell';
    sel.cols.clear();
    sel.range = null;
    sel.r = r;
    refreshSelection();
  }

  function selectCol(c, opts) {
    opts = opts || {};
    commitEditing();
    if (opts.shift && sel.colAnchor !== null) {
      var lo = Math.min(sel.colAnchor, c);
      var hi = Math.max(sel.colAnchor, c);
      sel.cols = new Set();
      for (var i = lo; i <= hi; i++) sel.cols.add(i);
    } else if (opts.ctrl) {
      if (sel.cols.has(c)) sel.cols.delete(c);
      else sel.cols.add(c);
      sel.colAnchor = c;
    } else {
      sel.cols = new Set([c]);
      sel.colAnchor = c;
    }
    sel.mode = sel.cols.size ? 'col' : 'cell';
    sel.rows.clear();
    sel.range = null;
    sel.c = c;
    refreshSelection();
  }

  function selectAll() {
    commitEditing();
    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.range = {
      r1: 1,
      r2: Math.max(1, rows.length - 1),
      c1: 0,
      c2: Math.max(0, maxCols - 1),
    };
    if (rows.length > 1) sel.r = 1;
    sel.c = 0;
    refreshSelection();
  }

  function normalizeSelection() {
    var maxR = Math.max(1, rows.length - 1);
    var maxC = Math.max(0, maxCols - 1);

    sel.rows.forEach(function (r) {
      if (r < 1 || r >= rows.length) sel.rows.delete(r);
    });
    sel.cols.forEach(function (c) {
      if (c < 0 || c >= maxCols) sel.cols.delete(c);
    });

    sel.r = rows.length > 1 ? clamp(sel.r, 1, maxR) : 1;
    sel.c = clamp(sel.c, 0, maxC);
    sel.anchor = { r: rows.length > 1 ? clamp(sel.anchor.r, 1, maxR) : 1, c: clamp(sel.anchor.c, 0, maxC) };

    if (sel.range) {
      sel.range = {
        r1: clamp(Math.min(sel.range.r1, sel.range.r2), 1, Math.max(1, rows.length - 1)),
        r2: clamp(Math.max(sel.range.r1, sel.range.r2), 1, Math.max(1, rows.length - 1)),
        c1: clamp(Math.min(sel.range.c1, sel.range.c2), 0, maxC),
        c2: clamp(Math.max(sel.range.c1, sel.range.c2), 0, maxC),
      };
    } else {
      sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    }

    if (sel.mode === 'row' && sel.rows.size === 0) sel.mode = 'cell';
    if (sel.mode === 'col' && sel.cols.size === 0) sel.mode = 'cell';
  }

  function refreshSelection() {
    updateSelectedClass();
    updateInfo();
  }

  // ================= 信息栏 =================

  function updateInfo() {
    if (!infoSpan) return;
    var totalData = Math.max(0, rows.length - 1);
    var fieldName = (rows[0] && rows[0][sel.c]) ? rows[0][sel.c] : t('col.defaultName', { n: sel.c + 1 });
    var parts = [];

    if (sel.mode === 'row' && sel.rows.size) parts.push(t('info.selRows', { n: sel.rows.size }));
    else if (sel.mode === 'col' && sel.cols.size) parts.push(t('info.selCols', { n: sel.cols.size }));
    else {
      var rg = sel.range || { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
      var nr = rg.r2 - rg.r1 + 1;
      var nc = rg.c2 - rg.c1 + 1;
      if (nr > 1 || nc > 1) parts.push(t('info.selCells', { rows: nr, cols: nc }));
    }

    parts.push(t('info.position', { r: sel.r, c: sel.c + 1, field: fieldName }));
    parts.push(t('info.total', { total: totalData, filtered: filteredIndices.length, cols: maxCols }));
    infoSpan.textContent = parts.join(' | ');
  }

  // ================= 撤销 / 重做 =================

  function snapshot() {
    return {
      rows: rows.map(function (r) { return r.slice(); }),
      rowOrigIdx: rowOrigIdx.slice(),
      maxCols: maxCols,
    };
  }

  function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    refreshUndoButtons();
  }

  function refreshUndoButtons() {
    var u = getEl('undo');
    var re = getEl('redo');
    if (u) u.disabled = undoStack.length === 0;
    if (re) re.disabled = redoStack.length === 0;
  }

  function restore(snap) {
    commitEditing();
    rows = snap.rows.map(function (r) { return r.slice(); });
    rowOrigIdx = snap.rowOrigIdx.slice();
    maxCols = snap.maxCols;
    poolColCount = -1;
    lastStartIdx = -1;
    renderHeader();
    normalizeSelection();
    updateFilter(false);
    updateVirtualScroll(true);
    updateSelectedClass();
    updateInfo();
    notifyChange();
    refreshUndoButtons();
  }

  function undo() {
    var entry = undoStack.pop();
    if (!entry) return;
    if (entry.kind === 'cell') {
      if (!rows[entry.r]) rows[entry.r] = [];
      rows[entry.r][entry.c] = entry.before;
      sel.mode = 'cell';
      sel.rows.clear();
      sel.cols.clear();
      sel.r = entry.r;
      sel.c = entry.c;
      sel.range = { r1: entry.r, r2: entry.r, c1: entry.c, c2: entry.c };
      updateVirtualScroll(true);
      updateSelectedClass();
      updateInfo();
      notifyChange();
    } else {
      restore(entry.before);
    }
    redoStack.push(entry);
    refreshUndoButtons();
  }

  function redo() {
    var entry = redoStack.pop();
    if (!entry) return;
    if (entry.kind === 'cell') {
      if (!rows[entry.r]) rows[entry.r] = [];
      rows[entry.r][entry.c] = entry.after;
      sel.mode = 'cell';
      sel.rows.clear();
      sel.cols.clear();
      sel.r = entry.r;
      sel.c = entry.c;
      sel.range = { r1: entry.r, r2: entry.r, c1: entry.c, c2: entry.c };
      updateVirtualScroll(true);
      updateSelectedClass();
      updateInfo();
      notifyChange();
    } else {
      restore(entry.after);
    }
    undoStack.push(entry);
    refreshUndoButtons();
  }

  function withSnapshot(fn) {
    var before = snapshot();
    fn();
    pushUndo({ kind: 'snap', before: before, after: snapshot() });
  }

  function afterMutation(opts) {
    opts = opts || {};
    normalizeSelection();
    if (opts.relayout) {
      poolColCount = -1;
      renderHeader();
    }
    updateFilter(false);
    lastStartIdx = -1;
    updateVirtualScroll(true);
    updateSelectedClass();
    updateInfo();
    notifyChange();
  }

  // ================= 剪贴板 =================

  async function clipboardWrite(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fallthrough */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function clipboardRead() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText();
      }
    } catch (_) { /* fallthrough */ }
    return null;
  }

  async function doCopy() {
    var matrix = Ops.selectionMatrix(rows, maxCols, currentSelection());
    await clipboardWrite(Ops.toTSV(matrix));
  }

  async function doCut() {
    var matrix = Ops.selectionMatrix(rows, maxCols, currentSelection());
    await clipboardWrite(Ops.toTSV(matrix));
    clearContents();
  }

  function pasteMatrix(matrix, r0, c0) {
    if (!matrix.length) return;
    commitEditing();
    var width = 0;
    for (var i = 0; i < matrix.length; i++) {
      if (matrix[i].length > width) width = matrix[i].length;
    }
    if (width === 0) return;

    var neededRows = r0 + matrix.length;
    var neededCols = Math.max(maxCols, c0 + width);
    if (neededRows <= rows.length && neededCols <= maxCols) {
      var unchanged = true;
      for (var rr = 0; rr < matrix.length && unchanged; rr++) {
        for (var cc = 0; cc < matrix[rr].length; cc++) {
          if ((rows[r0 + rr] && rows[r0 + rr][c0 + cc] !== undefined ? rows[r0 + rr][c0 + cc] : '') !== matrix[rr][cc]) {
            unchanged = false;
            break;
          }
        }
      }
      if (unchanged) return;
    }

    withSnapshot(function () {
      Ops.ensureSize(rows, rowOrigIdx, neededRows, neededCols);
      for (var r = 0; r < matrix.length; r++) {
        for (var c = 0; c < matrix[r].length; c++) {
          rows[r0 + r][c0 + c] = matrix[r][c];
        }
      }
      maxCols = neededCols;
    });

    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = r0;
    sel.c = c0;
    sel.anchor = { r: r0, c: c0 };
    sel.range = { r1: r0, r2: r0 + matrix.length - 1, c1: c0, c2: c0 + width - 1 };
    afterMutation({ relayout: true });
  }

  function applyPasteText(text, r, c) {
    var matrix = Ops.parseTSV(text);
    if (!matrix.length) return;
    pasteMatrix(matrix, r, c);
  }

  // ================= 结构性操作 =================

  function deleteRowsByIdx(idxs) {
    commitEditing();
    var list = idxs.filter(function (r) { return r >= 1 && r < rows.length; });
    if (!list.length) return;
    var before = snapshot();
    var removed = Ops.deleteRows(rows, rowOrigIdx, list);
    if (!removed.length) return;
    pushUndo({ kind: 'snap', before: before, after: snapshot() });

    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = clamp(sel.r, 1, Math.max(1, rows.length - 1));
    sel.c = clamp(sel.c, 0, Math.max(0, maxCols - 1));
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    afterMutation();
  }

  function deleteColsByIdx(idxs) {
    commitEditing();
    var list = idxs.filter(function (c) { return c >= 0 && c < maxCols; });
    if (!list.length) return;
    var before = snapshot();
    maxCols = Ops.deleteCols(rows, maxCols, list);
    pushUndo({ kind: 'snap', before: before, after: snapshot() });

    sel.mode = 'cell';
    sel.cols.clear();
    sel.rows.clear();
    sel.c = clamp(sel.c, 0, Math.max(0, maxCols - 1));
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    afterMutation({ relayout: true });
  }

  function clearContents() {
    commitEditing();
    var rg;
    var rowList = [];
    if (sel.mode === 'row') {
      rowList = Array.from(sel.rows);
    } else if (sel.mode === 'col') {
      for (var c = 0; c < maxCols; c++) {
        if (sel.cols.has(c)) { /* 列清空在下面处理 */ }
      }
    } else {
      rg = sel.range || { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    }

    var hasContent = false;
    if (sel.mode === 'row') {
      for (var i = 0; i < rowList.length; i++) {
        var row = rows[rowList[i]] || [];
        for (var cc = 0; cc < maxCols; cc++) if (row[cc]) { hasContent = true; break; }
      }
    } else if (sel.mode === 'col') {
      sel.cols.forEach(function (col) {
        for (var r = 1; r < rows.length; r++) if (rows[r] && rows[r][col]) { hasContent = true; return; }
      });
    } else {
      for (var rr = rg.r1; rr <= rg.r2 && !hasContent; rr++) {
        var line = rows[rr] || [];
        for (var c2 = rg.c1; c2 <= rg.c2; c2++) if (line[c2]) { hasContent = true; break; }
      }
    }
    if (!hasContent) return;

    withSnapshot(function () {
      if (sel.mode === 'row') {
        for (var i2 = 0; i2 < rowList.length; i2++) {
          if (!rows[rowList[i2]]) continue;
          for (var c3 = 0; c3 < maxCols; c3++) rows[rowList[i2]][c3] = '';
        }
      } else if (sel.mode === 'col') {
        for (var r2 = 1; r2 < rows.length; r2++) {
          if (!rows[r2]) continue;
          sel.cols.forEach(function (col2) { rows[r2][col2] = ''; });
        }
      } else {
        Ops.clearRange(rows, rg);
      }
    });
    afterMutation();
  }

  function insertRow(offset) {
    commitEditing();
    var pos = (sel.r > 0 && sel.r < rows.length) ? sel.r + offset : rows.length;
    if (pos < 1) pos = 1;
    withSnapshot(function () {
      var empty = [];
      for (var c = 0; c < maxCols; c++) empty.push('');
      rows.splice(pos, 0, empty);
      rowOrigIdx.splice(pos, 0, -1);
    });
    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = pos;
    sel.range = { r1: pos, r2: pos, c1: sel.c, c2: sel.c };
    afterMutation();
    ensureRowVisible(pos);
  }

  function appendRow() {
    commitEditing();
    withSnapshot(function () {
      var empty = [];
      for (var c = 0; c < maxCols; c++) empty.push('');
      rows.push(empty);
      rowOrigIdx.push(-1);
    });
    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = rows.length - 1;
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    afterMutation();
    if (bodyContainer) bodyContainer.scrollTop = bodyContainer.scrollHeight;
    updateVirtualScroll(true);
  }

  function duplicateRows(idxs) {
    commitEditing();
    var list = idxs.filter(function (r) { return r >= 1 && r < rows.length; });
    if (!list.length) return;
    var lookup = {};
    for (var i = 0; i < list.length; i++) lookup[list[i]] = true;

    withSnapshot(function () {
      var newRows = [];
      var newOrig = [];
      for (var r = 0; r < rows.length; r++) {
        newRows.push(rows[r]);
        newOrig.push(rowOrigIdx[r]);
        if (lookup[r]) {
          newRows.push(rows[r].slice());
          newOrig.push(-1);
        }
      }
      rows = newRows;
      rowOrigIdx = newOrig;
    });

    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = Math.min(list[list.length - 1] + list.length, rows.length - 1);
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    afterMutation();
  }

  function insertCol(offset) {
    commitEditing();
    var pos = clamp(sel.c + offset, 0, maxCols);
    withSnapshot(function () {
      for (var r = 0; r < rows.length; r++) {
        if (!rows[r]) rows[r] = [];
        rows[r].splice(pos, 0, '');
      }
      maxCols++;
    });
    sel.mode = 'cell';
    sel.cols.clear();
    sel.rows.clear();
    sel.c = Math.min(pos, maxCols - 1);
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    afterMutation({ relayout: true });
  }

  function appendCol() {
    commitEditing();
    withSnapshot(function () {
      for (var r = 0; r < rows.length; r++) {
        if (!rows[r]) rows[r] = [];
        rows[r].push('');
      }
      maxCols++;
    });
    sel.mode = 'cell';
    sel.cols.clear();
    sel.rows.clear();
    sel.c = maxCols - 1;
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    afterMutation({ relayout: true });
  }

  function deleteSelectionRows() {
    if (sel.mode === 'row' && sel.rows.size) deleteRowsByIdx(Array.from(sel.rows));
    else deleteRowsByIdx([sel.r]);
  }

  function deleteSelectionCols() {
    if (sel.mode === 'col' && sel.cols.size) deleteColsByIdx(Array.from(sel.cols));
    else deleteColsByIdx([sel.c]);
  }

  function fillDownOrDuplicate() {
    commitEditing();
    if (sel.mode === 'row' && sel.rows.size > 0) {
      duplicateRows(Array.from(sel.rows));
      return;
    }
    var rg = sel.range || { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    if (rg.r2 === rg.r1) {
      // 单格：向下复制一格
      if (sel.r + 1 >= rows.length) return;
      withSnapshot(function () {
        Ops.ensureSize(rows, rowOrigIdx, sel.r + 2, maxCols);
        for (var c = rg.c1; c <= rg.c2; c++) {
          rows[sel.r + 1][c] = (rows[sel.r] && rows[sel.r][c]) || '';
        }
      });
      afterMutation();
      return;
    }
    withSnapshot(function () {
      Ops.fillDown(rows, rg);
    });
    afterMutation();
  }

  function handleDelete() {
    if (sel.mode === 'row' && sel.rows.size) deleteRowsByIdx(Array.from(sel.rows));
    else if (sel.mode === 'col' && sel.cols.size) deleteColsByIdx(Array.from(sel.cols));
    else clearContents();
  }

  // ================= 键盘导航 =================

  function moveActive(dr, dc, extend) {
    if (sel.mode !== 'cell') {
      sel.mode = 'cell';
      sel.rows.clear();
      sel.cols.clear();
      sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    }

    var newR = sel.r;
    var newC = sel.c;

    if (dr !== 0) {
      var fi = filteredIndices.indexOf(sel.r);
      if (fi === -1) fi = 0;
      var ni = clamp(fi + dr, 0, Math.max(0, filteredIndices.length - 1));
      if (filteredIndices.length) newR = filteredIndices[ni];
    }

    if (dc !== 0) {
      newC = clamp(sel.c + dc, 0, Math.max(0, maxCols - 1));
    }

    if (extend) {
      sel.range = Ops.normalizeRange(sel.anchor, { r: newR, c: newC });
    } else {
      sel.anchor = { r: newR, c: newC };
      sel.range = { r1: newR, r2: newR, c1: newC, c2: newC };
    }
    sel.r = newR;
    sel.c = newC;
    refreshSelection();
    ensureCellVisible(newR, newC);
  }

  function tabMove(dir) {
    var newC = sel.c + dir;
    var newR = sel.r;
    if (newC < 0) {
      var fi = filteredIndices.indexOf(sel.r);
      if (fi > 0) { newR = filteredIndices[fi - 1]; newC = Math.max(0, maxCols - 1); }
      else newC = 0;
    } else if (newC >= maxCols) {
      var fi2 = filteredIndices.indexOf(sel.r);
      if (fi2 >= 0 && fi2 < filteredIndices.length - 1) { newR = filteredIndices[fi2 + 1]; newC = 0; }
      else newC = Math.max(0, maxCols - 1);
    }
    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = newR;
    sel.c = newC;
    sel.anchor = { r: newR, c: newC };
    sel.range = { r1: newR, r2: newR, c1: newC, c2: newC };
    refreshSelection();
    ensureCellVisible(newR, newC);
  }

  function saveNow() {
    commitEditing();
    if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
    vscode.postMessage({ type: 'save', rows: rows, rowOrigIdx: rowOrigIdx });
  }

  // ================= 事件绑定 =================

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.type === 'error') {
      showError(msg.message);
      return;
    }
    if (msg.type !== 'load') return;

    if (errorBox) errorBox.style.display = 'none';
    commitEditing();

    var prevR = sel.r;
    var prevC = sel.c;
    var prevScrollTop = bodyContainer ? bodyContainer.scrollTop : 0;
    var prevScrollLeft = bodyContainer ? bodyContainer.scrollLeft : 0;

    rows = msg.data.rows || [];
    rowOrigIdx = rows.map(function (_, i) { return i; });
    maxCols = msg.data.maxCols || 0;

    rowsLayer.innerHTML = '';
    rowPool = [];
    poolColCount = -1;
    lastStartIdx = -1;
    editingCell = null;
    undoStack.length = 0;
    redoStack.length = 0;
    refreshUndoButtons();

    sel.mode = 'cell';
    sel.rows.clear();
    sel.cols.clear();
    sel.r = rows.length > 1 ? clamp(prevR, 1, rows.length - 1) : 1;
    sel.c = clamp(prevC, 0, Math.max(0, maxCols - 1));
    sel.anchor = { r: sel.r, c: sel.c };
    sel.range = { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };

    renderHeader();
    updateFilter(false);

    if (bodyContainer) {
      bodyContainer.scrollTop = prevScrollTop;
      bodyContainer.scrollLeft = prevScrollLeft;
    }
    updateVirtualScroll(true);
    updateInfo();
  });

  if (bodyContainer) {
    bodyContainer.addEventListener('scroll', function () {
      if (!isTicking) {
        window.requestAnimationFrame(function () {
          updateVirtualScroll();
          isTicking = false;
        });
        isTicking = true;
      }
    }, { passive: true });
  }

  window.addEventListener('resize', function () {
    lastStartIdx = -1;
    updateVirtualScroll(true);
  });

  if (searchInput) {
    searchInput.disabled = false;
    searchInput.addEventListener('input', function () {
      commitEditing();
      updateFilter(true);
    });
  }

  // 表头：列选择 + 折叠
  if (headerRow) {
    headerRow.addEventListener('click', function (e) {
      if (e.target.closest('.col-toggle-btn')) return;
      var cell = e.target.closest('.cell');
      if (!cell || cell.dataset.c === undefined) return;
      var c = parseInt(cell.dataset.c, 10);
      if (isNaN(c)) return;
      selectCol(c, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    });
  }

  // 行号：行选择；单元格：选中 / 双击编辑
  if (rowsLayer) {
    rowsLayer.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('cell-editor')) return;

      var numCell = e.target.closest('.cell-num');
      if (numCell && numCell.dataset.r !== undefined && numCell.parentElement &&
          numCell.parentElement.classList.contains('data-row')) {
        var rowIdx = parseInt(numCell.dataset.r, 10);
        if (!isNaN(rowIdx)) {
          selectRow(rowIdx, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
          return;
        }
      }

      var cell = e.target.closest('.cell');
      if (!cell) return;
      var r = parseInt(cell.dataset.r, 10);
      var c = parseInt(cell.dataset.c, 10);
      if (isNaN(r) || isNaN(c)) return;
      selectCell(r, c, { shift: e.shiftKey });
    });

    rowsLayer.addEventListener('dblclick', function (e) {
      var cell = e.target.closest('.cell');
      if (!cell) return;
      var r = parseInt(cell.dataset.r, 10);
      var c = parseInt(cell.dataset.c, 10);
      if (isNaN(r) || isNaN(c)) return;
      beginEditAt(r, c);
    });
  }

  // 原生 copy/cut/paste（焦点不在输入框时）
  document.addEventListener('copy', function (e) {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (!filteredIndices.length && rows.length <= 1) return;
    e.clipboardData.setData('text/plain', Ops.toTSV(Ops.selectionMatrix(rows, maxCols, currentSelection())));
    e.preventDefault();
  });

  document.addEventListener('cut', function (e) {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (!filteredIndices.length && rows.length <= 1) return;
    e.clipboardData.setData('text/plain', Ops.toTSV(Ops.selectionMatrix(rows, maxCols, currentSelection())));
    e.preventDefault();
    clearContents();
  });

  document.addEventListener('paste', function (e) {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    var text = e.clipboardData.getData('text/plain');
    if (text === '') return;
    e.preventDefault();
    applyPasteText(text, sel.r, sel.c);
  });

  // 右键菜单
  var contextMenu = document.createElement('div');
  contextMenu.id = 'slk-context-menu';
  contextMenu.className = 'slk-context-menu';
  document.body.appendChild(contextMenu);

  function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextMenu.innerHTML = '';
  }

  function menuItem(label, action, disabled) {
    var el = document.createElement('div');
    el.className = 'slk-menu-item' + (disabled ? ' disabled' : '');
    el.textContent = label;
    if (!disabled) {
      el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        hideContextMenu();
        action();
      });
    }
    contextMenu.appendChild(el);
  }

  function menuSeparator() {
    var sep = document.createElement('div');
    sep.className = 'slk-menu-sep';
    contextMenu.appendChild(sep);
  }

  function showContextMenu(x, y) {
    contextMenu.innerHTML = '';

    menuItem(t('menu.copy'), doCopy);
    menuItem(t('menu.cut'), doCut);
    menuItem(t('menu.paste'), async function () {
      var pr = sel.r;
      var pc = sel.c;
      var text = await clipboardRead();
      if (text !== null && text !== '') applyPasteText(text, pr, pc);
    });
    menuItem(t('menu.clear'), function () { clearContents(); });

    menuSeparator();

    if (sel.mode === 'row') {
      menuItem(t('menu.deleteRows'), deleteSelectionRows);
      menuItem(t('menu.duplicateRow'), fillDownOrDuplicate);
    } else if (sel.mode === 'col') {
      menuItem(t('menu.deleteCols'), deleteSelectionCols);
    } else {
      menuItem(t('menu.insertRow'), function () { insertRow(1); });
      menuItem(t('menu.duplicateRow'), fillDownOrDuplicate);
    }

    menuSeparator();
    menuItem(t('menu.selectAll'), selectAll);

    contextMenu.style.display = 'block';
    var rect = contextMenu.getBoundingClientRect();
    var nx = x;
    var ny = y;
    if (nx + rect.width > window.innerWidth) nx = window.innerWidth - rect.width - 4;
    if (ny + rect.height > window.innerHeight) ny = window.innerHeight - rect.height - 4;
    if (nx < 0) nx = 4;
    if (ny < 0) ny = 4;
    contextMenu.style.left = nx + 'px';
    contextMenu.style.top = ny + 'px';
  }

  if (rowsLayer) {
    rowsLayer.addEventListener('contextmenu', function (e) {
      var numCell = e.target.closest('.cell-num');
      var cell = e.target.closest('.cell');
      if (!numCell && !cell) return;

      e.preventDefault();
      e.stopPropagation();
      commitEditing();

      if (numCell && numCell.parentElement && numCell.parentElement.classList.contains('data-row')) {
        var rowIdx = parseInt(numCell.dataset.r, 10);
        if (!isNaN(rowIdx) && !(sel.mode === 'row' && sel.rows.has(rowIdx))) {
          selectRow(rowIdx, {});
        }
      } else if (cell) {
        var r = parseInt(cell.dataset.r, 10);
        var c = parseInt(cell.dataset.c, 10);
        if (!isNaN(r) && !isNaN(c)) {
          var inside = (sel.mode === 'row' && sel.rows.has(r)) ||
            (sel.mode === 'col' && sel.cols.has(c)) ||
            (sel.mode === 'cell' && sel.range && r >= sel.range.r1 && r <= sel.range.r2 &&
              c >= sel.range.c1 && c <= sel.range.c2);
          if (!inside) selectCell(r, c, {});
        }
      }
      showContextMenu(e.clientX, e.clientY);
    });
  }

  document.addEventListener('click', function (e) {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('contextmenu', function (e) {
    if (!e.target.closest('.cell') && !e.target.closest('.cell-num')) hideContextMenu();
  });
  if (bodyContainer) bodyContainer.addEventListener('scroll', hideContextMenu, { passive: true });
  window.addEventListener('blur', hideContextMenu);

  function notifyChange() {
    updateInfo();
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(function () {
      changeTimer = null;
      vscode.postMessage({ type: 'contentChanged', rows: rows, rowOrigIdx: rowOrigIdx });
    }, 150);
  }

  // 全局快捷键
  document.addEventListener('keydown', function (e) {
    var ae = document.activeElement;
    var inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
    var ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      saveNow();
      return;
    }

    if (editingCell) return;
    if (inInput) return;

    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveActive(-1, 0, e.shiftKey); return;
      case 'ArrowDown': e.preventDefault(); moveActive(1, 0, e.shiftKey); return;
      case 'ArrowLeft': e.preventDefault(); moveActive(0, -1, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); moveActive(0, 1, e.shiftKey); return;
      case 'Tab': e.preventDefault(); tabMove(e.shiftKey ? -1 : 1); return;
      case 'Enter': e.preventDefault(); moveActive(1, 0, false); return;
      case 'F2': e.preventDefault(); beginEditAt(sel.r, sel.c); return;
      case 'Escape':
        if (sel.mode !== 'cell' || (sel.range && (sel.range.r1 !== sel.range.r2 || sel.range.c1 !== sel.range.c2))) {
          selectCell(sel.r, sel.c, {});
          e.preventDefault();
        }
        return;
      case 'Delete': e.preventDefault(); handleDelete(); return;
      case 'Backspace': e.preventDefault(); clearContents(); return;
      default: break;
    }

    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDownOrDuplicate(); return; }

    // 直接键入进入编辑
    if (!ctrl && !e.altKey && !e.isComposing && e.key.length === 1) {
      beginEditAt(sel.r, sel.c, e.key);
      e.preventDefault();
    }
  }, true);

  // 工具栏按钮
  function bind(id, handler) {
    var el = getEl(id);
    if (el) el.addEventListener('click', handler);
  }

  bind('undo', function () { undo(); });
  bind('redo', function () { redo(); });
  bind('add-row', function () { insertRow(1); });
  bind('add-row-end', function () { appendRow(); });
  bind('dup-row', function () { uniqueDup(); });
  bind('del-row', function () { deleteSelectionRows(); });
  bind('add-col', function () { insertCol(1); });
  bind('add-col-end', function () { appendCol(); });
  bind('del-col', function () { deleteSelectionCols(); });

  function uniqueDup() {
    if (sel.mode === 'row' && sel.rows.size) duplicateRows(Array.from(sel.rows));
    else duplicateRows([sel.r]);
  }

  refreshUndoButtons();
  if (errorBox) {
    errorBox.addEventListener('click', function () {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    });
  }
  vscode.postMessage({ type: 'ready' });
})();
