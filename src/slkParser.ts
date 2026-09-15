export interface SlkCellMeta {
  hasF: boolean;
  fHasY: boolean;
  fHasX: boolean;
  fExtra: string;

  hasC: boolean;
  cHasY: boolean;
  cHasX: boolean;
  cExtra: string;

  rawK?: string;
  semantic?: string;
}

export interface SlkData {
  rows: string[][];
  maxCols: number;
  maxRows: number;
  cellMap?: Map<string, SlkCellMeta>;
  headerLines?: string[];
  bRecord?: string;
  tailLines?: string[];
  bodyExtraLines?: string[];   // 新增：body 阶段出现的 P/O 等非 F/C 记录
  eol?: '\r\n' | '\n';
  finalNewline?: boolean;
  originalContent?: string;    // 新增：原始文本，用于零编辑快速返回
}

function parseSlkLineFields(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
    } else if (char === ';' && !inQuote) {
      tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  tokens.push(current);
  return tokens;
}

export function parseSLK(content: string): SlkData {
  const grid: string[][] = [];
  const cellMap = new Map<string, SlkCellMeta>();
  const headerLines: string[] = [];
  const tailLines: string[] = [];
  const bodyExtraLines: string[] = [];
  let bRecord = '';

  let curX = 1;
  let curY = 1;
  let maxCols = 0;

  const eol: '\r\n' | '\n' = content.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const finalNewline = content.endsWith('\n');

  let phase: 'header' | 'body' | 'tail' = 'header';
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 头部区
    if (phase === 'header') {
      if (trimmed.startsWith('C;') || trimmed.startsWith('F;')) {
        phase = 'body';
      } else if (trimmed.startsWith('B;')) {
        bRecord = line;
        continue;
      } else if (trimmed === 'E' || trimmed.startsWith('E;')) {
        phase = 'tail';
        tailLines.push(line);
        continue;
      } else {
        headerLines.push(line);
        continue;
      }
    }

    // 尾部区
    if (phase === 'tail') {
      if (i === lines.length - 1 && line === '') continue;
      tailLines.push(line);
      continue;
    }

    // 主体区
    if (phase === 'body') {
      if (trimmed === 'E' || trimmed.startsWith('E;')) {
        phase = 'tail';
        tailLines.push(line);
        continue;
      }

      if (trimmed.startsWith('F;') || trimmed.startsWith('C;')) {
        const tokens = parseSlkLineFields(trimmed);
        const recType = tokens[0];

        let recordY: number | null = null;
        let recordX: number | null = null;
        let yTag = false;
        let xTag = false;
        let kStr = '';
        const extraFields: string[] = [];

        for (let j = 1; j < tokens.length; j++) {
          const token = tokens[j];
          if (!token) continue;
          const tag = token[0];

          if (tag === 'Y') {
            recordY = parseInt(token.substring(1), 10);
            yTag = true;
          } else if (tag === 'X') {
            recordX = parseInt(token.substring(1), 10);
            xTag = true;
          } else if (tag === 'K' && recType === 'C') {
            kStr = token.substring(1);
          } else {
            extraFields.push(token);
          }
        }

        if (recordY !== null) {
          curY = recordY;
          curX = recordX !== null ? recordX : 1;
        } else if (recordX !== null) {
          curX = recordX;
        }
        if (curY < 1) curY = 1;
        if (curX < 1) curX = 1;

        const cellKey = `${curY - 1}_${curX - 1}`;
        let meta = cellMap.get(cellKey);
        if (!meta) {
          meta = {
            hasF: false, fHasY: false, fHasX: false, fExtra: '',
            hasC: false, cHasY: false, cHasX: false, cExtra: '',
          };
        }

        const extraStr = extraFields.length > 0 ? ';' + extraFields.join(';') : '';

        if (recType === 'F') {
          meta.hasF = true;
          meta.fHasY = yTag;
          meta.fHasX = xTag;
          meta.fExtra = extraStr;
          if (curX > maxCols) maxCols = curX;
        } else if (recType === 'C') {
          meta.hasC = true;
          meta.cHasY = yTag;
          meta.cHasX = xTag;
          meta.cExtra = extraStr;

          if (kStr !== '') {
            meta.rawK = kStr;
            if (kStr.startsWith('"') && kStr.endsWith('"') && kStr.length >= 2) {
              meta.semantic = kStr.slice(1, -1).replace(/""/g, '"');
            } else {
              meta.semantic = kStr;
            }
            while (grid.length < curY) grid.push([]);
            while (grid[curY - 1].length < curX) grid[curY - 1].push('');
            grid[curY - 1][curX - 1] = meta.semantic;
            if (curX > maxCols) maxCols = curX;
          }
        }

        cellMap.set(cellKey, meta);
      } else {
        // ★ 修复：body 阶段的非 F/C/E 行（P、O、空行、注释等）保留
        bodyExtraLines.push(line);
      }
    }
  }

  for (let r = 0; r < grid.length; r++) {
    if (!grid[r]) grid[r] = [];
    while (grid[r].length < maxCols) grid[r].push('');
  }

  return {
    rows: grid,
    maxCols: maxCols || 1,
    maxRows: grid.length,
    cellMap,
    headerLines,
    bRecord,
    tailLines,
    bodyExtraLines,
    eol,
    finalNewline,
    originalContent: content,
  };
}

/**
 * 判断当前 rows 与原始解析结果是否语义一致（无编辑）
 */
function isUnchanged(rows: string[][], meta: SlkData): boolean {
  const orig = meta.rows;
  if (rows.length !== orig.length) return false;
  for (let y = 0; y < orig.length; y++) {
    const a = orig[y] || [];
    const b = rows[y] || [];
    const len = Math.max(a.length, b.length);
    for (let x = 0; x < len; x++) {
      const va = a[x] ?? '';
      const vb = b[x] ?? '';
      if (va !== vb) return false;
    }
  }
  return true;
}

export function stringifySLK(rows: string[][], meta?: SlkData): string {
  // ★ 零编辑快速路径：字节级原样返回
  if (meta?.originalContent !== undefined && isUnchanged(rows, meta)) {
    return meta.originalContent;
  }

  const lines: string[] = [];
  const maxRows = rows.length;
  let maxCols = 0;
  for (const r of rows) {
    if (r && r.length > maxCols) maxCols = r.length;
  }

  const origMaxRows = meta?.maxRows ?? maxRows;
  const origMaxCols = meta?.maxCols ?? maxCols;
  const structureChanged = (maxRows !== origMaxRows) || (maxCols !== origMaxCols);

  // 1. 头部
  if (meta?.headerLines) {
    lines.push(...meta.headerLines);
  } else {
    lines.push('ID;PWXL;N;E');
  }

  // 2. B 记录
  if (meta?.bRecord) {
    let newB = meta.bRecord;
    if (/Y\d+/.test(newB)) newB = newB.replace(/Y\d+/, `Y${maxRows}`);
    else newB += `;Y${maxRows}`;
    if (/X\d+/.test(newB)) newB = newB.replace(/X\d+/, `X${maxCols}`);
    else newB += `;X${maxCols}`;
    lines.push(newB);
  } else {
    lines.push(`B;Y${maxRows};X${maxCols};D0`);
  }

  // ★ 3. body 阶段的 P/O 记录（保留，放在数据之前）
  if (meta?.bodyExtraLines && meta.bodyExtraLines.length > 0) {
    lines.push(...meta.bodyExtraLines);
  }

  // 4. 数据体
  let currentY = 1;
  let currentX = 1;

  for (let y = 0; y < maxRows; y++) {
    const row = rows[y];
    if (!row) continue;

    for (let x = 0; x < maxCols; x++) {
      const val = row[x];
      const isEmpty = (val === undefined || val === null || val === '');
      const cellMeta = meta?.cellMap?.get(`${y}_${x}`);

      if (isEmpty && !cellMeta) continue;
      if (isEmpty && cellMeta && !cellMeta.hasF) continue;

      const tgtY = y + 1;
      const tgtX = x + 1;

      if (cellMeta?.hasF) {
        let out = 'F';
        const needY = cellMeta.fHasY || (structureChanged && currentY !== tgtY);
        if (needY) {
          out += `;Y${tgtY}`;
          currentY = tgtY;
          currentX = 1;
        }
        const needX = cellMeta.fHasX || (structureChanged && currentX !== tgtX);
        if (needX) {
          out += `;X${tgtX}`;
          currentX = tgtX;
        }
        out += cellMeta.fExtra;
        lines.push(out);
      }

      if (!isEmpty) {
        let out = 'C';
        const isNewCell = !cellMeta || (!cellMeta.hasF && !cellMeta.hasC);
        const allowStateMachine = structureChanged || isNewCell;

        const cHasY = cellMeta?.cHasY ?? false;
        const cHasX = cellMeta?.cHasX ?? false;

        const needY = cHasY || (allowStateMachine && currentY !== tgtY);
        if (needY) {
          out += `;Y${tgtY}`;
          currentY = tgtY;
          currentX = 1;
        }
        const needX = cHasX || (allowStateMachine && currentX !== tgtX);
        if (needX) {
          out += `;X${tgtX}`;
          currentX = tgtX;
        }

        let formattedVal: string;
        if (cellMeta && cellMeta.semantic === val && cellMeta.rawK) {
          formattedVal = cellMeta.rawK;
        } else {
          formattedVal = /^-?\d+(\.\d+)?$/.test(val)
            ? val
            : `"${val.replace(/"/g, '""')}"`;
        }

        const cExtra = cellMeta?.cExtra || '';
        out += `;K${formattedVal}${cExtra}`;
        lines.push(out);
      }
    }
  }

  // 5. 尾部
  if (meta?.tailLines && meta.tailLines.length > 0) {
    lines.push(...meta.tailLines);
  } else {
    lines.push('E');
  }

  const eol = meta?.eol ?? '\r\n';
  const finalNewline = meta?.finalNewline ?? true;
  const text = lines.join(eol);
  return finalNewline ? text + eol : text;
}