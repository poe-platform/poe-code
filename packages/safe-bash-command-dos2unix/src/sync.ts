export function evalSyncLineEndings(
  cmdName: "dos2unix" | "unix2dos",
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): Uint8Array | undefined {
  let force = false;
  let quiet = false;
  let toStdout = false;
  let newFileMode = false;
  let addEol = false;
  let newline = false;
  let bomMode: "keep" | "remove" | "add" = cmdName === "unix2dos" ? "keep" : "remove";
  let endOfOptions = false;
  const files: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!endOfOptions && a === "--") { endOfOptions = true; continue; }
    if (!endOfOptions && a.startsWith("-") && a !== "-") {
      if (a === "-q" || a === "--quiet") { quiet = true; continue; }
      if (a === "-f" || a === "--force") { force = true; continue; }
      if (a === "-s" || a === "--safe") { force = false; continue; }
      if (a === "-O" || a === "--to-stdout") {
        if (files.length > 0) return undefined;
        toStdout = true; newFileMode = false; continue;
      }
      if (a === "-n" || a === "--newfile") {
        if (files.length > 0) return undefined;
        newFileMode = true; toStdout = false; continue;
      }
      if (a === "-o" || a === "--oldfile") {
        if (files.length > 0) return undefined;
        newFileMode = false; toStdout = false; continue;
      }
      if (a === "-e" || a === "--add-eol") { addEol = true; continue; }
      if (a === "--no-add-eol") { addEol = false; continue; }
      if (a === "-l" || a === "--newline") { newline = true; continue; }
      if (a === "-r" || a === "--remove-bom") { bomMode = "remove"; continue; }
      if (a === "-m" || a === "--add-bom") { bomMode = "add"; continue; }
      if (a === "-b" || a === "--keep-bom") { bomMode = "keep"; continue; }
      if (a === "-k" || a === "--keepdate" || a === "-S" || a === "--skip-symlink" || a === "--allow-chown" || a === "--no-allow-chown") continue;
      if (a === "-ascii") continue;
      if (a === "-c" || a === "--convmode") {
        const v = opArgs[++i];
        if (v && v.toLowerCase() === "ascii") continue;
        return undefined;
      }
      return undefined;
    }
    files.push(a);
  }
  if (files.length > 0 && !toStdout && !(files.length === 1 && files[0] === "-")) {
    if (!quiet || !readFileSync || !writeFileSync) return undefined;
    if (newFileMode && files.length % 2 !== 0) return undefined;
    const pairs: Array<[string, string]> = [];
    if (newFileMode) {
      for (let k = 0; k < files.length; k += 2) pairs.push([files[k]!, files[k + 1]!]);
    } else {
      for (const f of files) pairs.push([f, f]);
    }
    const plannedWrites: Array<[string, Uint8Array]> = [];
    for (const [inPath, outPath] of pairs) {
      if (inPath === "-" || outPath === "-" || outPath.endsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(outPath)) return undefined;
      const b = readFileSync(inPath);
      if (!b || b.byteLength > 16384) return undefined;
      const subArgs = [
        "-O",
        ...(force ? ["-f"] : []),
        ...(addEol ? ["-e"] : []),
        ...(newline ? ["-l"] : []),
        ...(bomMode === "remove" ? ["-r"] : bomMode === "add" ? ["-m"] : ["-b"]),
      ];
      const converted = evalSyncLineEndings(cmdName, b, subArgs);
      if (!converted) return undefined;
      plannedWrites.push([outPath, converted]);
    }
    for (const [outPath, converted] of plannedWrites) {
      if (!writeFileSync(outPath, converted)) return undefined;
    }
    return new Uint8Array(0);
  }
  const chunks: Uint8Array[] = [];
  if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
    if (!inBytes || inBytes.byteLength > 16384) return undefined;
    chunks.push(inBytes);
  } else {
    if (!readFileSync) return undefined;
    let stdinUsed = false;
    for (const f of files) {
      let b: Uint8Array | undefined;
      if (f === "-") {
        if (stdinUsed) return undefined;
        stdinUsed = true;
        b = inBytes;
      } else {
        b = readFileSync(f);
      }
      if (!b || b.byteLength > 16384) return undefined;
      chunks.push(b);
    }
  }
  const out: number[] = [];
  for (const src of chunks) {
    let startIdx = 0;
    let hasUtf8Bom = false;
    if (src.byteLength >= 2) {
      const b0 = src[0]!, b1 = src[1]!;
      if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff) || (b0 === 0x84 && b1 === 0x31)) {
        return undefined;
      }
      if (src.byteLength >= 3 && b0 === 0xef && b1 === 0xbb && src[2] === 0xbf) {
        hasUtf8Bom = true;
        startIdx = 3;
      }
    }
    if (!force) {
      for (let i = startIdx; i < src.byteLength; i++) {
        const c = src[i]!;
        if (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) return undefined;
      }
    }
    if (bomMode === "add" || (bomMode === "keep" && hasUtf8Bom)) {
      out.push(0xef, 0xbb, 0xbf);
    }
    let last = -1;
    if (cmdName === "dos2unix") {
      for (let i = startIdx; i < src.byteLength; i++) {
        const c = src[i]!;
        if (c === 13 && i + 1 < src.byteLength && src[i + 1] === 10) {
          out.push(10);
          if (newline) out.push(10);
          last = 10;
          i++;
        } else {
          out.push(c);
          last = c;
        }
      }
      if (addEol && last !== -1 && last !== 10) out.push(10);
    } else {
      let prev = 0;
      for (let i = startIdx; i < src.byteLength; i++) {
        const c = src[i]!;
        if (c === 10 && prev !== 13) {
          out.push(13, 10);
          if (newline) out.push(13, 10);
          last = 10;
        } else {
          out.push(c);
          if (newline && c === 10) out.push(13, 10);
          last = c;
        }
        prev = c;
      }
      if (addEol && last !== -1 && last !== 10) out.push(13, 10);
    }
  }
  return new Uint8Array(out);
}
