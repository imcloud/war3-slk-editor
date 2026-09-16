# Warcraft III SLK Editor

[![VS Code Extension](https://img.shields.io/badge/VS%20Code-v1.75.0%2B-blue.svg)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](package.json)

**Warcraft III SLK Editor** 是一款专为魔兽争霸 III（War3）地图开发者打造的 VS Code 可视化 `.slk` 数据表格编辑器。

告别繁琐的 Excel 频繁切换与文本格式对齐难题，直接在 VS Code 内以高性能表格形式轻松预览、搜索、修改和维护你的地图 `.slk` 数据文件！

---

## ✨ 核心特性

- 📊 **原生可视化表格编辑**：直接以电子表格样式呈现 `.slk` 文件，支持实时单元格修改与自动格式解析。
- 🔍 **实时搜索与筛选**：支持按单位/技能/物品 ID、别名或任意数值快速检索，大数据量精准定位。
- 📄 **高性能分页渲染**：内置分页机制（支持 30 / 50 / 100 / 200 行/页），轻松应对上千行的大型 SLK 数据文件。
- 🖱️ **原生右键快捷操作**：
  - 📋 **向下克隆当前行**：快速复用现有物品/技能/单位配置模板。
  - 🗑️ **删除当前行**：一键移除无效数据。
- ➕ **灵活行列扩展**：支持一键在底部添加空行或新增数据列。
- ↩️ **完美集成撤销恢复**：与 VS Code 文档系统深度绑定，随时通过 `Ctrl + Z`（Mac: `Cmd + Z`）/ `Ctrl + Y` 撤销与重做编辑。
- 🎨 **主题无缝适配**：自适应 VS Code 暗黑/浅色等全系内置主题，视觉体验天然一致。

---

## 🛠️ 本地编译与打包

如果你希望自行修改源码或离线打包使用：

### 环境准备
- [Node.js](https://nodejs.org/) (v16+)
- [VS Code](https://code.visualstudio.com/) (v1.75.0+)

### 1. 克隆仓库与安装依赖
```bash
git clone [https://github.com/sean/war3-slk-editor.git](https://github.com/sean/war3-slk-editor.git)
cd war3-slk-editor
npm install
