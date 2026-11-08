import { RegexExecutionError, type RegexSession } from "safe-bash-regex-engine/execution/portable";
import { trustedInputRows, type Row, type SearchDescriptor } from "safe-bash-regex-engine/execution/protocol";
import { prepareErgonomicRegex, type Match, type ErgonomicVmMatcher } from "safe-bash-search-engine/ergonomic-regex";
import { SearchError, type Arguments } from "./options.js";

export type { Match } from "safe-bash-search-engine/ergonomic-regex";

function isSimpleRgLiteralChar(c: number): boolean {
  if (c < 32 || c > 126) return false;
  switch (c) {
    case 36: // $
    case 40: // (
    case 41: // )
    case 42: // *
    case 43: // +
    case 46: // .
    case 63: // ?
    case 91: // [
    case 92: // \
    case 93: // ]
    case 94: // ^
    case 123: // {
    case 124: // |
    case 125: // }
      return false;
    default:
      return true;
  }
}

const DUMMY_LITERAL_DESCRIPTOR: SearchDescriptor = Object.freeze({
  kind: "rg",
  patterns: Object.freeze([]),
  fixed: true,
  case: "sensitive",
  whole: false,
  word: false,
  nullData: false,
});

export class Matcher {
  private descriptor!: SearchDescriptor;
  private vm: ErgonomicVmMatcher | undefined;
  private byteSubjectVm: (() => ErgonomicVmMatcher) | undefined;
  private captureVm: ErgonomicVmMatcher | undefined;
  private emptyPattern = false;
  crossLine!: boolean;
  literalAsciiBytes: Uint8Array | undefined;
  constructor(patterns: readonly string[], args: Arguments, private session: RegexSession, ergonomic = true, literalOnly = false) {
    this.resetForRun(patterns, args, session, ergonomic, literalOnly);
  }
  resetForRun(patterns: readonly string[], args: Arguments, session: RegexSession, ergonomic = true, literalOnly = false): void {
    this.session = session;
    this.captureVm = undefined;
    this.byteSubjectVm = undefined;
    this.emptyPattern = !args.whole && patterns.length === 1 && patterns[0] === "";
    if (ergonomic && !literalOnly && patterns.length > 0) {
      let vm: ErgonomicVmMatcher | undefined;
      const config = {
        kind: "rg" as const, fixed: args.fixed, caseMode: args.case,
        whole: args.whole, word: args.word, nullData: args.nullData,
        multiline: args.multiline, multilineDotall: args.multilineDotall,
        captures: args.replacement?.includes("$") ?? false,
        binaryText: args.binary === "text", forceVm: true,
      };
      this.byteSubjectVm = () => {
        if (vm) return vm;
        const prepared = prepareErgonomicRegex(patterns, config);
        if (prepared.mode !== "vm") throw new SearchError("byte subject matcher unavailable");
        return vm = prepared.vm;
      };
    }
    if (patterns.length === 0) {
      this.literalAsciiBytes = undefined;
      this.vm = undefined;
      this.crossLine = false;
      this.descriptor = DUMMY_LITERAL_DESCRIPTOR;
      return;
    }
    let literalAscii: Uint8Array | undefined;
    if (
      ergonomic &&
      patterns.length === 1 &&
      args.binary !== "text" &&
      args.case === "sensitive" &&
      !args.whole &&
      !args.word &&
      !args.nullData &&
      !args.multiline
    ) {
      const pat = patterns[0]!;
      if (pat.length >= 1 && pat.length <= 64) {
        let ok = true;
        for (let i = 0; i < pat.length; i++) {
          const c = pat.charCodeAt(i);
          if (args.fixed ? (c < 32 || c > 126 || c === 10 || c === 13) : !isSimpleRgLiteralChar(c)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const bytes = new Uint8Array(pat.length);
          for (let i = 0; i < pat.length; i++) bytes[i] = pat.charCodeAt(i);
          literalAscii = bytes;
        }
      }
    }
    this.literalAsciiBytes = literalAscii;
    if (literalAscii !== undefined) {
      this.vm = undefined;
      this.crossLine = false;
      this.descriptor = literalOnly
        ? DUMMY_LITERAL_DESCRIPTOR
        : { kind: "rg", patterns, fixed: true, case: "sensitive", whole: false, word: false, nullData: false };
      return;
    }
    // Fast callers only consume ASCII literals; decline before compiling a regex.
    if (literalOnly) {
      this.vm = undefined;
      this.crossLine = false;
      this.descriptor = DUMMY_LITERAL_DESCRIPTOR;
      return;
    }
    const captures = args.replacement?.includes("$") ?? false;
    const prepared = ergonomic || captures
      ? prepareErgonomicRegex(patterns, {
          kind: "rg",
          fixed: args.fixed,
          caseMode: args.case,
          whole: args.whole,
          word: args.word,
          nullData: args.nullData,
          multiline: args.multiline,
          multilineDotall: args.multilineDotall,
          captures,
          binaryText: args.binary === "text",
        })
      : undefined;
    if (prepared?.mode === "vm" && ergonomic) {
      this.vm = prepared.vm;
      this.crossLine = prepared.crossLine;
      this.descriptor = { kind: "rg", patterns: [], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
    } else {
      this.vm = undefined;
      this.captureVm = prepared?.mode === "vm" ? prepared.vm : undefined;
      this.crossLine = false;
      this.descriptor = { kind: "rg", patterns: prepared?.mode === "delegated" && ergonomic ? [...prepared.patterns] : [...patterns], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
    }
  }
  private attachCaptures(results: Match[][], rows: readonly Row[]): Match[][] {
    if (!this.captureVm) return results;
    // An injected provider remains authoritative for selection and budgets.
    // Only annotate ranges that agree with the portable capture interpreter.
    return results.map((matches, index) => {
      if (matches.length === 0) return matches;
      const row = rows[index]!;
      const captured = this.captureVm!.matchBytes(row.bytes, row.all);
      let cursor = 0;
      return matches.map(match => {
        while (cursor < captured.length && captured[cursor]!.start < match.start) cursor++;
        const candidate = captured[cursor];
        if (candidate?.start !== match.start || candidate.end !== match.end) {
          throw new SearchError("regex provider match cannot be expanded with the supported capture syntax");
        }
        return candidate;
      });
    });
  }
  matchBuffer(bytes: Uint8Array, all = true): Match[] {
    if (this.vm) return this.vm.matchBytes(bytes, all);
    return [];
  }
  batchSync(rows: readonly Row[]): Match[][] | Promise<Match[][]> {
    // The bounded delegated profile requires non-NUL UTF-8. The scalar VM
    // skips invalid bytes without changing output bytes or match offsets.
    // Keep injected providers authoritative and retain the ASCII fast path.
    const vm = this.vm ?? (this.byteSubjectVm && rows.some(row => row.bytes.some(byte => byte === 0 || byte >= 128))
      ? this.byteSubjectVm() : undefined);
    if (vm && rows.length > 0) {
      const results = vm.batchSync(rows);
      if (this.emptyPattern) {
        // Match the delegated rg profile: an empty pattern visits each input
        // byte, but EOF contributes a position only for a terminated record.
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!;
          if (!row.terminated && results[index]!.at(-1)?.start === row.bytes.length) results[index]!.pop();
        }
      }
      return results;
    }
    trustedInputRows.add(rows);
    try {
      const res = this.session.runSync(this.descriptor, rows);
      if (!(res instanceof Promise)) return this.attachCaptures(res, rows);
      return res.then(result => this.attachCaptures(result, rows)).catch(error => {
        if (error instanceof RegexExecutionError && error.code === "MATCH") throw new SearchError(error.message);
        throw error;
      });
    } catch (error) {
      if (error instanceof RegexExecutionError && error.code === "MATCH") throw new SearchError(error.message);
      throw error;
    }
  }
  async batch(rows: readonly Row[]): Promise<Match[][]> {
    const res = this.batchSync(rows);
    return res instanceof Promise ? await res : res;
  }
  async matches(bytes: Uint8Array, all = true, terminated = true): Promise<Match[]> {
    return (await this.batch([{ bytes, all, terminated }]))[0]!;
  }
}
