import * as vscode from 'vscode';
import { parseSLK, stringifySLK } from './slkParser';

export class SlkEditorProvider implements vscode.CustomTextEditorProvider {
  private isUpdatingFromWebview = false;

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SlkEditorProvider(context);
    return vscode.window.registerCustomEditorProvider('war3.slkEditor', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (this.isUpdatingFromWebview) return;

      const text = document.getText();
      const slkData = parseSLK(text);
      webviewPanel.webview.postMessage({
        type: 'update',
        grid: slkData.grid,
      });
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'saveGrid') {
        const newSlkText = stringifySLK(message.grid);
        this.isUpdatingFromWebview = true;
        await this.updateTextDocument(document, newSlkText);
        this.isUpdatingFromWebview = false;
      }
    });

    updateWebview();
  }

  private updateTextDocument(document: vscode.TextDocument, newText: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newText
    );
    return vscode.workspace.applyEdit(edit);
  }

  private getHtmlForWebview(): string {
    return /* html */ `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: var(--vscode-font-family); padding: 8px; margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
          .toolbar { margin-bottom: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 2px; }
          button:hover { background: var(--vscode-button-hoverBackground); }
          button:disabled { opacity: 0.3; cursor: not-allowed; }
          input[type="text"], select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); padding: 3px 6px; border-radius: 2px; }
          .page-info { font-size: 12px; }
          .table-container { overflow: auto; height: calc(100vh - 50px); border: 1px solid var(--vscode-panel-border); }
          
          table { border-collapse: collapse; width: 100%; font-size: 12px; }
          th, td { 
            border: 1px solid var(--vscode-tree-tableColumnsBorder, #333); 
            padding: 0; 
            white-space: nowrap; 
            min-width: 90px;
          }
          th { 
            background: var(--vscode-editorHeader-background, #252526); 
            position: sticky; 
            top: 0; 
            z-index: 2; 
            font-weight: bold; 
            text-align: left; 
            padding: 4px 6px; 
            box-sizing: border-box; 
          }
          td input { 
            width: 100%; 
            border: none; 
            background: transparent; 
            color: inherit; 
            font-size: 12px; 
            font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace); 
            padding: 3px 4px; 
            box-sizing: border-box; 
          }
          td input:focus { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-input-background); }
          
          /* 行号首列纯净样式 */
          .row-header { 
            background: var(--vscode-editorHeader-background, #252526); 
            width: 45px; 
            min-width: 45px !important; 
            max-width: 45px !important; 
            position: sticky; 
            left: 0; 
            z-index: 3; 
            user-select: none; 
            font-weight: bold; 
            color: var(--vscode-descriptionForeground); 
            padding: 3px 6px;
            text-align: center;
          }

          /* VS Code 原生风格右键菜单 */
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
            padding: 5px 12px;
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
          <button id="prevBtn">上一页</button>
          <span id="pageInfo" class="page-info">第 1 / 1 页</span>
          <button id="nextBtn">下一页</button>
          
          <label style="font-size:12px;">每页: 
            <select id="pageSizeSelect">
              <option value="30">30行</option>
              <option value="50" selected>50行</option>
              <option value="100">100行</option>
              <option value="200">200行</option>
            </select>
          </label>

          <input type="text" id="searchInput" placeholder="查找代码/别名/数值..." style="width:160px;" />

          <span style="color: var(--vscode-descriptionForeground);">|</span>
          <button id="addRowBtn">+ 追加空行</button>
          <button id="addColBtn">+ 追加列</button>
        </div>

        <div class="table-container" id="tableContainer">
          <table id="slkTable"></table>
        </div>

        <!-- 右键菜单 -->
        <div id="contextMenu" class="context-menu">
          <div class="context-menu-item" id="menuCloneRow">向下克隆当前行</div>
          <div class="context-menu-item" id="menuDelRow">删除当前行</div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let gridData = [];
          let filteredIndices = [];
          let currentPage = 1;
          let pageSize = 50;
          let targetRowIndex = -1; // 记录当前右键选中的真实行索引

          const contextMenu = document.getElementById('contextMenu');

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
              gridData = message.grid || [];
              applyFilter();
            }
          });

          function applyFilter() {
            const query = document.getElementById('searchInput').value.trim().toLowerCase();
            filteredIndices = [];
            if (!query) {
              for (let r = 1; r < gridData.length; r++) filteredIndices.push(r);
            } else {
              for (let r = 1; r < gridData.length; r++) {
                const rowStr = gridData[r].join(' ').toLowerCase();
                if (rowStr.includes(query)) {
                  filteredIndices.push(r);
                }
              }
            }
            currentPage = 1;
            renderTable();
          }

          function escapeHtml(str) {
            return String(str ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          }

          function renderTable() {
            const table = document.getElementById('slkTable');
            if (gridData.length === 0) {
              table.innerHTML = '';
              return;
            }

            const colCount = gridData[0] ? gridData[0].length : 0;
            let html = '<thead><tr><th class="row-header">#</th>';
            for (let c = 0; c < colCount; c++) {
              const colName = gridData[0][c] || ('Col ' + (c + 1));
              html += '<th>' + escapeHtml(colName) + '</th>';
            }
            html += '</tr></thead><tbody>';

            const totalRows = filteredIndices.length;
            const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const start = (currentPage - 1) * pageSize;
            const end = Math.min(start + pageSize, totalRows);

            for (let i = start; i < end; i++) {
              const r = filteredIndices[i];
              html += '<tr data-row="' + r + '"><td class="row-header" data-row="' + r + '">' + r + '</td>';
              for (let c = 0; c < colCount; c++) {
                const val = gridData[r][c] || '';
                html += '<td><input type="text" data-row="' + r + '" data-col="' + c + '" value="' + escapeHtml(val) + '" /></td>';
              }
              html += '</tr>';
            }
            html += '</tbody>';
            table.innerHTML = html;

            document.getElementById('pageInfo').textContent = 
              '第 ' + currentPage + ' / ' + totalPages + ' 页 (共 ' + totalRows + ' 条记录)';
            document.getElementById('prevBtn').disabled = currentPage <= 1;
            document.getElementById('nextBtn').disabled = currentPage >= totalPages;
          }

          function sendData() {
            vscode.postMessage({ type: 'saveGrid', grid: gridData });
          }

          function hideContextMenu() {
            contextMenu.style.display = 'none';
          }

          // 隐藏右键菜单的全局监听
          document.addEventListener('click', hideContextMenu);
          document.getElementById('tableContainer').addEventListener('scroll', hideContextMenu);

          // 监听表格右键事件
          document.getElementById('slkTable').addEventListener('contextmenu', (e) => {
            const target = e.target.closest('[data-row]');
            if (!target) return;

            const r = parseInt(target.dataset.row, 10);
            if (isNaN(r) || r < 1) return; // 忽略表头右键

            e.preventDefault();
            targetRowIndex = r;

            // 定位并显示自定义右键菜单
            contextMenu.style.left = e.clientX + 'px';
            contextMenu.style.top = e.clientY + 'px';
            contextMenu.style.display = 'block';
          });

          // 右键菜单项：向下克隆当前行
          document.getElementById('menuCloneRow').addEventListener('click', () => {
            if (targetRowIndex < 1 || targetRowIndex >= gridData.length) return;
            const rowCopy = [...gridData[targetRowIndex]];
            gridData.splice(targetRowIndex + 1, 0, rowCopy);
            applyFilter();
            sendData();
            hideContextMenu();
          });

          // 右键菜单项：删除当前行
          document.getElementById('menuDelRow').addEventListener('click', () => {
            if (targetRowIndex < 1 || targetRowIndex >= gridData.length) return;
            gridData.splice(targetRowIndex, 1);
            applyFilter();
            sendData();
            hideContextMenu();
          });

          // 事件委托：处理输入框修改
          document.getElementById('slkTable').addEventListener('change', (e) => {
            if (e.target && e.target.tagName === 'INPUT') {
              const r = parseInt(e.target.dataset.row, 10);
              const c = parseInt(e.target.dataset.col, 10);
              gridData[r][c] = e.target.value;
              sendData();
            }
          });

          document.getElementById('searchInput').addEventListener('input', applyFilter);

          document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
            pageSize = parseInt(e.target.value, 10);
            renderTable();
          });

          document.getElementById('prevBtn').addEventListener('click', () => {
            if (currentPage > 1) {
              currentPage--;
              renderTable();
              document.querySelector('.table-container').scrollTop = 0;
            }
          });

          document.getElementById('nextBtn').addEventListener('click', () => {
            const totalPages = Math.ceil(filteredIndices.length / pageSize);
            if (currentPage < totalPages) {
              currentPage++;
              renderTable();
              document.querySelector('.table-container').scrollTop = 0;
            }
          });

          document.getElementById('addRowBtn').addEventListener('click', () => {
            if (gridData.length === 0) return;
            gridData.push(new Array(gridData[0].length).fill(''));
            applyFilter();
            currentPage = Math.ceil(filteredIndices.length / pageSize);
            renderTable();
            sendData();
          });

          document.getElementById('addColBtn').addEventListener('click', () => {
            if (gridData.length === 0) gridData.push(['']);
            else gridData.forEach(row => row.push(''));
            renderTable();
            sendData();
          });
        </script>
      </body>
      </html>
    `;
  }
}