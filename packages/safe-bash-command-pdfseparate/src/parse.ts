const usage = "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n";

export function parsePdfseparateSpec(pattern: string): {
  readonly hasPageSpec: boolean;
  format(pageNumber: number): string;
} {
  let hasPageSpec = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") continue;
    if (pattern[i + 1] === "%") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") j++;
    if (pattern[j] === "d") {
      hasPageSpec = true;
      break;
    }
  }
  return {
    hasPageSpec,
    format(pageNumber: number): string {
      let out = "";
      let replaced = false;
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== "%") {
          out += pattern[i]!;
          continue;
        }
        if (pattern[i + 1] === "%") {
          out += "%";
          i++;
          continue;
        }
        if (!replaced) {
          let j = i + 1;
          let digits = "";
          while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") {
            digits += pattern[j]!;
            j++;
          }
          if (pattern[j] === "d") {
            const width = digits.length > 0 ? Number.parseInt(digits, 10) || 0 : 0;
            if (!Number.isSafeInteger(width) || width > 4096) throw new RangeError("Filename width limit exceeded");
            const padChar = digits.startsWith("0") ? "0" : " ";
            out += width > 0 ? String(pageNumber).padStart(width, padChar) : String(pageNumber);
            replaced = true;
            i = j;
            continue;
          }
        }
        out += "%";
      }
      return out;
    },
  };
}

export interface PdfseparatePlan { firstPage: number; lastPage: number; srcPath: string; pattern: string; }
export interface PdfseparateResult { exitCode: number; stdout: string; stderr: string; }
export function parsePdfseparateArgs(argv: readonly string[]): PdfseparatePlan | PdfseparateResult {
    let firstPage = 1;
    let lastPage = 0;
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "-v" || arg === "--version") return { exitCode: 0, stdout: "", stderr: "pdfseparate version 24.08.0\n" };
        if (["-h", "-help", "--help", "-?"].includes(arg)) return { exitCode: 0, stdout: "", stderr: usage };
        if (arg === "--") { positionals.push(...argv.slice(i + 1)); break; }
        if (arg === "-f" || arg === "-l") {
          const token = argv[++i];
          const digits = token?.startsWith("-") ? token.slice(1) : token;
          if (!digits || [...digits].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(token))) return { exitCode: 99, stdout: "", stderr: usage };
          if (arg === "-f") firstPage = Math.max(1, Number(token));
          else lastPage = Math.max(0, Number(token));
          continue;
        }
        if (arg.startsWith("-")) return { exitCode: 99, stdout: "", stderr: usage };
        positionals.push(arg);
    }
    if (positionals.length !== 2) {
        return {
            exitCode: 99,
            stdout: "",
            stderr: "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n"
        };
    }
    const srcPath = positionals[0]!;
    const pattern = positionals[1]!;
    return { firstPage, lastPage, srcPath, pattern };
}
