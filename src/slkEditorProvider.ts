import * as vscode from 'vscode';
import { parseSLK, stringifySLK, SlkData } from './slkParser';
import { getStrings, resolveLocale, format, Locale, StringTable } from './i18n';

export class SlkEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'war3.slkEditor';

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
    const locale = resolveLocale();
    const s = getStrings(locale);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, s, locale);

    let suppressDocChangeUntil = 0;

    const encItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    const updateEncodingItem = () => {
      const enc = vscode.workspace
        .getConfiguration('files', document.uri)
        .get<string>('encoding') || 'utf8';
      encItem.text = `$(file-code) ${enc.toUpperCase()}`;
      encItem.tooltip = format(s['status.encodingTip'], { encoding: enc });
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
        this.documentMetadata.set(docUriStr, slkData);
        webviewPanel.webview.postMessage({ type: 'load', data: slkData });
      } catch (err: any) {
        webviewPanel.webview.postMessage({
          type: 'error',
          message: format(s['error.parse'], { message: err?.message || err })
        });
      }
    };

    webviewPanel.webview.onDidReceiveMessage(async e => {
      switch (e.type) {
        case 'ready':
          updateWebview();
          return;

        case 'contentChanged':
          suppressDocChangeUntil = Date.now() + 500;
          try {
            const meta = this.documentMetadata.get(docUriStr);
            // ★ 透传 rowOrigIdx；不重新 parse（保留语义基准）
            await this.updateTextDocument(document, e.rows, meta, e.rowOrigIdx);
          } catch (err: any) {
            webviewPanel.webview.postMessage({
              type: 'error',
              message: format(s['error.apply'], { message: err?.message || err })
            });
          }
          return;

        case 'save':
          suppressDocChangeUntil = Date.now() + 500;
          try {
            const meta = this.documentMetadata.get(docUriStr);
            await this.updateTextDocument(document, e.rows, meta, e.rowOrigIdx);
            await document.save();
          } catch (err: any) {
            webviewPanel.webview.postMessage({
              type: 'error',
              message: format(s['error.save'], { message: err?.message || err })
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
      this.documentMetadata.delete(docUriStr);
    });
  }

  private async updateTextDocument(
    document: vscode.TextDocument,
    rows: string[][],
    meta?: SlkData,
    rowOrigIdx?: number[]
  ): Promise<void> {
    const newContent = stringifySLK(rows, meta, rowOrigIdx);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, fullRange, newContent);
    await vscode.workspace.applyEdit(edit);
  }

  private getHtmlForWebview(webview: vscode.Webview, s: StringTable, locale: Locale): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js')
    );
    const opsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'gridOps.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css')
    );
    const nonce = getNonce();
    const esc = escapeHtml;
    // 序列化给 webview 的文案表；转义 < 避免提前闭合 script 标签
    const i18nJson = JSON.stringify(s).replace(/</g, '\\u003c');

    const btn = (id: string, labelKey: string, titleKey: string) =>
      `<button id="${id}" title="${esc(s[titleKey])}">${esc(s[labelKey])}</button>`;

    return /* html */`
      <!DOCTYPE html>
      <html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet" />
      </head>
      <body>
        <div id="toolbar">
          ${btn('undo', 'toolbar.undo', 'toolbar.undoTitle')}
          ${btn('redo', 'toolbar.redo', 'toolbar.redoTitle')}
          ${btn('add-row', 'toolbar.insertRow', 'toolbar.insertRowTitle')}
          ${btn('add-row-end', 'toolbar.appendRow', 'toolbar.appendRowTitle')}
          ${btn('dup-row', 'toolbar.duplicateRow', 'toolbar.duplicateRowTitle')}
          ${btn('del-row', 'toolbar.deleteRow', 'toolbar.deleteRowTitle')}
          ${btn('add-col', 'toolbar.insertCol', 'toolbar.insertColTitle')}
          ${btn('add-col-end', 'toolbar.appendCol', 'toolbar.appendColTitle')}
          ${btn('del-col', 'toolbar.deleteCol', 'toolbar.deleteColTitle')}

          <div style="display:inline-flex; align-items:center; margin-left:10px; gap:4px;">
            <input type="text" id="search-input" placeholder="${esc(s['toolbar.searchPlaceholder'])}" style="width:160px;" />
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

        <script nonce="${nonce}">window.__SLK_LANG__=${JSON.stringify(locale)};window.__SLK_I18N__=${i18nJson};</script>
        <script nonce="${nonce}" src="${opsUri}"></script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}

function escapeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
