import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import { trustedInputRows, type Match, type Row, type SearchDescriptor } from "../regex-execution/protocol.js";
import { prepareErgonomicRegex, type ErgonomicVmMatcher } from "./ergonomic-regex.js";
import { SearchError, type Arguments } from "./options.js";

export type { Match } from "../regex-execution/protocol.js";

export class Matcher {
  private readonly descriptor: SearchDescriptor;
  private readonly vm: ErgonomicVmMatcher | undefined;
  readonly crossLine: boolean;
  constructor(patterns: readonly string[], args: Arguments, private readonly session: RegexSession, ergonomic = true) {
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
