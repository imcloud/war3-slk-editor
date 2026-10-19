import * as vscode from 'vscode';

export type Locale = 'zh' | 'en';

export interface StringTable {
  [key: string]: string;
}

const zh: StringTable = {
  // 工具栏
  'toolbar.insertRow': '插入行',
  'toolbar.appendRow': '追加行',
  'toolbar.duplicateRow': '复制行',
  'toolbar.deleteRow': '删除行',
  'toolbar.insertCol': '插入列',
  'toolbar.appendCol': '追加列',
  'toolbar.deleteCol': '删除列',
  'toolbar.undo': '↶',
  'toolbar.redo': '↷',
  'toolbar.undoTitle': '撤销 (Ctrl+Z)',
  'toolbar.redoTitle': '重做 (Ctrl+Y)',
  'toolbar.insertRowTitle': '在选中行下方插入空白行',
  'toolbar.appendRowTitle': '追加空白行到最后',
  'toolbar.duplicateRowTitle': '复制选中行并向下插入',
  'toolbar.deleteRowTitle': '删除选中行（Delete）',
  'toolbar.insertColTitle': '在选中列右侧插入空白列',
  'toolbar.appendColTitle': '追加空白列到最后',
  'toolbar.deleteColTitle': '删除选中列（Delete）',
  'toolbar.searchPlaceholder': '输入关键词实时过滤行...',

  // 列名/信息栏
  'col.defaultName': '第 {n} 列',
  'info.position': '位置: 行 {r}, 列 {c} ({field})',
  'info.total': '共 {total} 行 (过滤 {filtered}) | {cols} 列',
  'info.selRows': '已选 {n} 行',
  'info.selCols': '已选 {n} 列',
  'info.selCells': '已选 {rows}×{cols} 格',

  // 右键菜单
  'menu.copy': '复制',
  'menu.cut': '剪切',
  'menu.paste': '粘贴',
  'menu.clear': '清空内容',
  'menu.insertRow': '在下方插入空行',
  'menu.insertCol': '在右侧插入空列',
  'menu.duplicateRow': '向下复制行',
  'menu.deleteRows': '删除选中行',
  'menu.deleteCols': '删除选中列',
  'menu.selectAll': '全选',

  // 错误/状态
  'error.script': '[JS 致命报错] {message}',
  'error.parse': 'SLK 解析异常: {message}',
  'error.apply': '应用修改失败: {message}',
  'error.save': '保存失败: {message}',
  'status.encodingTip': '保存时使用编码：{encoding}',
  'status.saved': '已保存',
};

const en: StringTable = {
  'toolbar.insertRow': 'Insert Row',
  'toolbar.appendRow': 'Append Row',
  'toolbar.duplicateRow': 'Duplicate Row',
  'toolbar.deleteRow': 'Delete Row',
  'toolbar.insertCol': 'Insert Col',
  'toolbar.appendCol': 'Append Col',
  'toolbar.deleteCol': 'Delete Col',
  'toolbar.undo': '↶',
  'toolbar.redo': '↷',
  'toolbar.undoTitle': 'Undo (Ctrl+Z)',
  'toolbar.redoTitle': 'Redo (Ctrl+Y)',
  'toolbar.insertRowTitle': 'Insert a blank row below the selected row',
  'toolbar.appendRowTitle': 'Append a blank row at the end',
  'toolbar.duplicateRowTitle': 'Duplicate the selected row below',
  'toolbar.deleteRowTitle': 'Delete selected rows (Delete)',
  'toolbar.insertColTitle': 'Insert a blank column to the right',
  'toolbar.appendColTitle': 'Append a blank column at the end',
  'toolbar.deleteColTitle': 'Delete selected columns (Delete)',
  'toolbar.searchPlaceholder': 'Filter rows by keyword...',

  'col.defaultName': 'Column {n}',
  'info.position': 'Position: row {r}, col {c} ({field})',
  'info.total': '{total} rows (filtered {filtered}) | {cols} cols',
  'info.selRows': '{n} row(s) selected',
  'info.selCols': '{n} column(s) selected',
  'info.selCells': '{rows}×{cols} cell(s) selected',

  'menu.copy': 'Copy',
  'menu.cut': 'Cut',
  'menu.paste': 'Paste',
  'menu.clear': 'Clear Contents',
  'menu.insertRow': 'Insert Row Below',
  'menu.insertCol': 'Insert Column Right',
  'menu.duplicateRow': 'Duplicate Row',
  'menu.deleteRows': 'Delete Selected Rows',
  'menu.deleteCols': 'Delete Selected Columns',
  'menu.selectAll': 'Select All',

  'error.script': '[JS error] {message}',
  'error.parse': 'SLK parse error: {message}',
  'error.apply': 'Failed to apply changes: {message}',
  'error.save': 'Failed to save: {message}',
  'status.encodingTip': 'Encoding used on save: {encoding}',
  'status.saved': 'Saved',
};

export function resolveLocale(): Locale {
  const configured = vscode.workspace
    .getConfiguration('war3Slk')
    .get<string>('language', 'auto');

  if (configured === 'zh' || configured === 'en') return configured;

  const lang = (vscode.env.language || 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export function getStrings(locale: Locale): StringTable {
  return locale === 'en' ? en : zh;
}

/** 供 webview 使用的插值，键缺失时原样返回键名，方便发现漏译 */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    const v = params[key];
    return v === undefined ? m : String(v);
  });
}
