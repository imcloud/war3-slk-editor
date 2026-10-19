# Changelog

## 1.2.0

### 新增

- 行/列多选：Ctrl+点击加选、Shift+点击连选；单元格 Shift+点击矩形选区
- 行号、列头可点击选中；选中行/列后按 Delete 删除结构
- Backspace 只清空内容，与 Delete 的删行/删列语义分开
- 矩形区域复制 / 剪切 / 粘贴，TSV 与 Excel 双向兼容；粘贴自动扩行扩列
- Ctrl+D 向下填充；整行选中时为复制行
- 撤销 / 重做（Ctrl+Z / Ctrl+Y，最多 60 步）
- 完整键盘导航：方向键、Tab、Enter、F2、直接键入进入编辑、Ctrl+A 全选数据区
- 中英文界面：默认跟随 VS Code 语言，可用 `war3Slk.language` 强制
- 工具栏增加撤销/重做；窄窗口下自动换行
- 右键菜单按选区类型变化（行/列/单元格）

### 变更

- 列宽/行高、过滤、列折叠、首列冻结等既有行为保持不变
- `Ctrl+A` 只选数据行（第 1 行为字段名，不参与全选），避免复制粘贴时多出一行

### 修复

- 移除从未被引用的 `src/webview/slkWebviewHtml.ts`（旧版内联 webview，消息协议与 provider 已不一致，容易误导后续维护）
- `error` 消息现在会在 webview 中显示，并可点击关闭

### 语义

- `src/slkParser.ts` 的解析/序列化逻辑未做任何行为改动
- 新增 `tests/parser-contract.test.js`，对现有输出做逐字节契约测试
