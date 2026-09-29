const syncXanDecoder = new TextDecoder("utf-8", { fatal: false });

function parseSyncCsvRows(text: string, delim: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\"") {
        if (i + 1 < n && text[i + 1] === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === "\"" && field.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && i + 1 < n && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) return undefined;
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function formatSyncCsvCell(cell: string, delim: string): string {
  if (cell.includes(delim) || cell.includes("\"") || cell.includes("\n") || cell.includes("\r")) {
    return `"${cell.replaceAll("\"", "\"\"")}"`;
  }
  return cell;
}

export function evalSyncXan(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
): string | undefined {
  if (args.length === 0) return undefined;
  const sub = args[0] === "h" ? "headers" : args[0]!;
  if (sub !== "headers" && sub !== "count" && sub !== "select" && sub !== "slice") {
    return undefined;
  }
  let justNames = false;
  let noHeaders = false;
  let humanReadable = false;
  let startNum = 0;
  let lenNum: number | undefined;
  let endNum: number | undefined;
  let indexNum: number | undefined;
  let lastNum: number | undefined;
  let indicesList: number[] | undefined;
  let delim: string | undefined;
  const positionals: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      for (let j = i + 1; j < args.length; j++) positionals.push(args[j]!);
      break;
    }
    if (a === "-j" || a === "--just-names") {
      if (sub !== "headers") return undefined;
      justNames = true;
    } else if (a === "-n" || a === "--no-headers") {
      if (sub === "headers") return undefined;
      noHeaders = true;
    } else if (a === "-H" || a === "--human-readable") {
      if (sub !== "count") return undefined;
      humanReadable = true;
    } else if (a === "-d" || a === "--delimiter" || a.startsWith("-d") || a.startsWith("--delimiter=")) {
      const d = (a === "-d" || a === "--delimiter") ? args[++i] : (a.startsWith("--delimiter=") ? a.slice(12) : a.slice(2));
      if (!d || d.length !== 1) return undefined;
      delim = d;
    } else if (a === "-s" || a === "--start" || a === "--skip" || a.startsWith("--start=") || a.startsWith("--skip=")) {
      if (sub !== "headers" && sub !== "slice") return undefined;
      const raw = (a === "-s" || a === "--start" || a === "--skip") ? args[++i] : a.slice(a.indexOf("=") + 1);
      const v = Number(raw);
      if (!raw || !Number.isSafeInteger(v) || v < 0) return undefined;
      startNum = v;
    } else if (a === "-l" || a === "--len" || a.startsWith("--len=")) {
      if (sub !== "slice") return undefined;
      const raw = (a === "-l" || a === "--len") ? args[++i] : a.slice(6);
      const v = Number(raw);
      if (!raw || !Number.isSafeInteger(v) || v < 0) return undefined;
      lenNum = v;
    } else if (a === "-e" || a === "--end" || a.startsWith("--end=")) {
      if (sub !== "slice") return undefined;
      const raw = (a === "-e" || a === "--end") ? args[++i] : a.slice(6);
      const v = Number(raw);
      if (!raw || !Number.isSafeInteger(v) || v < 0) return undefined;
      endNum = v;
    } else if (a === "-i" || a === "--index" || a.startsWith("--index=")) {
      if (sub !== "slice") return undefined;
      const raw = (a === "-i" || a === "--index") ? args[++i] : a.slice(8);
      const v = Number(raw);
      if (!raw || !Number.isSafeInteger(v) || v < 0) return undefined;
      indexNum = v;
    } else if (a === "-L" || a === "--last" || a.startsWith("--last=")) {
      if (sub !== "slice") return undefined;
      const raw = (a === "-L" || a === "--last") ? args[++i] : a.slice(7);
      const v = Number(raw);
      if (!raw || !Number.isSafeInteger(v) || v < 0) return undefined;
      lastNum = v;
    } else if (a === "-I" || a === "--indices" || a.startsWith("--indices=")) {
      if (sub !== "slice") return undefined;
      const raw = (a === "-I" || a === "--indices") ? args[++i] : a.slice(10);
      if (!raw) return undefined;
      const parts = raw.split(",");
      const parsedIdx: number[] = [];
      for (const p of parts) {
        if (!/^\d+$/.test(p)) return undefined;
        const v = Number(p);
        if (!Number.isSafeInteger(v) || v < 0) return undefined;
        parsedIdx.push(v);
      }
      parsedIdx.sort((x, y) => x - y);
      indicesList = parsedIdx.filter((v, idx, arr) => idx === 0 || arr[idx - 1] !== v);
    } else if (a.startsWith("-")) {
      return undefined;
    } else {
      positionals.push(a);
    }
  }

  let inputPath = "-";
  let selectionSpec = "";
  if (sub === "select") {
    if (positionals.length < 1 || positionals.length > 2) return undefined;
    selectionSpec = positionals[0]!;
    if (positionals.length === 2) inputPath = positionals[1]!;
  } else {
    if (positionals.length > 1) return undefined;
    if (positionals.length === 1) inputPath = positionals[0]!;
  }

  const bytes = inputPath === "-" ? stdinBytes : (readFile ? readFile(inputPath) : undefined);
  if (!bytes || bytes.byteLength > 262144) return undefined;
  const effectiveDelim = delim ?? (inputPath.endsWith(".tsv") || inputPath.endsWith(".tab") ? "\t" : ",");
  const text = syncXanDecoder.decode(bytes);
  const rows = parseSyncCsvRows(text, effectiveDelim);
  if (!rows) return undefined;

  if (sub === "headers") {
    if (rows.length === 0) return "";
    const hdr = rows[0]!;
    const lines: string[] = [];
    for (let idx = 0; idx < hdr.length; idx++) {
      const prefix = justNames ? "" : `${startNum + idx} `;
      lines.push(`${prefix}${hdr[idx]!}`);
    }
    return `${lines.join("\n")}\n`;
  }

  if (sub === "count") {
    const count = Math.max(0, rows.length - (noHeaders ? 0 : 1));
    let out = String(count);
    if (humanReadable) {
      out = count.toLocaleString("en-US");
      if (count >= 10000) {
        const scale = count >= 1000000 ? 1000000 : 1000;
        const rounded = Math.round((count / scale) * 10) / 10;
        out += ` (${rounded}${scale === 1000 ? "k" : "M"})`;
      }
    }
    return `${out}\n`;
  }

  if (sub === "slice") {
    if (rows.length === 0) return "";
    const dataStart = noHeaders ? 0 : 1;
    const dataRows = rows.slice(dataStart);
    let s = startNum;
    let e = dataRows.length;
    if (indexNum !== undefined) {
      s = indexNum;
      e = indexNum + 1;
    } else if (lenNum !== undefined) {
      e = Math.min(dataRows.length, s + lenNum);
    } else if (endNum !== undefined) {
      e = Math.min(dataRows.length, endNum);
    }
    const outRows: string[][] = [];
    if (!noHeaders) outRows.push(rows[0]!);
    if (lastNum !== undefined) {
      const sliced = lastNum === 0 ? [] : dataRows.slice(Math.max(0, dataRows.length - lastNum));
      for (const r of sliced) outRows.push(r);
    } else if (indicesList !== undefined) {
      for (const idx of indicesList) {
        if (idx >= 0 && idx < dataRows.length) outRows.push(dataRows[idx]!);
      }
    } else {
      for (let r = s; r < Math.min(e, dataRows.length); r++) {
        if (r >= 0) outRows.push(dataRows[r]!);
      }
    }
    if (outRows.length === 0) return "";
    return outRows.map(r => r.map(c => formatSyncCsvCell(c, effectiveDelim)).join(",")).join("\n") + "\n";
  }

  // select
  if (rows.length === 0) return "";
  const hdr = rows[0]!;
  const complement = selectionSpec.startsWith("!");
  const rawBody = complement ? selectionSpec.slice(1) : selectionSpec;
  const resolveColEndpoint = (ep: string): number | undefined => {
    if (/^\d+$/u.test(ep)) {
      const idx = Number(ep);
      return idx >= 0 && idx < hdr.length ? idx : undefined;
    }
    if (!noHeaders) {
      const idx = hdr.indexOf(ep);
      return idx >= 0 ? idx : undefined;
    }
    return undefined;
  };
  const selectedRaw: number[] = [];
  if (rawBody === "" || rawBody === "*") {
    for (let k = 0; k < hdr.length; k++) selectedRaw.push(k);
  } else {
    const specs = rawBody.split(",");
    for (const rawSpec of specs) {
      const spec = rawSpec.trim();
      if (!spec) return undefined;
      if (spec === "*") {
        for (let k = 0; k < hdr.length; k++) selectedRaw.push(k);
      } else if (spec.startsWith("*") && !spec.slice(1).includes("*")) {
        if (noHeaders) return undefined;
        const suf = spec.slice(1);
        for (let k = 0; k < hdr.length; k++) if (hdr[k]!.endsWith(suf)) selectedRaw.push(k);
      } else if (spec.endsWith("*") && !spec.slice(0, -1).includes("*")) {
        if (noHeaders) return undefined;
        const pref = spec.slice(0, -1);
        for (let k = 0; k < hdr.length; k++) if (hdr[k]!.startsWith(pref)) selectedRaw.push(k);
      } else if (spec.includes(":")) {
        const colon = spec.indexOf(":");
        const left = spec.slice(0, colon);
        const right = spec.slice(colon + 1);
        if (right.includes(":")) return undefined;
        const sIdx = left === "" ? 0 : resolveColEndpoint(left);
        const eIdx = right === "" ? hdr.length - 1 : resolveColEndpoint(right);
        if (sIdx === undefined || eIdx === undefined) return undefined;
        if (sIdx <= eIdx) {
          for (let k = sIdx; k <= eIdx; k++) selectedRaw.push(k);
        } else {
          for (let k = sIdx; k >= eIdx; k--) selectedRaw.push(k);
        }
      } else {
        const idx = resolveColEndpoint(spec);
        if (idx === undefined) return undefined;
        selectedRaw.push(idx);
      }
    }
  }
  const positions: number[] = [];
  if (complement) {
    const excluded = new Set(selectedRaw);
    for (let k = 0; k < hdr.length; k++) {
      if (!excluded.has(k)) positions.push(k);
    }
  } else {
    positions.push(...selectedRaw);
  }
  const outLines: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const picked = positions.map(p => formatSyncCsvCell(row[p] ?? "", ","));
    outLines.push(picked.join(","));
  }
  return outLines.join("\n") + "\n";
}

