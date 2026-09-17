export interface SlkCellMeta {
  hasF: boolean;
  fHasY: boolean;
  fHasX: boolean;
  fExtra: string;
  fOrigY?: number;
  fOrigX?: number;
  rawF?: string;

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
  bodyExtraLines?: string[];
  eol?: '\r\n' | '\n';
  finalNewline?: boolean;
  originalContent?: string;
  rowIndexByFirstCol?: Map<string, number[]>;
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

  let pendingF: { rawF: string; yTag: boolean; xTag: boolean; extra: string } | null = null;
  let phase: 'header' | 'body' | 'tail' = 'header';
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (phase === 'header') {
      if (trimmed.startsWith('C;')) {
        phase = 'body';
      } else if (trimmed.startsWith('F;')) {
        const tokens = parseSlkLineFields(trimmed);
        let hasCoord = false;
        for (let j = 1; j < tokens.length; j++) {
          const t = tokens[j];
          if (!t) continue;
          if (t[0] === 'X' || t[0] === 'Y') { hasCoord = true; break; }
        }
        if (hasCoord) {
          phase = 'body';
        } else {
          headerLines.push(line);
          continue;
        }
      } else if (trimmed === 'E' || trimmed.startsWith('E;')) {
        phase = 'tail';
        tailLines.push(line);
        continue;
      } else {
        headerLines.push(line);
        continue;
      }
    }

    if (phase === 'tail') {
      if (i === lines.length - 1 && line === '') continue;
      tailLines.push(line);
      continue;
    }

    if (phase === 'body') {
      if (trimmed === 'E' || trimmed.startsWith('E;')) {
        phase = 'tail';
        tailLines.push(line);
        continue;
      }

      if (trimmed.startsWith('F;') || trimmed.startsWith('C;')) {
        const tokens = parseSlkLineFields(trimmed);
        const recType = tokens[0];

        if (recType === 'F') {
          let hasXY = false;
          for (let j = 1; j < tokens.length; j++) {
            const t = tokens[j];
            if (!t) continue;
            if (t[0] === 'X' || t[0] === 'Y') { hasXY = true; break; }
          }
          if (!hasXY) {
            bodyExtraLines.push(line);
            continue;
          }
        }

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
          pendingF = { rawF: trimmed, yTag, xTag, extra: extraStr };
        } else if (recType === 'C') {
          if (pendingF) {
            meta.hasF = true;
            meta.fHasY = pendingF.yTag;
            meta.fHasX = pendingF.xTag;
            meta.fExtra = pendingF.extra;
            meta.rawF = pendingF.rawF;
            meta.fOrigY = curY;
            meta.fOrigX = curX;
            pendingF = null;
          }
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
        bodyExtraLines.push(line);
      }
    }
  }

  for (let r = 0; r < grid.length; r++) {
    if (!grid[r]) grid[r] = [];
    while (grid[r].length < maxCols) grid[r].push('');
  }

  const rowIndexByFirstCol = new Map<string, number[]>();
  for (let y = 0; y < grid.length; y++) {
    const key = String(grid[y]?.[0] ?? '');
    if (!rowIndexByFirstCol.has(key)) rowIndexByFirstCol.set(key, []);
    rowIndexByFirstCol.get(key)!.push(y);
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
    rowIndexByFirstCol,
  };
}

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

function findOrigYByFirstCol(
  meta: SlkData | undefined,
  firstColValue: string,
  hintY: number
): number {
  if (!meta?.rowIndexByFirstCol) return -1;
  const list = meta.rowIndexByFirstCol.get(firstColValue);
  if (!list || list.length === 0) return -1;
  if (list.length === 1) return list[0];
  let best = list[0];
  let bestDist = Math.abs(list[0] - hintY);
  for (let i = 1; i < list.length; i++) {
    const d = Math.abs(list[i] - hintY);
    if (d < bestDist) { best = list[i]; bestDist = d; }
  }
  return best;
}

export function stringifySLK(
  rows: string[][],
  meta?: SlkData,
  rowOrigIdx?: number[]
): string {
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

  if (meta?.headerLines) {
    for (const h of meta.headerLines) {
      const ht = h.trimStart();
      if (ht.startsWith('B;')) {
        let newB = h;
        if (/Y\d+/.test(newB)) newB = newB.replace(/Y\d+/, `Y${maxRows}`);
        else newB += `;Y${maxRows}`;
        if (/X\d+/.test(newB)) newB = newB.replace(/X\d+/, `X${maxCols}`);
        else newB += `;X${maxCols}`;
        lines.push(newB);
      } else {
        lines.push(h);
      }
    }
  } else {
    lines.push('ID;PWXL;N;E');
  }

  if (meta?.bRecord) {
    let newB = meta.bRecord;
    if (/Y\d+/.test(newB)) newB = newB.replace(/Y\d+/, `Y${maxRows}`);
    else newB += `;Y${maxRows}`;
    if (/X\d+/.test(newB)) newB = newB.replace(/X\d+/, `X${maxCols}`);
    else newB += `;X${maxCols}`;
    lines.push(newB);
  }

  if (meta?.bodyExtraLines && meta.bodyExtraLines.length > 0) {
    lines.push(...meta.bodyExtraLines);
  }

  let currentY = 1;
  let currentX = 1;

  for (let y = 0; y < maxRows; y++) {
    const row = rows[y];
    if (!row) continue;

    const firstColVal = String(row[0] ?? '');

    // ★ 主方案：rowOrigIdx；兜底：第一列值查表
    let origY: number;
    const hinted = rowOrigIdx ? rowOrigIdx[y] : undefined;
    if (hinted !== undefined && hinted >= 0) {
      origY = hinted;
    } else {
      // 新行（-1）或 rowOrigIdx 缺失 → 尝试值查表
      // 这样"复制行但没改 id"也能继承源行的 F，
      // 而"原地改了 id"由 rowOrigIdx 保证保留 F（走上面那条分支）
      origY = findOrigYByFirstCol(meta, firstColVal, y);
    }

    for (let x = 0; x < maxCols; x++) {
      const val = row[x];
      const isEmpty = (val === undefined || val === null || val === '');
      const cellMeta = origY >= 0
        ? meta?.cellMap?.get(`${origY}_${x}`)
        : undefined;

      if (isEmpty && !cellMeta) continue;
      if (isEmpty && cellMeta && !cellMeta.hasF) continue;

      const tgtY = y + 1;
      const tgtX = x + 1;

      if (cellMeta?.hasF) {
        const canReuseF =
          cellMeta.rawF !== undefined &&
          cellMeta.fHasY && cellMeta.fHasX &&
          cellMeta.fOrigY === tgtY &&
          cellMeta.fOrigX === tgtX;

        if (canReuseF) {
          lines.push(cellMeta.rawF!);
          currentY = tgtY;
          currentX = tgtX;
        } else {
          let out = 'F';
          if (cellMeta.fExtra) out += cellMeta.fExtra;
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
          lines.push(out);
        }
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