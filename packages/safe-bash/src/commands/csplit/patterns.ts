import type { RegexSession } from "../regex-execution/portable.js";
import { ExprMatchError, exprMatchCeilings } from "../regex-execution/protocol.js";
import { Budget, bytes, CsplitError } from "./internal.js";
import { integer } from "./options.js";

export interface Pattern {
  readonly argument: string;
  readonly line?: bigint;
  readonly expression?: Uint8Array;
  readonly ignore: boolean;
  readonly offset: bigint;
  repeat: bigint;
  forever: boolean;
}

export class Matcher {
  constructor(readonly session: RegexSession, readonly budget: Budget) {}
  async search(pattern: Uint8Array, subject: Uint8Array): Promise<boolean> {
    const { limits, context } = this.budget;
    this.budget.charge();
    const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C";
    const collate = context.env.LC_ALL || context.env.LC_COLLATE || context.env.LANG || "C";
    const supported = ["C", "POSIX", "C.UTF-8", "C.utf8"];
    if (!supported.includes(locale) || !supported.includes(collate)) throw new CsplitError("BRE requires C/POSIX or C.UTF-8/C.utf8 locale");
    if (this.budget.remaining() < 1) throw new CsplitError("work limit exceeded");
    const result = await this.session.searchBre({ kind: "bre-search", pattern, profile: locale === "C" || locale === "POSIX" ? "byte" : "utf8-scalar", limits: {
      maxPatternBytes: limits.maxRegexPatternBytes, maxSubjectBytes: Math.min(limits.maxLineBytes, exprMatchCeilings.maxSubjectBytes),
      maxNodes: limits.maxRegexNodes, maxDepth: limits.maxRegexDepth,
      maxSteps: Math.min(this.budget.remaining(), exprMatchCeilings.maxSteps), maxStates: limits.maxRegexStates,
      maxAllocatedUnits: limits.maxRegexAllocatedUnits,
    } }, subject);
    this.budget.charge(result.steps);
    await this.budget.checkpointWork();
    return result.matched;
  }
}

export async function preparePatterns(args: readonly string[], matcher: Matcher): Promise<readonly Pattern[]> {
  const { budget } = matcher;
  const patterns: Pattern[] = [];
  let last = 0n;
  for (let index = 0; index < args.length; index++) {
    budget.check(patterns.length + 1, budget.limits.maxPatterns, "pattern count");
    const argument = args[index]!;
    let pattern: Pattern;
    if (argument.startsWith("/") || argument.startsWith("%")) {
      const delimiter = argument[0]!;
      const closing = argument.lastIndexOf(delimiter);
      if (closing === 0) throw new CsplitError(`${argument}: closing delimiter '${delimiter}' missing`);
      budget.check(closing - 1, budget.limits.maxRegexPatternBytes, "regex pattern bytes");
      const expression = bytes(argument.slice(1, closing));
      try { await matcher.search(expression, new Uint8Array()); }
      catch (error) {
        if (error instanceof ExprMatchError && error.category === "syntax") throw new CsplitError(`${budget.quote(argument)}: invalid regular expression: ${error.message}`);
        throw error;
      }
      const offset = closing + 1 === argument.length ? 0n : integer(argument.slice(closing + 1), true);
      if (offset === undefined) throw new CsplitError(`${budget.quote(argument)}: integer expected after delimiter`);
      pattern = { argument, expression, ignore: delimiter === "%", offset, repeat: 0n, forever: false };
    } else {
      const line = integer(argument);
      if (line === undefined) throw new CsplitError(`${budget.quote(argument)}: invalid pattern`);
      if (line === 0n) throw new CsplitError(`${argument}: line number must be greater than zero`);
      if (line < last) throw new CsplitError(`line number ${budget.quote(argument)} is smaller than preceding line number, ${last}`);
      if (line === last) await budget.print(`csplit: warning: line number ${budget.quote(argument)} is the same as preceding line number\n`, true);
      last = line;
      pattern = { argument, line, ignore: false, offset: 0n, repeat: 0n, forever: false };
    }
    const repeat = args[index + 1];
    if (repeat?.startsWith("{")) {
      index++;
      if (!repeat.endsWith("}")) throw new CsplitError(`${budget.quote(repeat)}: '}' is required in repeat count`);
      if (repeat === "{*}") pattern.forever = true;
      else {
        const count = integer(repeat.slice(1, -1));
        if (count === undefined) throw new CsplitError(`${budget.quote(repeat.slice(0, -1))}}: integer required between '{' and '}'`);
        pattern.repeat = count;
      }
    }
    patterns.push(pattern);
    await budget.checkpointWork();
  }
  return patterns;
}
