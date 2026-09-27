const SQLITE_MAGIC = "SQLite format 3\0";
const DEFAULT_PAGE_SIZE = 4096;

// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types -- Boxed numbers preserve REAL storage for integral values.
export type SqlValue = null | number | bigint | Number | string | Uint8Array;

export interface StoredTableMeta {
  type: "table" | "index" | "view" | "trigger";
  name: string;
  tbl_name: string;
  rootpage: number;
  sql: string;
}

export interface StoredDatabaseImage {
  userVersion: number;
  applicationId: number;
  schemaCookie: number;
  master: StoredTableMeta[];
  tableRows: Map<string, { rowid: number; values: SqlValue[] }[]>;
  indexRows?: Map<string, SqlValue[][]> | undefined;
  metaJson?: string | undefined;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

export function isSqliteHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100) {
    return false;
  }
  for (let i = 0; i < 16; i += 1) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] ?? 0) << 8) | (buf[offset + 1] ?? 0);
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    (((buf[offset] ?? 0) << 24) |
      ((buf[offset + 1] ?? 0) << 16) |
      ((buf[offset + 2] ?? 0) << 8) |
      (buf[offset + 3] ?? 0)) >>>
    0
  );
}

function readI32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) << 24) |
    ((buf[offset + 1] ?? 0) << 16) |
    ((buf[offset + 2] ?? 0) << 8) |
    (buf[offset + 3] ?? 0)
  );
}

function writeU16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

export function readVarint(buf: Uint8Array, offset: number): { value: number; length: number } {
  let value = 0;
  for (let i = 0; i < 8; i += 1) {
    const byte = buf[offset + i] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value, length: i + 1 };
    }
  }
  const byte9 = buf[offset + 8] ?? 0;
  value = value * 256 + byte9;
  return { value, length: 9 };
}

export function encodeVarint(value: number): Uint8Array {
  if (!Number.isFinite(value) || value < 0) {
    const big = BigInt(Math.trunc(value || 0));
    const bytes = new Uint8Array(9);
    let rem = big & ((1n << 64n) - 1n);
    bytes[8] = Number(rem & 0xffn);
    rem >>= 8n;
    for (let i = 7; i >= 0; i -= 1) {
      bytes[i] = Number(rem & 0x7fn) | 0x80;
      rem >>= 7n;
    }
    return bytes;
  }
  const n = Math.trunc(value);
  if (n <= 0x7f) {
    return new Uint8Array([n]);
  }
  const parts: number[] = [];
  let rem = n;
  parts.push(rem & 0x7f);
  rem = Math.floor(rem / 128);
  while (rem > 0) {
    parts.push((rem & 0x7f) | 0x80);
    rem = Math.floor(rem / 128);
  }
  parts.reverse();
  return new Uint8Array(parts);
}

function encodeRecordValue(val: SqlValue): { serialType: number; body: Uint8Array } {
  if (val === null || val === undefined) {
    return { serialType: 0, body: new Uint8Array(0) };
  }
  if (val instanceof Number) {
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setFloat64(0, val.valueOf(), false);
    return { serialType: 7, body: b };
  }
  if (typeof val === "bigint") {
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setBigInt64(0, val, false);
    return { serialType: 6, body: b };
  }
  if (typeof val === "number") {
    if (Number.isInteger(val)) {
      if (val === 0) {
        return { serialType: 8, body: new Uint8Array(0) };
      }
      if (val === 1) {
        return { serialType: 9, body: new Uint8Array(0) };
      }
      if (val >= -128 && val <= 127) {
        const b = new Uint8Array(1);
        b[0] = val & 0xff;
        return { serialType: 1, body: b };
      }
      if (val >= -32768 && val <= 32767) {
        const b = new Uint8Array(2);
        writeU16BE(b, 0, val & 0xffff);
        return { serialType: 2, body: b };
      }
      if (val >= -2147483648 && val <= 2147483647) {
        const b = new Uint8Array(4);
        writeU32BE(b, 0, val >>> 0);
        return { serialType: 4, body: b };
      }
      const b = new Uint8Array(8);
      const view = new DataView(b.buffer);
      view.setBigInt64(0, BigInt(Math.trunc(val)), false);
      return { serialType: 6, body: b };
    }
    const b = new Uint8Array(8);
    const view = new DataView(b.buffer);
    view.setFloat64(0, val, false);
    return { serialType: 7, body: b };
  }
  if (typeof val === "string") {
    const encoded = textEncoder.encode(val);
    return { serialType: encoded.byteLength * 2 + 13, body: encoded };
  }
  const u8 = val as Uint8Array;
  return { serialType: u8.byteLength * 2 + 12, body: u8 };
}

export function encodeRecord(values: SqlValue[]): Uint8Array {
  const parts = values.map(encodeRecordValue);
  const serialVarints = parts.map((p) => encodeVarint(p.serialType));
  const serialBytesLen = serialVarints.reduce((sum, v) => sum + v.byteLength, 0);
  let headerSize = serialBytesLen + 1;
  let headerVarint = encodeVarint(headerSize);
  if (headerVarint.byteLength + serialBytesLen !== headerSize) {
    headerSize = headerVarint.byteLength + serialBytesLen;
    headerVarint = encodeVarint(headerSize);
  }
  const bodyLen = parts.reduce((sum, p) => sum + p.body.byteLength, 0);
  const out = new Uint8Array(headerSize + bodyLen);
  out.set(headerVarint, 0);
  let pos = headerVarint.byteLength;
  for (const sv of serialVarints) {
    out.set(sv, pos);
    pos += sv.byteLength;
  }
  for (const p of parts) {
    out.set(p.body, pos);
    pos += p.body.byteLength;
  }
  return out;
}

export function decodeRecord(payload: Uint8Array): SqlValue[] {
  if (payload.byteLength === 0) {
    return [];
  }
  const hdr = readVarint(payload, 0);
  const headerEnd = hdr.value;
  let hPos = hdr.length;
  const serialTypes: number[] = [];
  while (hPos < headerEnd && hPos < payload.byteLength) {
    const st = readVarint(payload, hPos);
    serialTypes.push(st.value);
    hPos += st.length;
  }
  let bPos = headerEnd;
  const values: SqlValue[] = [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (const st of serialTypes) {
    if (st === 0) {
      values.push(null);
    } else if (st === 1) {
      values.push(bPos < payload.byteLength ? view.getInt8(bPos) : 0);
      bPos += 1;
    } else if (st === 2) {
      values.push(bPos + 2 <= payload.byteLength ? view.getInt16(bPos, false) : 0);
      bPos += 2;
    } else if (st === 3) {
      const b0 = payload[bPos] ?? 0;
      const b1 = payload[bPos + 1] ?? 0;
      const b2 = payload[bPos + 2] ?? 0;
      let v = (b0 << 16) | (b1 << 8) | b2;
      if (v & 0x800000) {
        v |= ~0xffffff;
      }
      values.push(v);
      bPos += 3;
    } else if (st === 4) {
      values.push(bPos + 4 <= payload.byteLength ? view.getInt32(bPos, false) : 0);
      bPos += 4;
    } else if (st === 5) {
      const hi = bPos + 2 <= payload.byteLength ? view.getInt16(bPos, false) : 0;
      const lo = bPos + 6 <= payload.byteLength ? view.getUint32(bPos + 2, false) : 0;
      values.push(hi * 4294967296 + lo);
      bPos += 6;
    } else if (st === 6) {
      if (bPos + 8 <= payload.byteLength) {
        const big = view.getBigInt64(bPos, false);
        if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) {
          values.push(Number(big));
        } else {
          values.push(big);
        }
      } else {
        values.push(0);
      }
      bPos += 8;
    } else if (st === 7) {
      if (bPos + 8 <= payload.byteLength) {
        const f = view.getFloat64(bPos, false);
        values.push(Number.isFinite(f) && Number.isInteger(f) ? new Number(f) : f);
      } else {
        values.push(new Number(0));
      }
      bPos += 8;
    } else if (st === 8) {
      values.push(0);
    } else if (st === 9) {
      values.push(1);
    } else if (st >= 12 && st % 2 === 0) {
      const len = (st - 12) / 2;
      values.push(payload.slice(bPos, bPos + len));
      bPos += len;
    } else if (st >= 13 && st % 2 === 1) {
      const len = (st - 13) / 2;
      values.push(textDecoder.decode(payload.subarray(bPos, bPos + len)));
      bPos += len;
    } else {
      values.push(null);
    }
  }
  return values;
}

function extractLeafCellPayload(
  dbBytes: Uint8Array,
  pageSize: number,
  cellBytes: Uint8Array,
  payloadSize: number
): Uint8Array {
  const reservedSpace = dbBytes[20] ?? 0;
  const usableSize = Math.max(480, pageSize - reservedSpace);
  const maxLocal = usableSize - 35;
  const minLocal = Math.floor(((usableSize - 12) * 32) / 255) - 23;
  if (payloadSize <= maxLocal) {
    return cellBytes.subarray(0, payloadSize);
  }
  const k = minLocal + ((payloadSize - minLocal) % (usableSize - 4));
  const localSize = k <= maxLocal ? k : minLocal;
  const out = new Uint8Array(payloadSize);
  out.set(cellBytes.subarray(0, localSize), 0);
  let written = localSize;
  let overflowPage = readU32BE(cellBytes, localSize);
  while (overflowPage > 0 && written < payloadSize) {
    const pageOffset = (overflowPage - 1) * pageSize;
    if (pageOffset + pageSize > dbBytes.byteLength) {
      break;
    }
    const nextPage = readU32BE(dbBytes, pageOffset);
    const chunkLen = Math.min(usableSize - 4, payloadSize - written);
    out.set(dbBytes.subarray(pageOffset + 4, pageOffset + 4 + chunkLen), written);
    written += chunkLen;
    overflowPage = nextPage;
  }
  return out;
}

function parseTableBTreeRows(
  dbBytes: Uint8Array,
  pageSize: number,
  pageNumber: number,
  visited = new Set<number>()
): { rowid: number; values: SqlValue[] }[] {
  if (pageNumber < 1 || visited.has(pageNumber)) {
    return [];
  }
  visited.add(pageNumber);
  const pageStart = (pageNumber - 1) * pageSize;
  if (pageStart + pageSize > dbBytes.byteLength) {
    return [];
  }
  const headerOffset = pageNumber === 1 ? 100 : 0;
  const pageType = dbBytes[pageStart + headerOffset] ?? 0;
  const cellCount = readU16BE(dbBytes, pageStart + headerOffset + 3);
  const rows: { rowid: number; values: SqlValue[] }[] = [];

  if (pageType === 0x0d) {
    const ptrArrayOffset = pageStart + headerOffset + 8;
    for (let i = 0; i < cellCount; i += 1) {
      const cellOffsetInPage = readU16BE(dbBytes, ptrArrayOffset + i * 2);
      const absOffset = pageStart + cellOffsetInPage;
      const pSize = readVarint(dbBytes, absOffset);
      const rId = readVarint(dbBytes, absOffset + pSize.length);
      const dataStart = absOffset + pSize.length + rId.length;
      const payload = extractLeafCellPayload(
        dbBytes,
        pageSize,
        dbBytes.subarray(dataStart, pageStart + pageSize),
        pSize.value
      );
      rows.push({
        rowid: rId.value,
        values: decodeRecord(payload)
      });
    }
  } else if (pageType === 0x05) {
    const rightMostChild = readU32BE(dbBytes, pageStart + headerOffset + 8);
    const ptrArrayOffset = pageStart + headerOffset + 12;
    for (let i = 0; i < cellCount; i += 1) {
      const cellOffsetInPage = readU16BE(dbBytes, ptrArrayOffset + i * 2);
      const absOffset = pageStart + cellOffsetInPage;
      const leftChild = readU32BE(dbBytes, absOffset);
      rows.push(...parseTableBTreeRows(dbBytes, pageSize, leftChild, visited));
    }
    rows.push(...parseTableBTreeRows(dbBytes, pageSize, rightMostChild, visited));
  }
  return rows;
}

export function readSqliteDatabaseBytes(bytes: Uint8Array): StoredDatabaseImage | null {
  if (!isSqliteHeader(bytes)) {
    return null;
  }
  let pageSize = readU16BE(bytes, 16);
  if (pageSize === 1) {
    pageSize = 65536;
  }
  if (pageSize < 512) {
    pageSize = DEFAULT_PAGE_SIZE;
  }
  const schemaCookie = readU32BE(bytes, 40);
  const userVersion = readI32BE(bytes, 60);
  const applicationId = readI32BE(bytes, 68);

  const masterRaw = parseTableBTreeRows(bytes, pageSize, 1);
  const master: StoredTableMeta[] = [];
  const tableRows = new Map<string, { rowid: number; values: SqlValue[] }[]>();
  let metaJson: string | undefined;

  for (const row of masterRaw) {
    const type = String(row.values[0] ?? "table") as StoredTableMeta["type"];
    const name = String(row.values[1] ?? "");
    const tbl_name = String(row.values[2] ?? name);
    const rootpage = Number(row.values[3] ?? 0);
    const sql = row.values[4] === null || row.values[4] === undefined ? "" : String(row.values[4]);
    if (name === "__safe_bash_sqlite_meta__") {
      metaJson = sql;
      continue;
    }
    master.push({ type, name, tbl_name, rootpage, sql });
    if (type === "table" && rootpage > 1) {
      tableRows.set(name, parseTableBTreeRows(bytes, pageSize, rootpage));
    }
  }

  return {
    userVersion,
    applicationId,
    schemaCookie,
    master,
    tableRows,
    metaJson
  };
}

function buildTablePages(
  rows: { rowid: number; values: SqlValue[] }[],
  startPageNumber: number,
  isPageOne: boolean
): { rootPage: number; pages: Uint8Array[] } {
  const pageSize = DEFAULT_PAGE_SIZE;
  const pages: Uint8Array[] = [];
  const rootPageNum = startPageNumber;
  pages.push(new Uint8Array(pageSize));

  const allocatePage = (): { pageNum: number; buf: Uint8Array } => {
    const buf = new Uint8Array(pageSize);
    pages.push(buf);
    return { pageNum: startPageNumber + pages.length - 1, buf };
  };

  const encodeCellWithOverflow = (rowid: number, values: SqlValue[]): Uint8Array => {
    const payload = encodeRecord(values);
    const payloadSize = payload.byteLength;
    const pSizeVar = encodeVarint(payloadSize);
    const rIdVar = encodeVarint(rowid);
    const maxLocal = pageSize - 35;
    const minLocal = Math.floor(((pageSize - 12) * 32) / 255 - 23);

    if (payloadSize <= maxLocal) {
      const cell = new Uint8Array(pSizeVar.byteLength + rIdVar.byteLength + payloadSize);
      cell.set(pSizeVar, 0);
      cell.set(rIdVar, pSizeVar.byteLength);
      cell.set(payload, pSizeVar.byteLength + rIdVar.byteLength);
      return cell;
    }

    const k = Math.floor(minLocal + ((payloadSize - minLocal) % (pageSize - 4)));
    const localSize = k <= maxLocal ? k : minLocal;
    const cell = new Uint8Array(pSizeVar.byteLength + rIdVar.byteLength + localSize + 4);
    cell.set(pSizeVar, 0);
    cell.set(rIdVar, pSizeVar.byteLength);
    cell.set(payload.subarray(0, localSize), pSizeVar.byteLength + rIdVar.byteLength);

    let remainingOffset = localSize;
    let prevPageBuf: Uint8Array | null = null;
    let firstOverflowPageNum = 0;

    while (remainingOffset < payloadSize) {
      const { pageNum, buf } = allocatePage();
      if (firstOverflowPageNum === 0) {
        firstOverflowPageNum = pageNum;
      }
      if (prevPageBuf) {
        writeU32BE(prevPageBuf, 0, pageNum);
      }
      const chunkLen = Math.min(pageSize - 4, payloadSize - remainingOffset);
      buf.set(payload.subarray(remainingOffset, remainingOffset + chunkLen), 4);
      remainingOffset += chunkLen;
      prevPageBuf = buf;
    }

    writeU32BE(cell, pSizeVar.byteLength + rIdVar.byteLength + localSize, firstOverflowPageNum);
    return cell;
  };

  const encodedCells = rows.map((r) => ({
    rowid: r.rowid,
    cell: encodeCellWithOverflow(r.rowid, r.values)
  }));

  const rootHeaderOffset = isPageOne ? 100 : 0;
  const maxRootSpace = pageSize - rootHeaderOffset - 8;
  const totalRootBytes = encodedCells.reduce((sum, c) => sum + c.cell.byteLength + 2, 0);

  if (totalRootBytes <= maxRootSpace) {
    const rootBuf = pages[0]!;
    rootBuf[rootHeaderOffset] = 0x0d;
    writeU16BE(rootBuf, rootHeaderOffset + 1, 0);
    writeU16BE(rootBuf, rootHeaderOffset + 3, encodedCells.length);
    let contentOffset = pageSize;
    for (let i = 0; i < encodedCells.length; i += 1) {
      const c = encodedCells[i]!.cell;
      contentOffset -= c.byteLength;
      rootBuf.set(c, contentOffset);
      writeU16BE(rootBuf, rootHeaderOffset + 8 + i * 2, contentOffset);
    }
    writeU16BE(rootBuf, rootHeaderOffset + 5, contentOffset);
    return { rootPage: rootPageNum, pages };
  }

  // Multi-leaf interior table B-tree
  const leafPages: { pageNum: number; maxRowid: number }[] = [];
  let idx = 0;
  while (idx < encodedCells.length) {
    const { pageNum, buf } = allocatePage();
    buf[0] = 0x0d;
    let contentOffset = pageSize;
    let count = 0;
    let maxRowid = 0;
    while (idx < encodedCells.length) {
      const entry = encodedCells[idx]!;
      const needed = entry.cell.byteLength + 2;
      if (count > 0 && contentOffset - needed < 8 + (count + 1) * 2) {
        break;
      }
      contentOffset -= entry.cell.byteLength;
      buf.set(entry.cell, contentOffset);
      writeU16BE(buf, 8 + count * 2, contentOffset);
      maxRowid = entry.rowid;
      count += 1;
      idx += 1;
    }
    writeU16BE(buf, 3, count);
    writeU16BE(buf, 5, contentOffset);
    leafPages.push({ pageNum, maxRowid });
  }

  const rootBuf = pages[0]!;
  rootBuf[rootHeaderOffset] = 0x05;
  const interiorCells = leafPages.slice(0, -1);
  const rightMost = leafPages[leafPages.length - 1]!.pageNum;
  writeU16BE(rootBuf, rootHeaderOffset + 3, interiorCells.length);
  writeU32BE(rootBuf, rootHeaderOffset + 8, rightMost);
  let contentOffset = pageSize;
  for (let i = 0; i < interiorCells.length; i += 1) {
    const ic = interiorCells[i]!;
    const keyVar = encodeVarint(ic.maxRowid);
    const cell = new Uint8Array(4 + keyVar.byteLength);
    writeU32BE(cell, 0, ic.pageNum);
    cell.set(keyVar, 4);
    contentOffset -= cell.byteLength;
    rootBuf.set(cell, contentOffset);
    writeU16BE(rootBuf, rootHeaderOffset + 12 + i * 2, contentOffset);
  }
  writeU16BE(rootBuf, rootHeaderOffset + 5, contentOffset);
  return { rootPage: rootPageNum, pages };
}


function compareSqlValuesForBTree(a: SqlValue, b: SqlValue): number {
  const rank = (v: SqlValue): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number" || typeof v === "bigint" || v instanceof Number) return 1;
    if (typeof v === "string") return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1) {
    const na = typeof a === "bigint" ? Number(a) : a instanceof Number ? a.valueOf() : (a as number);
    const nb = typeof b === "bigint" ? Number(b) : b instanceof Number ? b.valueOf() : (b as number);
    return na - nb;
  }
  if (ra === 2) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  const ba = a as Uint8Array;
  const bb = b as Uint8Array;
  const len = Math.min(ba.byteLength, bb.byteLength);
  for (let i = 0; i < len; i += 1) {
    if (ba[i] !== bb[i]) return ba[i]! - bb[i]!;
  }
  return ba.byteLength - bb.byteLength;
}

function buildIndexPages(
  entries: SqlValue[][],
  startPageNumber: number
): { rootPage: number; pages: Uint8Array[] } {
  const pageSize = DEFAULT_PAGE_SIZE;
  const pages: Uint8Array[] = [];
  const rootPageNum = startPageNumber;
  pages.push(new Uint8Array(pageSize));

  const allocatePage = (): { pageNum: number; buf: Uint8Array } => {
    const buf = new Uint8Array(pageSize);
    pages.push(buf);
    return { pageNum: startPageNumber + pages.length - 1, buf };
  };

  const sorted = [...entries].sort((r1, r2) => {
    const len = Math.min(r1.length, r2.length);
    for (let i = 0; i < len; i += 1) {
      const c = compareSqlValuesForBTree(r1[i] ?? null, r2[i] ?? null);
      if (c !== 0) return c;
    }
    return r1.length - r2.length;
  });

  const encodeIndexCell = (values: SqlValue[]): Uint8Array => {
    const payload = encodeRecord(values);
    const payloadSize = payload.byteLength;
    const pSizeVar = encodeVarint(payloadSize);
    const maxLocal = Math.floor(((pageSize - 12) * 64) / 255 - 23);
    const minLocal = Math.floor(((pageSize - 12) * 32) / 255 - 23);

    if (payloadSize <= maxLocal) {
      const cell = new Uint8Array(pSizeVar.byteLength + payloadSize);
      cell.set(pSizeVar, 0);
      cell.set(payload, pSizeVar.byteLength);
      return cell;
    }

    const k = Math.floor(minLocal + ((payloadSize - minLocal) % (pageSize - 4)));
    const localSize = k <= maxLocal ? k : minLocal;
    const cell = new Uint8Array(pSizeVar.byteLength + localSize + 4);
    cell.set(pSizeVar, 0);
    cell.set(payload.subarray(0, localSize), pSizeVar.byteLength);

    let remainingOffset = localSize;
    let prevPageBuf: Uint8Array | null = null;
    let firstOverflowPageNum = 0;

    while (remainingOffset < payloadSize) {
      const { pageNum, buf } = allocatePage();
      if (firstOverflowPageNum === 0) {
        firstOverflowPageNum = pageNum;
      }
      if (prevPageBuf) {
        writeU32BE(prevPageBuf, 0, pageNum);
      }
      const chunkLen = Math.min(pageSize - 4, payloadSize - remainingOffset);
      buf.set(payload.subarray(remainingOffset, remainingOffset + chunkLen), 4);
      remainingOffset += chunkLen;
      prevPageBuf = buf;
    }

    writeU32BE(cell, pSizeVar.byteLength + localSize, firstOverflowPageNum);
    return cell;
  };

  const encodedCells = sorted.map((vals) => encodeIndexCell(vals));
  const maxRootSpace = pageSize - 8;
  const totalRootBytes = encodedCells.reduce((sum, c) => sum + c.byteLength + 2, 0);

  if (totalRootBytes <= maxRootSpace) {
    const rootBuf = pages[0]!;
    rootBuf[0] = 0x0a;
    writeU16BE(rootBuf, 1, 0);
    writeU16BE(rootBuf, 3, encodedCells.length);
    let contentOffset = pageSize;
    for (let i = 0; i < encodedCells.length; i += 1) {
      const c = encodedCells[i]!;
      contentOffset -= c.byteLength;
      rootBuf.set(c, contentOffset);
      writeU16BE(rootBuf, 8 + i * 2, contentOffset);
    }
    writeU16BE(rootBuf, 5, contentOffset === pageSize ? 0 : contentOffset);
    return { rootPage: rootPageNum, pages };
  }

  // Fallback empty or first-page fitting index cells if multi-page
  const rootBuf = pages[0]!;
  rootBuf[0] = 0x0a;
  writeU16BE(rootBuf, 1, 0);
  let contentOffset = pageSize;
  let count = 0;
  for (let i = 0; i < encodedCells.length; i += 1) {
    const c = encodedCells[i]!;
    if (contentOffset - (c.byteLength + 2) < 8 + (count + 1) * 2) {
      break;
    }
    contentOffset -= c.byteLength;
    rootBuf.set(c, contentOffset);
    writeU16BE(rootBuf, 8 + count * 2, contentOffset);
    count += 1;
  }
  writeU16BE(rootBuf, 3, count);
  writeU16BE(rootBuf, 5, contentOffset === pageSize ? 0 : contentOffset);
  return { rootPage: rootPageNum, pages };
}

export function writeSqliteDatabaseBytes(image: StoredDatabaseImage): Uint8Array {
  const pageSize = DEFAULT_PAGE_SIZE;
  const extraPageChunks: Uint8Array[] = [];
  let nextPageNumber = 2;

  const masterEntries: StoredTableMeta[] = [];
  for (const item of image.master) {
    if (item.type === "table") {
      const rows = image.tableRows.get(item.name) ?? [];
      const built = buildTablePages(rows, nextPageNumber, false);
      extraPageChunks.push(...built.pages);
      nextPageNumber += built.pages.length;
      masterEntries.push({
        ...item,
        rootpage: built.rootPage
      });
    } else if (item.type === "index") {
      const idxRows = image.indexRows?.get(item.name) ?? [];
      const built = buildIndexPages(idxRows, nextPageNumber);
      extraPageChunks.push(...built.pages);
      nextPageNumber += built.pages.length;
      masterEntries.push({
        ...item,
        rootpage: built.rootPage
      });
    } else {
      masterEntries.push({
        ...item,
        rootpage: item.rootpage || 0
      });
    }
  }

  const masterRows: { rowid: number; values: SqlValue[] }[] = masterEntries.map((m, i) => ({
    rowid: i + 1,
    values: [m.type, m.name, m.tbl_name, m.rootpage, m.sql]
  }));

  const masterBuilt = buildTablePages(masterRows, 1, true);
  const page1 = masterBuilt.pages[0]!;
  const masterExtra = masterBuilt.pages.slice(1);

  // If page 1 overflowed into masterExtra pages, adjust page numbers or append at end
  // Since masterBuilt assumed startPageNumber=1, any overflow pages inside masterBuilt used 2..k.
  // To avoid page number collisions when master is small, master almost always fits on page 1.
  // If masterExtra is non-empty, rebuild with exact offsets:
  let allPages: Uint8Array[];
  if (masterExtra.length === 0) {
    allPages = [page1, ...extraPageChunks];
  } else {
    // Reserve enough pages for master first, then build user tables
    const reservedMasterCount = masterBuilt.pages.length;
    const reExtraChunks: Uint8Array[] = [];
    let pNum = 1 + reservedMasterCount;
    const reMasterEntries: StoredTableMeta[] = [];
    for (const item of image.master) {
      if (item.type === "table") {
        const rows = image.tableRows.get(item.name) ?? [];
        const built = buildTablePages(rows, pNum, false);
        reExtraChunks.push(...built.pages);
        pNum += built.pages.length;
        reMasterEntries.push({ ...item, rootpage: built.rootPage });
      } else if (item.type === "index") {
        const idxRows = image.indexRows?.get(item.name) ?? [];
        const built = buildIndexPages(idxRows, pNum);
        reExtraChunks.push(...built.pages);
        pNum += built.pages.length;
        reMasterEntries.push({ ...item, rootpage: built.rootPage });
      } else {
        reMasterEntries.push({ ...item, rootpage: item.rootpage || 0 });
      }
    }
    const reMasterRows: { rowid: number; values: SqlValue[] }[] = reMasterEntries.map((m, i) => ({
      rowid: i + 1,
      values: [m.type, m.name, m.tbl_name, m.rootpage, m.sql]
    }));
    const finalMaster = buildTablePages(reMasterRows, 1, true);
    allPages = [...finalMaster.pages, ...reExtraChunks];
  }

  const totalPages = allPages.length;
  const p1 = allPages[0]!;
  for (let i = 0; i < 16; i += 1) {
    p1[i] = SQLITE_MAGIC.charCodeAt(i);
  }
  writeU16BE(p1, 16, pageSize);
  p1[18] = 1; // write version
  p1[19] = 1; // read version
  p1[20] = 0; // reserved space
  p1[21] = 64; // max embedded payload fraction
  p1[22] = 32; // min embedded payload fraction
  p1[23] = 32; // leaf payload fraction
  writeU32BE(p1, 24, (image.schemaCookie || 1) + 1); // file change counter
  writeU32BE(p1, 28, totalPages); // db size in pages
  writeU32BE(p1, 40, image.schemaCookie || 1); // schema cookie
  writeU32BE(p1, 44, 4); // schema format number
  writeU32BE(p1, 56, 1); // UTF-8 encoding
  writeU32BE(p1, 60, image.userVersion >>> 0);
  writeU32BE(p1, 68, image.applicationId >>> 0);
  writeU32BE(p1, 92, (image.schemaCookie || 1) + 1); // version-valid-for
  writeU32BE(p1, 96, 3045000); // SQLite 3.45.0

  const result = new Uint8Array(totalPages * pageSize);
  for (let i = 0; i < totalPages; i += 1) {
    result.set(allPages[i]!, i * pageSize);
  }
  return result;
}
