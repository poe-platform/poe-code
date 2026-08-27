import { RegexExecutionError, type RegexSession } from "../regex-execution/client.js";
import type { Match, Row, SearchDescriptor } from "../regex-execution/protocol.js";
import { SearchError, type Arguments } from "./options.js";

export type { Match } from "../regex-execution/protocol.js";

export class Matcher {
  private readonly descriptor: SearchDescriptor;
  constructor(patterns: readonly string[], args: Arguments, private readonly session: RegexSession) {
    this.descriptor = { kind: "rg", patterns: [...patterns], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
  }
  async batch(rows: readonly Row[]): Promise<Match[][]> {
    try { return await this.session.run(this.descriptor, rows); }
    catch (error) {
      if (error instanceof RegexExecutionError && error.code === "MATCH") throw new SearchError(error.message);
      throw error;
    }
  }
  async matches(bytes: Uint8Array, all = true, terminated = true): Promise<Match[]> {
    return (await this.batch([{ bytes, all, terminated }]))[0]!;
  }
}
