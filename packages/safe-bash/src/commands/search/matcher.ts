import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import { trustedInputRows, type Match, type Row, type SearchDescriptor } from "../regex-execution/protocol.js";
import { prepareErgonomicRegex, type ErgonomicVmMatcher } from "./ergonomic-regex.js";
import { SearchError, type Arguments } from "./options.js";

export type { Match } from "../regex-execution/protocol.js";

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

const sharedLiteralBuf = new Uint8Array(64);
const sharedLiteralViews: Uint8Array[] = Array.from({ length: 65 }, (_, len) => sharedLiteralBuf.subarray(0, len));
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
  crossLine!: boolean;
  literalAsciiBytes: Uint8Array | undefined;
  constructor(patterns: readonly string[], args: Arguments, private session: RegexSession, ergonomic = true, useSharedLiteralBuf = false) {
    this.resetForRun(patterns, args, session, ergonomic, useSharedLiteralBuf);
  }
  resetForRun(patterns: readonly string[], args: Arguments, session: RegexSession, ergonomic = true, useSharedLiteralBuf = false): void {
    this.session = session;
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
          const bytes = useSharedLiteralBuf ? sharedLiteralViews[pat.length]! : new Uint8Array(pat.length);
          for (let i = 0; i < pat.length; i++) bytes[i] = pat.charCodeAt(i);
          literalAscii = bytes;
        }
      }
    }
    this.literalAsciiBytes = literalAscii;
    if (literalAscii !== undefined) {
      this.vm = undefined;
      this.crossLine = false;
      this.descriptor = useSharedLiteralBuf
        ? DUMMY_LITERAL_DESCRIPTOR
        : { kind: "rg", patterns, fixed: true, case: "sensitive", whole: false, word: false, nullData: false };
      return;
    }
    const prepared = ergonomic
      ? prepareErgonomicRegex(patterns, {
          kind: "rg",
          fixed: args.fixed,
          caseMode: args.case,
          whole: args.whole,
          word: args.word,
          nullData: args.nullData,
          multiline: args.multiline,
          multilineDotall: args.multilineDotall,
        })
      : undefined;
    if (prepared?.mode === "vm") {
      this.vm = prepared.vm;
      this.crossLine = prepared.crossLine;
      this.descriptor = { kind: "rg", patterns: [], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
    } else {
      this.vm = undefined;
      this.crossLine = false;
      this.descriptor = { kind: "rg", patterns: prepared ? [...prepared.patterns] : [...patterns], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
    }
  }
  matchBuffer(bytes: Uint8Array, all = true): Match[] {
    if (this.vm) return this.vm.matchBytes(bytes, all);
    return [];
  }
  batchSync(rows: readonly Row[]): Match[][] | Promise<Match[][]> {
    if (this.vm && rows.length > 0) return this.vm.batchSync(rows);
    trustedInputRows.add(rows);
    try {
      const res = this.session.runSync(this.descriptor, rows);
      if (!(res instanceof Promise)) return res;
      return res.catch(error => {
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
