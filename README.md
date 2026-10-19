# War3 SLK Editor

在 VS Code 中像电子表格一样查看和编辑 Warcraft III 的 `.slk` 文件。

适用于 1.29.2 及更早的 MPQ 版本，也适用于从重制版 CASC 中提取出来的 `.slk`——扩展只读取你打开的那个 `.slk` 文件本身，不关心它来自 MPQ 还是 CASC。

## 功能

- 表格化显示 `.slk`，虚拟滚动，大文件也不卡
- 单击选中、双击编辑；直接键入即可开始编辑
- **多选**：按住左键拖动框选矩形区域；Ctrl+点击加选行/列，Shift+点击连选；行号、列头同样可拖动连选
- **Delete 删除选中行/列**，Backspace 只清空内容
- 矩形区域复制 / 剪切 / 粘贴，和 Excel 双向兼容 TSV
- Ctrl+D 向下填充（整行选中时是复制行）
- **撤销 / 重做**（Ctrl+Z / Ctrl+Y，最多 60 步）
- 键盘导航：方向键、Tab、Enter、F2、Ctrl+A
- **中英文界面**：默认跟随 VS Code 显示语言，可用 `war3Slk.language` 强制切换
- 顶部关键词实时过滤
- 列可折叠，首列横向冻结

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 框选矩形区域 | 按住左键拖动 |
| 移动活动单元格 | 方向键（按住 Shift 扩展选区） |
| 编辑当前单元格 | F2、双击、或直接键入 |
| 提交并下移 / 右移 | Enter / Tab |
| 取消编辑 | Esc |
| 删除选中的行/列 | Delete（行/列选择模式下） |
| 清空单元格内容 | Backspace |
| 复制 / 剪切 / 粘贴 | Ctrl+C / Ctrl+X / Ctrl+V |
| 向下填充 | Ctrl+D |
| 全选数据区 | Ctrl+A |
| 撤销 / 重做 | Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z） |
| 保存 | Ctrl+S |

## 多选怎么用

- 点行号（最左侧 `#` 列）选中一行；**Ctrl+点击**其他行号可加选；**Shift+点击**连选一个范围。
- 点列头选中一列；Ctrl / Shift 同理。
- 在数据格上按住左键**拖动**即可框选矩形区域；拖到表格边缘会自动滚动。
- 行号、列头也能按住拖动连选；按住 Ctrl 拖动会在已有选区上追加。
- 选中行/列后按 **Delete** 会删除表格结构；在单元格选区里按 Delete 只清空内容，不会删行删列。
- 整行/整列复制会包含各自的全部数据；`Ctrl+A` 只选数据行，不含第 1 行字段名，避免粘贴回去时多出一行。

## 常见问题：Ctrl+C 再 Ctrl+V，怎么多出了一个 .slk 文件？

这不是扩展在复制文件，而是**焦点**问题：从资源管理器**单击**打开文件时，VS Code 打开的是"预览标签"（标题斜体），键盘焦点还留在资源管理器里。此时 Ctrl+C 复制的是文件本身，Ctrl+V 就在同目录粘贴出一份副本。

1.2.2 起，打开编辑器会自动把焦点移入表格，快捷键立即作用于单元格。也可以点一下表格，或者双击文件打开（非预览标签）。

如果你更习惯打开文件后继续用方向键浏览资源管理器，可以关掉自动聚焦：

```json
"war3Slk.focusOnOpen": false
```

> 顺带说明：标签标题**斜体**表示"预览标签"，**圆点**才表示文件有未保存修改，两者不是一回事。

## 语言

默认 `auto`：VS Code 是中文界面就用中文，否则用英文。也可以在设置里写死：

```json
"war3Slk.language": "en"
```

可选值：`auto` / `zh` / `en`。

## 使用

1. 用 MPQ 工具（如 MPQEditor）从 `War3.mpq` / `War3x.mpq` / `War3Local.mpq` 中提取出 `.slk`
2. 在 VS Code 中打开任意 `.slk` 文件（如 `units/itemdata.slk`）
3. 扩展会自动以表格形式打开
4. 编辑后按 `Ctrl+S` 保存

## ⚠️ 重要提示：SLK 语义可能丢失

**SLK 格式没有统一规范，不同工具产出的文件存在大量变体。**本扩展在编辑和保存时会重新生成文本输出，尽管已尽可能保留原始格式（`F` 记录、`B` 记录、`P`/`O` 记录、换行符、引号等），但**仍无法保证对所有文件做到 100% 语义等价**。

**建议：**

- 编辑前先备份文件，或使用 Git 管理
- 保存后用 `git diff` 检查输出是否符合预期
- 如果发现语义丢失、格式错乱、字段错位等问题，请提交 Issue

> 1.2.x 起，解析/序列化逻辑没有做任何行为改动，并新增 `tests/parser-contract.test.js` 锁定现有输出：以后若有人改动解析器导致语义变化，测试会直接失败。

## 提交问题

GitHub: https://github.com/imcloud/war3-slk-editor

提交时请附上：

- 原始 `.slk` 文件（或可复现问题的最小片段）
- 具体操作步骤
- 保存后的 `git diff`

## 已知限制

- 不支持 SLK 中的公式、样式等非数据字段的编辑
- 无坐标的 `F` 记录（bodyExtra）在保存时会被原样前置到数据行之前，这是既有行为
- 行列操作以第一列值为行标识，第一列重复时可能匹配不精确
- 列宽、行高固定，不支持拖拽自适应

## 开发与测试

```bash
npm install
npm run compile
npm test        # 表格纯函数 + 解析器契约 + provider HTML
npm run package # 生成 .vsix
```

UI 回归：用 Chrome/Edge headless 打开 `tests/webview-harness.html`，页面会输出 20 项交互断言结果。

## English (short)

A spreadsheet-style editor for Warcraft III `.slk` files, for both 1.29.2-era MPQ extractions and Reforged CASC extractions. 1.2.x adds:

- Drag with the left mouse button to select a rectangular range (auto-scrolls at the edges)
- Ctrl/Shift multi-select for rows and columns, plus drag-select on row/column headers
- Delete removes selected rows/columns; Backspace clears contents
- Range copy/cut/paste with Excel-compatible TSV, Ctrl+D fill-down
- Undo/redo (60 steps) and full keyboard navigation
- English UI following VS Code's display language (override with `war3Slk.language`)

## License

MIT
