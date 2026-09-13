export function getHtmlForWebview(): string {
  return /* html */ `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <style>
        body { 
          font-family: var(--vscode-font-family); 
          padding: 0; 
          margin: 0; 
          background: var(--vscode-editor-background); 
          color: var(--vscode-editor-foreground); 
          overflow: hidden; 
        }

        .toolbar { 
          height: 38px; 
          padding: 0 12px; 
          display: flex; 
          align-items: center; 
          gap: 10px; 
          background: var(--vscode-editorHeader-background, #252526); 
          border-bottom: 1px solid var(--vscode-panel-border, #333); 
          box-sizing: border-box; 
          font-size: 12px;
        }

        button { 
          background: var(--vscode-button-background); 
          color: var(--vscode-button-foreground); 
          border: none; 
          padding: 4px 10px; 
          cursor: pointer; 
          border-radius: 2px; 
          font-size: 12px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        
        input[type="text"] { 
          background: var(--vscode-input-background); 
          color: var(--vscode-input-foreground); 
          border: 1px solid var(--vscode-input-border, #444); 
          padding: 3px 6px; 
          border-radius: 2px; 
          font-size: 12px;
        }

        .stats-info {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
          margin-left: auto;
        }

        .table-container { 
          overflow: auto; 
          height: calc(100vh - 38px); 
          position: relative;
        }

        .scroll-phantom {
          position: absolute;
          left: 0;
          top: 0;
          width: 1px;
          pointer-events: none;
        }

        .header-sticky-wrapper {
          position: sticky;
          top: 0;
          z-index: 100;
          background: var(--vscode-editorHeader-background, #252526);
          width: max-content;
          min-width: 100%;
        }

        .slk-table { 
          border-collapse: collapse; 
          table-layout: fixed; 
          width: max-content; 
          min-width: 100%;
          font-size: 12px; 
        }

        .body-table {
          position: absolute;
          top: 26px;
          left: 0;
        }

        th, td { 
          border: 1px solid var(--vscode-tree-tableColumnsBorder, #333); 
          padding: 0; 
          white-space: nowrap; 
          box-sizing: border-box;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        th { 
          background: var(--vscode-editorHeader-background, #252526); 
          font-weight: bold; 
          text-align: left; 
          padding: 4px 6px; 
          user-select: none;
          height: 26px;
        }

        tbody {
          will-change: transform;
        }

        td input { 
          width: 100%; 
          height: 25px;
          border: none; 
          background: transparent; 
          color: inherit; 
          font-size: 12px; 
          font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace); 
          padding: 2px 5px; 
          box-sizing: border-box; 
        }
        td input:focus { 
          outline: 1px solid var(--vscode-focusBorder); 
          background: var(--vscode-input-background); 
        }
        
        .row-header { 
          background: var(--vscode-editorHeader-background, #252526); 
          position: sticky; 
          left: 0; 
          z-index: 5; 
          user-select: none; 
          font-weight: bold; 
          color: var(--vscode-descriptionForeground); 
          text-align: center;
          height: 26px;
        }

        th.row-header {
          z-index: 105;
        }

        .context-menu {
          display: none;
          position: fixed;
          z-index: 1000;
          background: var(--vscode-menu-background, #252526);
          color: var(--vscode-menu-foreground, #cccccc);
          border: 1px solid var(--vscode-menu-border, #454545);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
          padding: 4px 0;
          border-radius: 4px;
          min-width: 150px;
          font-size: 12px;
          user-select: none;
        }
        .context-menu-item {
          padding: 6px 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .context-menu-item:hover {
          background: var(--vscode-menu-selectionBackground, #04395e);
          color: var(--vscode-menu-selectionForeground, #ffffff);
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <input type="text" id="searchInput" placeholder="查找代码 / 别名 / 数值..." style="width: 220px;" />
        <button id="addRowBtn">+ 在末尾添加新行</button>
        <button id="addColBtn">+ 添加新列</button>
        <span id="statsInfo" class="stats-info">加载中...</span>
      </div>

      <div class="table-container" id="container">
        <div class="scroll-phantom" id="phantom"></div>
        
        <div class="header-sticky-wrapper">
          <table class="slk-table">
            <colgroup id="colGroupHeader"></colgroup>
            <thead id="tableHead"></thead>
          </table>
        </div>

        <table class="slk-table body-table">
          <colgroup id="colGroupBody"></colgroup>
          <tbody id="tableBody"></tbody>
        </table>
      </div>

      <div id="contextMenu" class="context-menu">
        <div class="context-menu-item" id="menuCloneRow">📋 向下克隆当前行</div>
        <div class="context-menu-item" id="menuInsertRow">➕ 在下方插入空行</div>
        <div class="context-menu-item" id="menuDelRow">🗑️ 删除当前行</div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        
        const ROW_HEIGHT = 26;
        const TOP_BUFFER = 20;

        let gridData = [];
        let filteredIndices = [];
        let targetRowIndex = -1;
        let searchTimeout = null;
        let poolRows = [];
        let currentStartIdx = -1;
        let isTicking = false;

        const container = document.getElementById('container');
        const phantom = document.getElementById('phantom');
        const colGroupHeader = document.getElementById('colGroupHeader');
        const colGroupBody = document.getElementById('colGroupBody');
        const tableHead = document.getElementById('tableHead');
        const tableBody = document.getElementById('tableBody');
        const contextMenu = document.getElementById('contextMenu');
        const statsInfo = document.getElementById('statsInfo');

        function getPoolSize() {
          const visibleRows = Math.ceil((container.clientHeight || 800) / ROW_HEIGHT);
          return Math.max(120, visibleRows + 40);
        }

        window.addEventListener('message', event => {
          const message = event.data;
          if (message.type === 'update') {
            gridData = message.grid || [];
            applyFilter();
          }
        });

        function isRowMatched(row, query) {
          if (!row) return false;
          for (let c = 0; c < row.length; c++) {
            const val = row[c];
            if (val !== undefined && val !== null && String(val).toLowerCase().indexOf(query) !== -1) {
              return true;
            }
          }
          return false;
        }

        function applyFilter() {
          const query = document.getElementById('searchInput').value.trim().toLowerCase();
          filteredIndices = [];
          
          if (!query) {
            for (let r = 1; r < gridData.length; r++) filteredIndices.push(r);
          } else {
            for (let r = 1; r < gridData.length; r++) {
              if (isRowMatched(gridData[r], query)) {
                filteredIndices.push(r);
              }
            }
          }
          
          statsInfo.textContent = '显示 ' + filteredIndices.length + ' 行 / 总计 ' + Math.max(0, gridData.length - 1) + ' 行';
          
          const totalHeight = (filteredIndices.length * ROW_HEIGHT) + ROW_HEIGHT;
          phantom.style.height = totalHeight + 'px';

          buildHeaderAndPool();
          bindRecycler(true);
        }

        function escapeHtml(str) {
          return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }

        function buildHeaderAndPool() {
          const colCount = gridData[0] ? gridData[0].length : 0;
          
          let colHtml = '<col style="width: 50px;" />';
          for (let c = 0; c < colCount; c++) colHtml += '<col style="width: 130px;" />';
          colGroupHeader.innerHTML = colHtml;
          colGroupBody.innerHTML = colHtml;

          let headHtml = '<tr><th class="row-header">#</th>';
          for (let c = 0; c < colCount; c++) {
            const colName = gridData[0][c] || ('Col ' + (c + 1));
            headHtml += '<th title="' + escapeHtml(colName) + '">' + escapeHtml(colName) + '</th>';
          }
          headHtml += '</tr>';
          tableHead.innerHTML = headHtml;

          tableBody.innerHTML = '';
          poolRows = [];

          const poolSize = getPoolSize();
          for (let i = 0; i < poolSize; i++) {
            const tr = document.createElement('tr');
            tr.style.height = ROW_HEIGHT + 'px';
            
            const tdHeader = document.createElement('td');
            tdHeader.className = 'row-header';
            tr.appendChild(tdHeader);

            const cellInputs = [];
            for (let c = 0; c < colCount; c++) {
              const td = document.createElement('td');
              const input = document.createElement('input');
              input.type = 'text';
              td.appendChild(input);
              tr.appendChild(td);
              cellInputs.push(input);
            }

            tableBody.appendChild(tr);
            poolRows.push({
              tr: tr,
              tdHeader: tdHeader,
              inputs: cellInputs
            });
          }
        }

        function bindRecycler(force = false) {
          if (filteredIndices.length === 0) {
            tableBody.style.transform = 'translateY(0px)';
            poolRows.forEach(h => h.tr.style.display = 'none');
            return;
          }

          const scrollTop = container.scrollTop;
          const rawStart = Math.floor(scrollTop / ROW_HEIGHT);
          const startIdx = Math.max(0, rawStart - TOP_BUFFER);

          if (!force && startIdx === currentStartIdx) return;
          currentStartIdx = startIdx;

          tableBody.style.transform = 'translateY(' + (startIdx * ROW_HEIGHT) + 'px)';

          const totalRows = filteredIndices.length;
          const activeEl = document.activeElement;
          const poolSize = poolRows.length;

          for (let i = 0; i < poolSize; i++) {
            const holder = poolRows[i];
            const realIndex = startIdx + i;

            if (realIndex < totalRows) {
              const r = filteredIndices[realIndex];
              const rowData = gridData[r] || [];

              holder.tr.style.display = '';
              holder.tr.dataset.row = r;
              holder.tdHeader.textContent = r;
              holder.tdHeader.dataset.row = r;

              for (let c = 0; c < holder.inputs.length; c++) {
                const input = holder.inputs[c];
                input.dataset.row = r;
                input.dataset.col = c;
                
                if (input !== activeEl) {
                  input.value = rowData[c] ?? '';
                }
              }
            } else {
              holder.tr.style.display = 'none';
            }
          }
        }

        container.addEventListener('scroll', () => {
          if (!isTicking) {
            window.requestAnimationFrame(() => {
              bindRecycler(false);
              isTicking = false;
            });
            isTicking = true;
          }
        });

        tableBody.addEventListener('input', (e) => {
          if (e.target && e.target.tagName === 'INPUT') {
            const r = parseInt(e.target.dataset.row, 10);
            const c = parseInt(e.target.dataset.col, 10);
            const value = e.target.value;
            
            if (!isNaN(r) && !isNaN(c) && gridData[r]) {
              gridData[r][c] = value;
              vscode.postMessage({
                type: 'updateCell',
                row: r,
                col: c,
                value: value
              });
            }
          }
        });

        document.getElementById('searchInput').addEventListener('input', () => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            applyFilter();
            container.scrollTop = 0;
          }, 150);
        });

        function hideContextMenu() {
          contextMenu.style.display = 'none';
        }

        document.addEventListener('click', hideContextMenu);
        container.addEventListener('scroll', hideContextMenu);

        tableBody.addEventListener('contextmenu', (e) => {
          const target = e.target.closest('[data-row]');
          if (!target) return;

          const r = parseInt(target.dataset.row, 10);
          if (isNaN(r) || r < 1) return;

          e.preventDefault();
          targetRowIndex = r;

          contextMenu.style.display = 'block';

          const winWidth = window.innerWidth;
          const winHeight = window.innerHeight;
          const menuWidth = contextMenu.offsetWidth;
          const menuHeight = contextMenu.offsetHeight;

          let x = e.clientX;
          let y = e.clientY;

          if (y + menuHeight > winHeight) {
            y = y - menuHeight;
            if (y < 0) y = Math.max(5, winHeight - menuHeight - 5);
          }

          if (x + menuWidth > winWidth) {
            x = x - menuWidth;
            if (x < 0) x = Math.max(5, winWidth - menuWidth - 5);
          }

          contextMenu.style.left = x + 'px';
          contextMenu.style.top = y + 'px';
        });

        function sendFullData() {
          vscode.postMessage({ type: 'saveGrid', grid: gridData });
        }

        document.getElementById('menuCloneRow').addEventListener('click', () => {
          if (targetRowIndex < 1 || targetRowIndex >= gridData.length) return;
          const rowCopy = [...gridData[targetRowIndex]];
          gridData.splice(targetRowIndex + 1, 0, rowCopy);
          applyFilter();
          sendFullData();
          hideContextMenu();
        });

        document.getElementById('menuInsertRow').addEventListener('click', () => {
          if (targetRowIndex < 1 || targetRowIndex >= gridData.length) return;
          const emptyRow = new Array(gridData[0].length).fill('');
          gridData.splice(targetRowIndex + 1, 0, emptyRow);
          applyFilter();
          sendFullData();
          hideContextMenu();
        });

        document.getElementById('menuDelRow').addEventListener('click', () => {
          if (targetRowIndex < 1 || targetRowIndex >= gridData.length) return;
          gridData.splice(targetRowIndex, 1);
          applyFilter();
          sendFullData();
          hideContextMenu();
        });

        document.getElementById('addRowBtn').addEventListener('click', () => {
          if (gridData.length === 0) return;
          gridData.push(new Array(gridData[0].length).fill(''));
          applyFilter();
          container.scrollTop = container.scrollHeight;
          sendFullData();
        });

        document.getElementById('addColBtn').addEventListener('click', () => {
          if (gridData.length === 0) gridData.push(['']);
          else gridData.forEach(row => row.push(''));
          applyFilter();
          sendFullData();
        });

        window.addEventListener('resize', () => {
          buildHeaderAndPool();
          bindRecycler(true);
        });
      </script>
    </body>
    </html>
  `;
}