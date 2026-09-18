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

  /** 原文件是否以 UTF-8 BOM 开头 */
  hasBOM?: boolean;
  /** P 段中定义的样式总数（P 记录条数），用于校验 F;SMxxx / F;SDMxxx 引用 */
  styleCount?: number;
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
  const hasBOM = content.length > 0 && content.charCodeAt(0) === 0xFEFF;
  if (hasBOM) content = content.substring(1);

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

  // ★ pendingF 已删除
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
          // ★ F 独立存储到它自己的 cellKey（不再附属到下一个 C）
          meta.hasF = true;
          meta.fHasY = yTag;
          meta.fHasX = xTag;
          meta.fExtra = extraStr;
          meta.rawF = trimmed;
          meta.fOrigY = curY;
          meta.fOrigX = curX;
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

  // === 新增：统计 P 段样式总数 ===
  let styleCount = 0;
  for (const h of headerLines) {
    if (h.startsWith('P;')) styleCount++;
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
    originalContent: hasBOM ? '\uFEFF' + content : content,
    rowIndexByFirstCol,
    // === 新增 ===
    hasBOM,
    styleCount,
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
  // 未修改：原样返回（包含 BOM）
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

  // === 新增：样式引用校验器 ===
  // 若 F 记录里的 SM/SDM 数字超过 P 段实际定义数，则视为无效引用，
  // 直接丢弃整条 F 记录，避免 Excel 因悬空引用而报"文件损坏"。
  const styleCount = meta?.styleCount ?? 0;
  const isValidFRecord = (rec: string): boolean => {
    if (styleCount <= 0) return true; // 无法判断，保守放行
    const m = /(?:^|;)S(?:DM)?(\d+)(?:;|$)/.exec(rec);
    if (!m) return true;              // 无样式引用，直接放行
    const idx = parseInt(m[1], 10);
    return idx >= 0 && idx < styleCount;
  };

  // === header（P 段 + F;P0 + B; 记录） ===
  if (meta?.headerLines) {
    for (const h of meta.headerLines) {
      const ht = h.trimStart();
      if (ht.startsWith('B;')) {
        let newB = h;
        if (/Y\d+/.test(newB)) newB = newB.replace(/Y\d+/, `Y${maxRows}`);
        else newB += `;Y${maxRows}`;
        if (/X\d+/.test(newB)) newB = newB.replace(/X\d+/, `X${maxCols}`);
        else newB += `;X${maxCols}`;
        newB = newB.replace(/\bD(\d+) (\d+) (\d+) (\d+)\b/, (_, a, b, _c, _d) =>
          `D${a} ${b} ${maxRows - 1} ${maxCols - 1}`
        );
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
    newB = newB.replace(/\bD(\d+) (\d+) (\d+) (\d+)\b/, (_, a, b, _c, _d) =>
      `D${a} ${b} ${maxRows - 1} ${maxCols - 1}`
    );
    lines.push(newB);
  }

  if (meta?.bodyExtraLines && meta.bodyExtraLines.length > 0) {
    lines.push(...meta.bodyExtraLines);
  }

  let currentY = 1;
  let currentX = 1;

  const fallbackOrigY: number[] = new Array(maxRows).fill(-1);
  {
    let last = -1;
    for (let y = 0; y < maxRows; y++) {
      const oy = rowOrigIdx ? rowOrigIdx[y] : y;
      if (oy >= 0) last = oy;
      fallbackOrigY[y] = last;
    }
    let next = -1;
    for (let y = maxRows - 1; y >= 0; y--) {
      const oy = rowOrigIdx ? rowOrigIdx[y] : y;
      if (oy >= 0) next = oy;
      if (fallbackOrigY[y] < 0) fallbackOrigY[y] = next;
    }
  }

  for (let y = 0; y < maxRows; y++) {
    const row = rows[y];
    if (!row) continue;

    const firstColVal = String(row[0] ?? '');

    let origY: number;
    const hinted = rowOrigIdx ? rowOrigIdx[y] : undefined;
    if (hinted !== undefined && hinted >= 0) {
      origY = hinted;
    } else {
      origY = findOrigYByFirstCol(meta, firstColVal, y);
    }

    for (let x = 0; x < maxCols; x++) {
      const val = row[x];
      const isEmpty = (val === undefined || val === null || val === '');
      let cellMeta = origY >= 0
        ? meta?.cellMap?.get(`${origY}_${x}`)
        : undefined;

      if (!cellMeta && origY < 0 && x === 0) {
        const tplY = fallbackOrigY[y];
        if (tplY >= 0) {
          const tpl = meta?.cellMap?.get(`${tplY}_0`);
          if (tpl?.hasF) {
            cellMeta = {
              hasF: true,
              fHasY: tpl.fHasY,
              fHasX: tpl.fHasX,
              fExtra: tpl.fExtra,
              fOrigY: tpl.fOrigY,
              fOrigX: tpl.fOrigX,
              rawF: tpl.rawF,
              hasC: false,
              cHasY: false,
              cHasX: false,
              cExtra: '',
            };
          }
        }
      }

      if (isEmpty && !cellMeta) continue;
      if (isEmpty && cellMeta && !cellMeta.hasF) continue;

      const tgtY = y + 1;
      const tgtX = x + 1;

      // === F 记录输出（带样式引用校验） ===
      if (cellMeta?.hasF) {
        let fOut: string | null = null;

        const canReuseF =
          cellMeta.rawF !== undefined &&
          cellMeta.fOrigY === tgtY &&
          cellMeta.fOrigX === tgtX;

        if (canReuseF) {
          fOut = cellMeta.rawF!;
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
          fOut = out;
        }

        if (fOut && isValidFRecord(fOut)) {
          lines.push(fOut);
          currentY = tgtY;
          currentX = tgtX;
        }
        // else: 引用越界，直接丢弃该 F 记录，保留单元格数据，
        //       避免 Excel 因悬空样式引用而拒绝打开文件。
      }

      // === C 记录输出（保持不变，但补上强制 X 修复） ===
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
          // === 关键修复：Y 之后强制补 X，防止解析器不重置 X ===
          out += `;X${tgtX}`;
          currentX = tgtX;
        } else {
          const needX = cHasX || (allowStateMachine && currentX !== tgtX);
          if (needX) {
            out += `;X${tgtX}`;
            currentX = tgtX;
          }
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

  // === tail ===
  if (meta?.tailLines && meta.tailLines.length > 0) {
    lines.push(...meta.tailLines);
  } else {
    lines.push('E');
  }

  // === 结尾拼装（含 BOM + EOL + finalNewline 强制） ===
  // 强制使用 CRLF（Excel 对 SLK 的默认期望），并确保文件末尾一定有换行。
  const eol = meta?.eol ?? '\r\n';
  let text = lines.join(eol);
  // 无论 meta.finalNewline 为何，SLK 文件末尾必须有换行符，否则 Excel 可能报损坏
  text += eol;

  if (meta?.hasBOM) {
    text = '\uFEFF' + text;
  }
  return text;
}