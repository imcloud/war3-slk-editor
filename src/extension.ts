import * as vscode from 'vscode';
import { SlkEditorProvider } from './slkEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('>>> 魔兽争霸3 SLK 编辑器插件已被激活！');
  context.subscriptions.push(SlkEditorProvider.register(context));
}

export function deactivate() {}