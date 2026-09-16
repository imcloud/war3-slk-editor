window.addEventListener('error', (err) => {
  const errBox = document.getElementById('error-box');
  if (errBox) {
    errBox.style.display = 'block';
    errBox.textContent = `[JS 致命报错] ${err.message}`;
  }
});

(function () {
  const vscode = window.vscodeApi || (window.vscodeApi = acquireVsCodeApi());

  const ROW_HEIGHT = 27;
  const BUFFER = 5;
  const CELL_WIDTH = 150;
  const CELL_WIDTH_COLLAPSED = 44;
  const NUM_WIDTH = 60;
  const NUM_WIDTH_COLLAPSED = 44;

  let rows = [];
  let maxCols = 0;
  let selectedCell = { r: 1, c: 0 };
  let editingCell = null;
  let filteredIndices = [];
  let collapsedCols = {};
  let lastStartIdx = -1;
  let isTicking = false;

  let rowPool = [];         // [{ el, cellNum, cells, currentR }]
  let poolColCount = -1;

  const getEl = (id) => document.getElementById(id);
  const bodyContainer = getEl('body-container');
  const headerRow = getEl('header-row');
  const rowsLayer = getEl('rows-layer');
  const phantom = getEl('phantom');
  const infoSpan = getEl('info');
  const searchInput = getEl('search-input');

  // ===== 宽度 =====
  function numWidth() { return collapsedCols[-1] ? NUM_WIDTH_COLLAPSED : NUM_WIDTH; }
  function cellWidth(c) { return collapsedCols[c] ? CELL_WIDTH_COLLAPSED : CELL_WIDTH; }
  function totalWidth() {
    let w = numWidth();
    for (let c = 0; c < maxCols; c++) w += cellWidth(c);
    return w;
  }

  // ===== 表头 =====
  function renderHeader() {
    headerRow.innerHTML = '';

    const thNum = document.createElement('div');
    thNum.className = 'cell-num';
    const spanNum = document.createElement('span');
    spanNum.textContent = '#';
    thNum.appendChild(spanNum);
    headerRow.appendChild(thNum);

    const firstRow = rows[0] || [];
    for (let c = 0; c < maxCols; c++) {
      const th = document.createElement('div');
      th.className = 'cell';
      if (collapsedCols[c]) th.classList.add('col-collapsed');

      if (!collapsedCols[c]) {
        const name = (firstRow[c] !== undefined && firstRow[c] !== '') ? firstRow[c] : `第 ${c + 1} 列`;
        const spanText = document.createElement('span');
        spanText.textContent = name;
        th.appendChild(spanText);
      }

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'col-toggle-btn';
      toggleBtn.textContent = collapsedCols[c] ? '»' : '«';
      toggleBtn.onclick = (e) => { e.stopPropagation(); collapsedCols[c] = !collapsedCols[c]; forceRelayout(); };
      th.appendChild(toggleBtn);
      headerRow.appendChild(th);
    }
  }

  function forceRelayout() {
    poolColCount = -1;
    lastStartIdx = -1;
    renderHeader();
    updateVirtualScroll(true);
  }

  // ===== 池 =====
  function createDataRow() {
    const el = document.createElement('div');
    el.className = 'data-row';

    const cellNum = document.createElement('div');
    cellNum.className = 'cell-num';
    el.appendChild(cellNum);

    const cells = [];
    for (let c = 0; c < maxCols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      el.appendChild(cell);
      cells.push(cell);
    }

    return { el, cellNum, cells, currentR: null };
  }

  function ensurePool(targetCount) {
    // 列数变化时重建
    if (poolColCount !== maxCols) {
      rowsLayer.innerHTML = '';
      rowPool = [];
      const size = Math.max(targetCount + 10, 50);
      for (let i = 0; i < size; i++) {
        const row = createDataRow();
        rowsLayer.appendChild(row.el);
        rowPool.push(row);
      }
      poolColCount = maxCols;
      return;
    }
    while (rowPool.length < targetCount) {
      const row = createDataRow();
      rowsLayer.appendChild(row.el);
      rowPool.push(row);
    }
  }

  // ===== 过滤 =====
  function updateFilter(resetScroll = false) {
    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const oldTop = bodyContainer ? bodyContainer.scrollTop : 0;

    filteredIndices = [];
    if (!kw) {
      for (let i = 1; i < rows.length; i++) filteredIndices.push(i);
    } else {
      for (let i = 1; i < rows.length; i++) {
        const rowData = rows[i] || [];
        for (let c = 0; c < rowData.length; c++) {
          const v = rowData[c];
          if (v !== undefined && String(v).toLowerCase().includes(kw)) {
            filteredIndices.push(i);
            break;
          }
        }
      }
    }

    if (filteredIndices.length > 0) {
      if (!filteredIndices.includes(selectedCell.r)) selectedCell.r = filteredIndices[0];
    } else {
      selectedCell.r = 1;
    }

    lastStartIdx = -1;
    updateVirtualScroll(true);
    updateInfo();
    if (bodyContainer) bodyContainer.scrollTop = resetScroll ? 0 : oldTop;
  }

  // ===== 编辑 =====
  function commitEditing() {
    if (!editingCell) return;
    const input = rowsLayer.querySelector('input.cell-editor');
    if (input) {
      const { r, c } = editingCell;
      if (!rows[r]) rows[r] = [];
      const newVal = input.value;
      if (rows[r][c] !== newVal) {
        rows[r][c] = newVal;
        notifyChange();
      }
      const parent = input.parentElement;
      if (parent) parent.textContent = newVal;
    }
    editingCell = null;
  }

  function startEditing(cellEl, r, c) {
    commitEditing();
    editingCell = { r, c };
    const currentVal = (rows[r] && rows[r][c] !== undefined) ? rows[r][c] : '';
    cellEl.textContent = '';
    const input = document.createElement('input');
    input.className = 'cell-editor';
    input.type = 'text';
    input.value = currentVal;
    input.addEventListener('blur', () => commitEditing());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitEditing();
        const idx = filteredIndices.indexOf(selectedCell.r);
        if (idx !== -1 && idx < filteredIndices.length - 1) {
          selectedCell.r = filteredIndices[idx + 1];
          updateSelectedClass();
          updateInfo();
          scrollToRowIndex(selectedCell.r);
        }
      } else if (e.key === 'Escape') {
        editingCell = null;
        cellEl.textContent = currentVal;
      }
    });
    cellEl.appendChild(input);
    input.focus();
    input.select();
  }

  // ===== 消息 =====
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'load') {
      const prevSelected = { ...selectedCell };
      const prevScrollTop = bodyContainer ? bodyContainer.scrollTop : 0;

      rows = msg.data.rows || [];
      maxCols = msg.data.maxCols || 0;

      rowsLayer.innerHTML = '';
      rowPool = [];
      poolColCount = -1;
      lastStartIdx = -1;
      editingCell = null;

      // 恢复选中位置（夹紧到有效范围）
      const maxR = Math.max(1, rows.length - 1);
      const maxC = Math.max(0, maxCols - 1);
      selectedCell = {
        r: Math.min(Math.max(1, prevSelected.r), maxR),
        c: Math.min(Math.max(0, prevSelected.c), maxC),
      };

      renderHeader();
      updateFilter(false);   // ← 原来是 true，会强制滚回顶部

      // 恢复滚动位置
      if (bodyContainer) bodyContainer.scrollTop = prevScrollTop;
    }
  });

  // ===== 虚拟滚动 =====
  function updateVirtualScroll(force = false) {
    if (!bodyContainer || !rowsLayer) return;

    const dataCount = filteredIndices.length;
    const scrollTop = bodyContainer.scrollTop || 0;
    const viewportHeight = bodyContainer.clientHeight || window.innerHeight || 600;

    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    const endIdx = Math.min(dataCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);

    if (!force && startIdx === lastStartIdx) return;
    lastStartIdx = startIdx;
    commitEditing();

    const targetCount = Math.max(0, endIdx - startIdx);
    ensurePool(targetCount);

    // phantom 尺寸
    const totalH = dataCount * ROW_HEIGHT;
    if (phantom.style.height !== totalH + 'px') phantom.style.height = totalH + 'px';
    const totalW = totalWidth();
    if (phantom.style.width !== totalW + 'px') phantom.style.width = totalW + 'px';

    // rows-layer 整体位移，池内行的 top 不变
    rowsLayer.style.transform = `translateY(${startIdx * ROW_HEIGHT}px)`;

    if (force) for (const r of rowPool) r.currentR = null;

    const selR = selectedCell.r;
    const selC = selectedCell.c;

    for (let i = 0; i < rowPool.length; i++) {
      const row = rowPool[i];

      if (i >= targetCount) {
        if (row.el.style.display !== 'none') row.el.style.display = 'none';
        continue;
      }

      const dataIdx = startIdx + i;
      const r = filteredIndices[dataIdx];

      if (r === undefined || !rows[r]) {
        if (row.el.style.display !== 'none') row.el.style.display = 'none';
        continue;
      }
      if (row.el.style.display === 'none') row.el.style.display = '';

      const topStr = (i * ROW_HEIGHT) + 'px';
      if (row.el.style.top !== topStr) row.el.style.top = topStr;

      if (!force && row.currentR === r) continue;
      row.currentR = r;

      const rStr = String(r);
      if (row.cellNum.textContent !== rStr) row.cellNum.textContent = rStr;
      row.cellNum.dataset.r = r;

      if (collapsedCols[-1]) {
        if (!row.cellNum.classList.contains('col-collapsed')) row.cellNum.classList.add('col-collapsed');
      } else {
        if (row.cellNum.classList.contains('col-collapsed')) row.cellNum.classList.remove('col-collapsed');
      }

      const rowData = rows[r];
      const isSelRow = selR === r;

      for (let c = 0; c < maxCols; c++) {
        const cell = row.cells[c];
        const val = rowData[c] !== undefined ? rowData[c] : '';
        if (cell.textContent !== val) cell.textContent = val;

        if (cell.dataset.r !== rStr) { cell.dataset.r = r; cell.dataset.c = c; }

        const sel = isSelRow && selC === c;
        const hasSel = cell.classList.contains('cell-selected');
        if (sel && !hasSel) cell.classList.add('cell-selected');
        else if (!sel && hasSel) cell.classList.remove('cell-selected');

        const collapsed = !!collapsedCols[c];
        const hasCol = cell.classList.contains('col-collapsed');
        if (collapsed && !hasCol) cell.classList.add('col-collapsed');
        else if (!collapsed && hasCol) cell.classList.remove('col-collapsed');
      }
    }
  }

  function updateSelectedClass() {
    for (const row of rowPool) {
      if (row.currentR === null) continue;
      const isSelRow = row.currentR === selectedCell.r;
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c];
        const sel = isSelRow && selectedCell.c === c;
        const has = cell.classList.contains('cell-selected');
        if (sel && !has) cell.classList.add('cell-selected');
        else if (!sel && has) cell.classList.remove('cell-selected');
      }
    }
  }

  function scrollToRowIndex(realRowIdx) {
    const fi = filteredIndices.indexOf(realRowIdx);
    if (fi === -1) return;
    bodyContainer.scrollTop = fi * ROW_HEIGHT;
  }

  // ===== 事件 =====
  if (searchInput) {
    searchInput.disabled = false;
    searchInput.addEventListener('input', () => {
      commitEditing();
      updateFilter(true);
    });
  }

  if (rowsLayer) {
    rowsLayer.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = parseInt(cell.dataset.r, 10);
      const c = parseInt(cell.dataset.c, 10);
      if (isNaN(r) || isNaN(c)) return;
      if (selectedCell.r !== r || selectedCell.c !== c) {
        commitEditing();
        selectedCell = { r, c };
        updateSelectedClass();
        updateInfo();
      }
    });

    rowsLayer.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = parseInt(cell.dataset.r, 10);
      const c = parseInt(cell.dataset.c, 10);
      if (!isNaN(r) && !isNaN(c)) startEditing(cell, r, c);
    });
  }

  if (bodyContainer) {
    bodyContainer.addEventListener('scroll', () => {
      if (!isTicking) {
        window.requestAnimationFrame(() => {
          updateVirtualScroll();
          isTicking = false;
        });
        isTicking = true;
      }
    }, { passive: true });
  }

  window.addEventListener('resize', () => {
    lastStartIdx = -1;
    updateVirtualScroll(true);
  });

  // ===== 宿主通信 =====
  function notifyChange() {
    // vscode.postMessage({ type: 'saveData', rows });
    updateInfo();
  }

  function updateInfo() {
    if (!infoSpan) return;
    const totalData = Math.max(0, rows.length - 1);
    const fieldName = (rows[0] && rows[0][selectedCell.c]) ? rows[0][selectedCell.c] : `第 ${selectedCell.c + 1} 列`;
    infoSpan.textContent = `总行数: ${totalData} (过滤: ${filteredIndices.length}) | 列: ${maxCols} | 位置: 行 ${selectedCell.r}, 列 ${selectedCell.c + 1} (${fieldName})`;
  }

  // ===== 行/列操作 =====
  function rebuildAndStay(targetRealRow) {
    commitEditing();
    updateFilter(false);
    selectedCell.r = Math.min(Math.max(1, targetRealRow), rows.length - 1);
    notifyChange();
    lastStartIdx = -1;
    updateVirtualScroll(true);
    updateSelectedClass();
    scrollToRowIndex(selectedCell.r);
  }

  getEl('add-row').onclick = () => {
    const pos = (selectedCell.r > 0 && selectedCell.r < rows.length) ? selectedCell.r + 1 : rows.length;
    rows.splice(pos, 0, new Array(maxCols).fill(''));
    rebuildAndStay(pos);
  };

  getEl('add-row-end').onclick = () => {
    rows.push(new Array(maxCols).fill(''));
    rebuildAndStay(rows.length - 1);
    setTimeout(() => {
      if (bodyContainer) bodyContainer.scrollTop = bodyContainer.scrollHeight;
    }, 10);
  };

  getEl('dup-row').onclick = () => {
    if (selectedCell.r <= 0 || !rows[selectedCell.r]) return;
    const copy = [...rows[selectedCell.r]];
    const pos = selectedCell.r + 1;
    rows.splice(pos, 0, copy);
    rebuildAndStay(pos);
  };

  getEl('del-row').onclick = () => {
    commitEditing();
    if (rows.length <= 1) return;
    const pos = selectedCell.r;
    if (pos <= 0 || pos >= rows.length) return;
    rows.splice(pos, 1);
    rebuildAndStay(Math.min(pos, rows.length - 1));
  };

  getEl('add-col').onclick = () => {
    commitEditing();
    const st = bodyContainer.scrollTop;
    const pos = selectedCell.c + 1;
    for (let r = 0; r < rows.length; r++) {
      if (!rows[r]) rows[r] = [];
      rows[r].splice(pos, 0, '');
    }
    maxCols++;
    selectedCell.c = Math.min(pos, maxCols - 1);
    poolColCount = -1;
    lastStartIdx = -1;
    renderHeader();
    bodyContainer.scrollTop = st;
    updateVirtualScroll(true);
    notifyChange();
  };

  getEl('add-col-end').onclick = () => {
    commitEditing();
    const st = bodyContainer.scrollTop;
    for (let r = 0; r < rows.length; r++) {
      if (!rows[r]) rows[r] = [];
      rows[r].push('');
    }
    maxCols++;
    selectedCell.c = maxCols - 1;
    poolColCount = -1;
    lastStartIdx = -1;
    renderHeader();
    bodyContainer.scrollTop = st;
    updateVirtualScroll(true);
    notifyChange();
  };

  getEl('del-col').onclick = () => {
    commitEditing();
    const st = bodyContainer.scrollTop;
    if (maxCols <= 0) return;
    for (let r = 0; r < rows.length; r++) {
      if (rows[r]) rows[r].splice(selectedCell.c, 1);
    }
    maxCols--;
    selectedCell.c = Math.min(selectedCell.c, Math.max(0, maxCols - 1));
    poolColCount = -1;
    lastStartIdx = -1;
    renderHeader();
    bodyContainer.scrollTop = st;
    updateVirtualScroll(true);
    notifyChange();
  };

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      commitEditing();   // 先提交正在编辑的格子
      vscode.postMessage({ type: 'saveData', rows });
    }
  }, true);   // capture 阶段拦截，保证在 input 冒泡前生效

  vscode.postMessage({ type: 'ready' });
})();