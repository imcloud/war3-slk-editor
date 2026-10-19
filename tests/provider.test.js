// 校验 provider 生成的 webview HTML：CSP、脚本顺序、i18n 注入、按钮文案
const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
let language = 'en';
let configLanguage = 'auto';

const vscodeStub = {
  workspace: {
    getConfiguration: () => ({ get: (key, def) => def }),
  },
  env: {
    get language() { return language; },
  },
  Uri: {
    joinPath: (base, ...parts) => ({ path: parts.join('/'), toString: () => parts.join('/') }),
  },
  window: {},
  StatusBarAlignment: { Right: 2 },
};

Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const { SlkEditorProvider } = require('../out/slkEditorProvider');
const i18n = require('../out/i18n');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

const webview = {
  cspSource: 'vscode-webview://nonce',
  asWebviewUri: (uri) => 'vscode-webview-resource://' + uri.path,
};

function makeHtml(locale) {
  const provider = new SlkEditorProvider({ extensionUri: { path: 'ext' } });
  return provider.getHtmlForWebview(webview, i18n.getStrings(locale), locale);
}

test('英文界面包含英文按钮与提示', () => {
  const html = makeHtml('en');
  assert.ok(html.includes('Insert Row'));
  assert.ok(html.includes('Delete Col'));
  assert.ok(html.includes('Filter rows by keyword'));
  assert.ok(html.includes('lang="en"'));
});

test('中文界面包含原有中文文案', () => {
  const html = makeHtml('zh');
  assert.ok(html.includes('插入行'));
  assert.ok(html.includes('删除列'));
  assert.ok(html.includes('实时过滤'));
  assert.ok(html.includes('lang="zh-CN"'));
});

test('i18n 表完整注入且不会闭合 script 标签', () => {
  const html = makeHtml('en');
  assert.ok(html.includes('window.__SLK_I18N__='));
  assert.ok(html.includes('"toolbar.insertRow":"Insert Row"'));
  assert.ok(!html.includes('</script></script>'));
  const jsonPart = html.split('window.__SLK_I18N__=')[1].split(';</script>')[0];
  const parsed = JSON.parse(jsonPart);
  assert.strictEqual(parsed['menu.copy'], 'Copy');
});

test('脚本顺序：gridOps 在 editor 之前', () => {
  const html = makeHtml('en');
  const opsAt = html.indexOf('gridOps.js');
  const editorAt = html.indexOf('editor.js');
  assert.ok(opsAt > 0 && editorAt > opsAt, 'ops=' + opsAt + ' editor=' + editorAt);
});

test('CSP 只允许带 nonce 的脚本', () => {
  const html = makeHtml('en');
  assert.ok(html.includes("script-src 'nonce-"));
  const nonceMatch = html.match(/script-src 'nonce-([A-Za-z0-9]{32})'/);
  assert.ok(!!nonceMatch, 'nonce not found');
  const nonce = nonceMatch[1];
  assert.ok(html.includes('<script nonce="' + nonce + '" src='));
});

test('语言配置 auto 时跟随 VS Code 语言（zh-cn）', () => {
  language = 'zh-cn';
  configLanguage = 'auto';
  vscodeStub.workspace.getConfiguration = () => ({ get: (key, def) => (key === 'language' ? configLanguage : def) });
  assert.strictEqual(i18n.resolveLocale(), 'zh');
});

test('语言配置 en 时强制英文', () => {
  language = 'zh-cn';
  configLanguage = 'en';
  vscodeStub.workspace.getConfiguration = () => ({ get: (key, def) => (key === 'language' ? configLanguage : def) });
  assert.strictEqual(i18n.resolveLocale(), 'en');
});

test('中文语言配置 zh 时强制中文', () => {
  language = 'en';
  configLanguage = 'zh';
  vscodeStub.workspace.getConfiguration = () => ({ get: (key, def) => (key === 'language' ? configLanguage : def) });
  assert.strictEqual(i18n.resolveLocale(), 'zh');
});

test('format 插值缺失参数时保留占位符', () => {
  assert.strictEqual(i18n.format('行 {r} 列 {c}', { r: 3 }), '行 3 列 {c}');
});

console.log('\n' + passed + ' passed');
