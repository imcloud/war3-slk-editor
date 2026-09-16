import * as vscode from 'vscode';
import { parseSLK, stringifySLK, SlkData } from './slkParser';

export class SlkEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'war3.slkEditor';

  // 每个文档的解析元数据（cellMap、headerLines、bRecord、tailLines 等）
  private documentMetadata = new Map<string, SlkData>();

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
    const docUriStr = document.uri.toString();

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // 时间窗口：保存期间忽略 applyEdit 触发的文档变动，避免位置跳
    let suppressDocChangeUntil = 0;

    // 状态栏：保存编码
    const encItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    const updateEncodingItem = () => {
      const enc = vscode.workspace
        .getConfiguration('files', document.uri)
        .get<string>('encoding') || 'utf8';
      encItem.text = `$(file-code) ${enc.toUpperCase()}`;
      encItem.tooltip = `保存时使用编码：${enc}`;
      encItem.show();
    };
    updateEncodingItem();
    const cfgSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('files.encoding')) updateEncodingItem();
    });

    const updateWebview = () => {
      if (Date.now() < suppressDocChangeUntil) return;
      try {
        const text = document.getText();
        const slkData = parseSLK(text);
        // ★ 缓存解析元数据，保存时回传做语义保留
        this.documentMetadata.set(docUriStr, slkData);
        webviewPanel.webview.postMessage({ type: 'load', data: slkData });
      } catch (err: any) {
        webviewPanel.webview.postMessage({
          type: 'error',
          message: 'SLK 解析异常: ' + (err?.message || err)
        });
      }
    };

    webviewPanel.webview.onDidReceiveMessage(async e => {
      switch (e.type) {
        case 'ready':
          updateWebview();
          return;

        case 'saveData':
          suppressDocChangeUntil = Date.now() + 500;
          try {
            // ★ 取出缓存的 meta，让 stringifySLK 做语义保留
            const meta = this.documentMetadata.get(docUriStr);
            await this.updateTextDocument(document, e.rows, meta);
            await document.save();
          } catch (err: any) {
            webviewPanel.webview.postMessage({
              type: 'error',
              message: '保存失败: ' + (err?.message || err)
            });
          }
          return;
      }
    });

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === docUriStr) updateWebview();
    });

    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) encItem.show();
      else encItem.hide();
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      encItem.dispose();
      cfgSub.dispose();
      // ★ 清理缓存，避免内存泄漏
      this.documentMetadata.delete(docUriStr);
    });
  }

  private async updateTextDocument(
    document: vscode.TextDocument,
    rows: string[][],
    meta?: SlkData
  ): Promise<void> {
    const newContent = stringifySLK(rows, meta);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, fullRange, newContent);
    await vscode.workspace.applyEdit(edit);
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
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}