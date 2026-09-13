export interface SlkData {
  maxRow: number;
  maxCol: number;
  grid: string[][];
}

/**
 * 状态机解析单行 SLK 字符串，正确处理双引号内部包含的分号
 */
function parseSlkLine(line: string): { type: string; params: Map<string, string> } {
  const firstSemi = line.indexOf(';');
  if (firstSemi === -1) {
    return { type: line.trim(), params: new Map() };
  }
  const type = line.substring(0, firstSemi).trim();
  const rest = line.substring(firstSemi + 1);

  const params = new Map<string, string>();
  let i = 0;
  while (i < rest.length) {
    const key = rest[i];
    i++;
    let val = '';
    if (i < rest.length && rest[i] === '"') {
      i++; // 跳过起始双引号
      while (i < rest.length) {
        if (rest[i] === '"') {
          if (i + 1 < rest.length && rest[i + 1] === '"') {
            val += '"';
            i += 2; // 处理转义双引号 ""
          } else {
            i++; // 结束双引号
            break;
          }
        } else {
          val += rest[i];
          i++;
        }
      }
    } else {
      const start = i;
      while (i < rest.length && rest[i] !== ';') {
        i++;
      }
      val = rest.substring(start, i);
    }
    params.set(key, val);
    if (i < rest.length && rest[i] === ';') {
      i++;
    }
  }
  return { type, params };
}

/**
 * 解析 SLK 内容为二维数组
 */
export function parseSLK(content: string): SlkData {
  const lines = content.split(/\r?\n/);
  let currentY = 1;
  let currentX = 1;
  let maxRow = 0;
  let maxCol = 0;

  const cellMap = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // C; F; B; 记录均可能更新当前坐标 Y 和 X
    if (trimmed.startsWith('C;') || trimmed.startsWith('F;') || trimmed.startsWith('B;')) {
      const { type, params } = parseSlkLine(trimmed);

      if (params.has('Y')) {
        currentY = parseInt(params.get('Y')!, 10);
      }
      if (params.has('X')) {
        currentX = parseInt(params.get('X')!, 10);
      }

      if (type === 'C' && params.has('K')) {
        const val = params.get('K')!;
        cellMap.set(`${currentY},${currentX}`, val);
        if (currentY > maxRow) maxRow = currentY;
        if (currentX > maxCol) maxCol = currentX;
      }
    }
  }

  const grid: string[][] = [];
  for (let r = 0; r < maxRow; r++) {
    const row: string[] = [];
    for (let c = 0; c < maxCol; c++) {
      row.push(cellMap.get(`${r + 1},${c + 1}`) ?? '');
    }
    grid.push(row);
  }

  return { maxRow, maxCol, grid };
}

/**
 * 序列化二维数组回写为 SLK
 */
export function stringifySLK(grid: string[][]): string {
  const maxRow = grid.length;
  let maxCol = 0;
  for (let r = 0; r < maxRow; r++) {
    if (grid[r].length > maxCol) {
      maxCol = grid[r].length;
    }
  }

  const lines: string[] = [];
  lines.push('ID;PWXL;N;E');
  lines.push(`B;Y${maxRow};X${maxCol};D0 0 ${Math.max(0, maxRow - 1)} ${Math.max(0, maxCol - 1)}`);

  for (let r = 0; r < maxRow; r++) {
    const rowY = r + 1;
    let firstInRow = true;

    for (let c = 0; c < maxCol; c++) {
      const colX = c + 1;
      const val = grid[r][c];
      if (val === undefined || val === '') continue;

      let formattedValue: string;
      if (/^-?\d+(\.\d+)?$/.test(val)) {
        formattedValue = `K${val}`;
      } else {
        formattedValue = `K"${val.replace(/"/g, '""')}"`;
      }

      if (firstInRow) {
        lines.push(`C;Y${rowY};X${colX};${formattedValue}`);
        firstInRow = false;
      } else {
        lines.push(`C;X${colX};${formattedValue}`);
      }
    }
  }

  lines.push('E');
  return lines.join('\r\n');
}