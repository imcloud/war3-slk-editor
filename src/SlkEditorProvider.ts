import * as vscode from 'vscode';
import { parseSLK, stringifySLK } from './slkParser';

export class SlkEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'war3.slkEditor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      SlkEditorProvider.viewType,
      new SlkEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    let isSaving = false; // 加一把锁，防止自己保存触发的文档变动反向触发 updateWebview 导致冲刷

    const encItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    const updateEncodingItem = () => {
      const enc = vscode.workspace
        .getConfiguration('files', document.uri)
        .get<string>('encoding') || 'utf8';
      encItem.text = `$(file-code) ${enc.toUpperCase()}`;
      encItem.tooltip = `保存时使用编码：${enc}`;
      encItem.show();
    };

    updateEncodingItem();

    // 配置变化时刷新
    const cfgSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('files.encoding')) updateEncodingItem();
    });

    const updateWebview = () => {
      if (isSaving) return; // 如果正在保存，直接忽略文档变动事件，防止回流覆盖
      try {
        const text = document.getText();
        const slkData = parseSLK(text);
        webviewPanel.webview.postMessage({
          type: 'load',
          data: slkData
        });
      } catch (err: any) {
        webviewPanel.webview.postMessage({
          type: 'error',
          message: 'SLK 解析异常: ' + (err.message || err)
        });
      }
    };

    webviewPanel.webview.onDidReceiveMessage(async e => {
      switch (e.type) {
        case 'ready':
          updateWebview();
          return;
        case 'saveData':
          isSaving = true;
          try {
            await this.updateTextDocument(document, e.rows);
          } finally {
            // 稍等一小段时间再释放锁，确保文档事件稳定
            setTimeout(() => {
              isSaving = false;
            }, 300);
          }
          return;
      }
    });

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        encItem.show();
      } else {
        encItem.hide();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      encItem.dispose();
      cfgSub.dispose();
    });
  }

  private updateTextDocument(document: vscode.TextDocument, rows: string[][]) {
    const newContent = stringifySLK(rows);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, fullRange, newContent);
    return vscode.workspace.applyEdit(edit);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'));
    const nonce = getNonce();

    return /* html */`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet" />
      </head>
      <body>
        <div id="toolbar">
          <button id="add-row"      title="在当前行下方插入空白行">插入行</button>
          <button id="add-row-end"  title="追加空白行到最后">追加行</button>
          <button id="dup-row"      title="复制当前行向下插入">复制行</button>
          <button id="del-row"      title="删除当前行">删除行</button>
          <button id="add-col"      title="在当前列右侧插入空白列">插入列</button>
          <button id="add-col-end"  title="追加空白列到最后">追加列</button>
          <button id="del-col"      title="删除当前列">删除列</button>

          <div style="display:inline-flex; align-items:center; margin-left:10px; gap:4px;">
            <input type="text" id="search-input" placeholder="输入关键词实时过滤行..." style="width:160px;" />
          </div>

          <span id="info"></span>
        </div>

        <div id="grid-wrapper">
          <div id="body-container">
            <div class="header-sticky">
              <div id="header-row" class="header-row"></div>
            </div>
            <div id="rows-area">
              <div id="phantom"></div>
              <div id="rows-layer"></div>
            </div>
          </div>
        </div>

        <div id="error-box"></div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}