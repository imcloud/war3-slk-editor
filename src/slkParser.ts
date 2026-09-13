export interface SlkData {
  grid: string[][];
}

/**
 * 带有双引号状态机的 SLK 行 Token 切分器
 * 保证字符串内部的分号 `;` 不会被误切分
 */
function parseSlkLineTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ';' && !inQuotes) {
      tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * 解析 SLK 文本内容，保持 100% 原始字符串，避免精度丢失与数据截断
 */
export function parseSLK(text: string): SlkData {
  const lines = text.split(/\r?\n/);
  let curX = 1;
  let curY = 1;
  let maxRow = 0;
  let maxCol = 0;

  const cellMap = new Map<string, string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('E')) continue;

    const tokens = parseSlkLineTokens(line);
    if (tokens.length === 0) continue;

    const recordType = tokens[0].trim();

    if (recordType === 'C') {
      let lineX = curX;
      let lineY = curY;
      let hasK = false;
      let rawKValue = '';

      // 第一遍遍历：先提取出该行所有的坐标与 K 值（防止 K 出现在 X/Y 前面导致的错位）
      for (let t = 1; t < tokens.length; t++) {
        const token = tokens[t];
        if (token.startsWith('X')) {
          const parsedX = parseInt(token.substring(1), 10);
          if (!isNaN(parsedX)) {
            lineX = parsedX;
            curX = parsedX;
          }
        } else if (token.startsWith('Y')) {
          const parsedY = parseInt(token.substring(1), 10);
          if (!isNaN(parsedY)) {
            lineY = parsedY;
            curY = parsedY;
          }
        } else if (token.startsWith('K')) {
          hasK = true;
          rawKValue = token.substring(1);
        }
      }

      if (hasK) {
        let value = rawKValue;
        // 处理双引号包裹的字符串 K"value" -> value
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1).replace(/""/g, '"');
        }
        cellMap.set(`${lineY}_${lineX}`, value);
        if (lineY > maxRow) maxRow = lineY;
        if (lineX > maxCol) maxCol = lineX;
      }
    } else if (recordType === 'B') {
      for (let t = 1; t < tokens.length; t++) {
        const token = tokens[t];
        if (token.startsWith('Y')) {
          const y = parseInt(token.substring(1), 10);
          if (!isNaN(y) && y > maxRow) maxRow = y;
        } else if (token.startsWith('X')) {
          const x = parseInt(token.substring(1), 10);
          if (!isNaN(x) && x > maxCol) maxCol = x;
        }
      }
    }
  }

  // 重构 2D 数组 (0-based)
  const grid: string[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const row: string[] = [];
    for (let c = 1; c <= maxCol; c++) {
      row.push(cellMap.get(`${r}_${c}`) ?? '');
    }
    grid.push(row);
  }

  return { grid };
}

/**
 * 将 2D 矩阵生成标准的 SLK 文本
 */
export function stringifySLK(grid: string[][]): string {
  const rowCount = grid.length;
  if (rowCount === 0) {
    return 'ID;PWXL;N;E\r\nB;Y0;X0\r\nE\r\n';
  }

  let maxColCount = 0;
  for (let r = 0; r < rowCount; r++) {
    if (grid[r] && grid[r].length > maxColCount) {
      maxColCount = grid[r].length;
    }
  }

  const lines: string[] = [];
  lines.push('ID;PWXL;N;E');
  lines.push(`B;Y${rowCount};X${maxColCount}`);

  for (let r = 0; r < rowCount; r++) {
    const row = grid[r];
    if (!row) continue;
    const rowIdx = r + 1;
    for (let c = 0; c < maxColCount; c++) {
      const val = row[c];
      if (val !== undefined && val !== null && val !== '') {
        const colIdx = c + 1;
        // 校验是否为纯数字或科学计数法格式 (如 1.393796E+42 / -100 / 0.5)
        const isNumeric = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val);
        const formattedVal = isNumeric ? val : `"${val.replace(/"/g, '""')}"`;
        lines.push(`C;X${colIdx};Y${rowIdx};K${formattedVal}`);
      }
    }
  }

  lines.push('E');
  return lines.join('\r\n') + '\r\n';
}