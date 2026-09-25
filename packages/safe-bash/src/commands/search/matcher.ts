import { RegexExecutionError, type RegexSession } from "../regex-execution/portable.js";
import { trustedInputRows, type Match, type Row, type SearchDescriptor } from "../regex-execution/protocol.js";
import { SearchError, type Arguments } from "./options.js";

export type { Match } from "../regex-execution/protocol.js";

export class Matcher {
  private readonly descriptor: SearchDescriptor;
  constructor(patterns: readonly string[], args: Arguments, private readonly session: RegexSession) {
    this.descriptor = { kind: "rg", patterns: [...patterns], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
  }
  batchSync(rows: readonly Row[]): Match[][] | Promise<Match[][]> {
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
