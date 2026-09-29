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
    } else if (a === "-d" || a === "--delimiter") {
      if (i + 1 >= args.length) return undefined;
      const d = args[++i]!;
      if (d.length !== 1) return undefined;
      delim = d;
    } else if (a === "-s" || a === "--start" || a === "--skip") {
      if ((sub !== "headers" && sub !== "slice") || i + 1 >= args.length) return undefined;
      const v = Number(args[++i]!);
      if (!Number.isSafeInteger(v) || v < 0) return undefined;
      startNum = v;
    } else if (a === "-l" || a === "--len") {
      if (sub !== "slice" || i + 1 >= args.length) return undefined;
      const v = Number(args[++i]!);
      if (!Number.isSafeInteger(v) || v < 0) return undefined;
      lenNum = v;
    } else if (a === "-e" || a === "--end") {
      if (sub !== "slice" || i + 1 >= args.length) return undefined;
      const v = Number(args[++i]!);
      if (!Number.isSafeInteger(v) || v < 0) return undefined;
      endNum = v;
    } else if (a === "-i" || a === "--index") {
      if (sub !== "slice" || i + 1 >= args.length) return undefined;
      const v = Number(args[++i]!);
      if (!Number.isSafeInteger(v) || v < 0) return undefined;
      indexNum = v;
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
    for (let r = s; r < Math.min(e, dataRows.length); r++) {
      if (r >= 0) outRows.push(dataRows[r]!);
    }
    if (outRows.length === 0) return "";
    return outRows.map(r => r.map(c => formatSyncCsvCell(c, effectiveDelim)).join(",")).join("\n") + "\n";
  }

  // select
  if (rows.length === 0) return "";
  const hdr = rows[0]!;
  const positions: number[] = [];
  const specs = selectionSpec.split(",");
  for (const rawSpec of specs) {
    const spec = rawSpec.trim();
    if (!spec) return undefined;
    if (/^\d+$/u.test(spec)) {
      const idx = Number(spec);
      if (idx >= hdr.length) return undefined;
      positions.push(idx);
    } else if (!noHeaders) {
      const idx = hdr.indexOf(spec);
      if (idx < 0) return undefined;
      positions.push(idx);
    } else {
      return undefined;
    }
  }
  const outLines: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const picked = positions.map(p => formatSyncCsvCell(row[p] ?? "", ","));
    outLines.push(picked.join(","));
  }
  return outLines.join("\n") + "\n";
}

