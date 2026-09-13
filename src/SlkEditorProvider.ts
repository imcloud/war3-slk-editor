import * as vscode from 'vscode';
import { parseSLK, stringifySLK } from './slkParser';
import { getHtmlForWebview } from './webview/slkWebviewHtml';

export class SlkEditorProvider implements vscode.CustomTextEditorProvider {
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
    let isUpdatingFromWebview = false;
    let currentGrid: string[][] = [];
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = getHtmlForWebview();

    const queueSave = () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        if (!currentGrid) return;
        const newSlkText = stringifySLK(currentGrid);
        isUpdatingFromWebview = true;
        try {
          await this.updateTextDocument(document, newSlkText);
        } finally {
          // 安全锁延迟 150ms 释放，彻底屏蔽保存引起的异步 onDidChangeTextDocument 事件
          setTimeout(() => {
            isUpdatingFromWebview = false;
          }, 150);
        }
      }, 300);
    };

    const updateWebview = () => {
      if (isUpdatingFromWebview) return;

      const text = document.getText();
      const slkData = parseSLK(text);
      currentGrid = slkData.grid;

      webviewPanel.webview.postMessage({
        type: 'update',
        grid: currentGrid,
      });
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      if (saveTimeout) clearTimeout(saveTimeout);
    });

    webviewPanel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'updateCell') {
        const { row, col, value } = message;
        if (currentGrid && currentGrid[row]) {
          currentGrid[row][col] = String(value ?? '');
          queueSave();
        }
      } else if (message.type === 'saveGrid') {
        currentGrid = message.grid || [];
        queueSave();
      }
    });

    updateWebview();
  }

  private updateTextDocument(document: vscode.TextDocument, newText: string) {
    const edit = new vscode.WorkspaceEdit();
    // 使用精准的全文范围替换，防止 Range 越界
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, fullRange, newText);
    return vscode.workspace.applyEdit(edit);
  }
}