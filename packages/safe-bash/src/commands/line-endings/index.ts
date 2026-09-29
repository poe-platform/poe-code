export * from "safe-bash-command-dos2unix";
export {
  createDos2unixCommand, createUnix2dosCommand, createDos2unixCommands, dos2unixCommands,
  createDos2unixCommands as createLineEndingCommands, dos2unixCommands as lineEndingCommands,
} from "safe-bash-command-dos2unix";

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
  let convMode: "ascii" | "mac" = "ascii";
  let bomMode: "keep" | "remove" | "add" = "keep";
  let endOfOptions = false;
  const files: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!endOfOptions && a === "--") { endOfOptions = true; continue; }
    if (!endOfOptions && a.startsWith("--") && a.length > 2) {
      if (a === "--quiet") { quiet = true; continue; }
      if (a === "--force") { force = true; continue; }
      if (a === "--to-stdout") { toStdout = true; continue; }
      if (a === "--newfile") { newFileMode = true; continue; }
      if (a === "--add-eol") { addEol = true; continue; }
      if (a === "--no-add-eol") { addEol = false; continue; }
      if (a === "--newline") { newline = true; continue; }
      if (a === "--no-newline") { newline = false; continue; }
      if (a === "--remove-bom") { bomMode = "remove"; continue; }
      if (a === "--add-bom") { bomMode = "add"; continue; }
      if (a === "--keep-bom") { bomMode = "keep"; continue; }
      if (a === "--convmode" || a.startsWith("--convmode=")) {
        const v = a.startsWith("--convmode=") ? a.slice(11) : opArgs[++i];
        if (v === "mac") { convMode = "mac"; continue; }
        if (v === "ascii") { convMode = "ascii"; continue; }
        return undefined;
      }
      return undefined;
    }
    if (!endOfOptions && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "q") quiet = true;
        else if (ch === "f") force = true;
        else if (ch === "O") toStdout = true;
        else if (ch === "n") newFileMode = true;
        else if (ch === "e") addEol = true;
        else if (ch === "E") addEol = false;
        else if (ch === "l") newline = true;
        else if (ch === "N") newline = false;
        else if (ch === "r") bomMode = "remove";
        else if (ch === "m") bomMode = "add";
        else if (ch === "b") bomMode = "keep";
        else if (ch === "c") {
          const v = j + 1 < a.length ? a.slice(j + 1) : opArgs[++i];
          if (v === "mac") convMode = "mac";
          else if (v === "ascii") convMode = "ascii";
          else return undefined;
          break;
        }
        else return undefined;
      }
      continue;
    }
    files.push(a);
  }
  if (files.length > 0 && !toStdout) {
    if (!quiet || !readFileSync || !writeFileSync) return undefined;
    if (newFileMode && files.length % 2 !== 0) return undefined;
    const pairs: Array<[string, string]> = [];
    if (newFileMode) {
      for (let k = 0; k < files.length; k += 2) pairs.push([files[k]!, files[k + 1]!]);
    } else {
      for (const f of files) pairs.push([f, f]);
    }
    for (const [inPath, outPath] of pairs) {
      if (inPath === "-" || outPath === "-") return undefined;
      const b = readFileSync(inPath);
      if (!b || b.byteLength > 16384) return undefined;
      const subArgs = [
        force ? "-fO" : "-O",
        ...(addEol ? ["-e"] : []),
        ...(newline ? ["-l"] : []),
        ...(convMode === "mac" ? ["-c", "mac"] : []),
        ...(bomMode === "remove" ? ["-r"] : bomMode === "add" ? ["-m"] : []),
      ];
      const converted = evalSyncLineEndings(cmdName, b, subArgs);
      if (!converted || !writeFileSync(outPath, converted)) return undefined;
    }
    return new Uint8Array(0);
  }
  const chunks: Uint8Array[] = [];
  if (files.length === 0) {
    if (!inBytes || inBytes.byteLength > 16384) return undefined;
    chunks.push(inBytes);
  } else {
    if (!readFileSync) return undefined;
    for (const f of files) {
      const b = readFileSync(f);
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
        if (convMode === "mac") {
          if (c === 13 && (i + 1 >= src.byteLength || src[i + 1] !== 10)) {
            out.push(10);
            if (newline) out.push(10);
            last = 10;
          } else {
            out.push(c);
            last = c;
          }
        } else if (c === 13 && i + 1 < src.byteLength && src[i + 1] === 10) {
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
        if (convMode === "mac") {
          if (c === 10 && prev !== 13) {
            out.push(13);
            if (newline) out.push(13);
            last = 13;
          } else {
            out.push(c);
            last = c;
          }
        } else if (c === 10 && prev !== 13) {
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
      if (addEol && last !== -1 && last !== (convMode === "mac" ? 13 : 10)) {
        if (convMode === "mac") out.push(13);
        else out.push(13, 10);
      }
    }
  }
  return new Uint8Array(out);
}
