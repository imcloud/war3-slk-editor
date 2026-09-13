import * as vscode from 'vscode';
import { SlkEditorProvider } from './SlkEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(SlkEditorProvider.register(context));
}

export function deactivate() {}