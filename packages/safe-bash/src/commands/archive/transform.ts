import type { CommandContext } from "../../contracts/index.js";
import { Pattern, substitute } from "../text-programs/regex.js";
import { Budget } from "../text-programs/shared.js";
import { checkPath, fail, type ArchiveLimits } from "./internal.js";

export interface NameTransform {
  readonly pattern: Pattern;
  readonly replacement: string;
  readonly global: boolean;
}

export function parseTransform(source: string): NameTransform[] {
  const transforms: NameTransform[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (source[offset++] !== "s") fail("only substitution transforms are supported");
    const delimiter = source[offset++];
    if (!delimiter || delimiter === "\\" || delimiter === "\n") fail("invalid transform delimiter");
    const field = (): string => {
      let value = "";
      while (offset < source.length) {
        const character = source[offset++]!;
        if (character === delimiter) return value;
        if (character === "\\") {
          const next = source[offset++];
          if (next === undefined) break;
          value += `\\${next}`;
        } else value += character;
      }
      return fail("unterminated transform expression");
    };
    const patternSource = field();
    if (!patternSource) fail("empty transform pattern is unsupported");
    const replacement = field();
    let global = false;
    let ignoreCase = false;
    let extended = false;
    while (offset < source.length && source[offset] !== ";") {
      const flag = source[offset++]!;
      if (flag === "g") global = true;
      else if (flag === "i") ignoreCase = true;
      else if (flag === "x") extended = true;
      else fail(`unsupported transform flag: ${flag}`);
    }
    const pattern = new Pattern(patternSource, extended, ignoreCase);
    for (let index = 0; index < replacement.length; index++) {
      if (replacement[index] !== "\\") continue;
      const next = replacement[++index];
      if (next && "uUlLE".includes(next)) fail("transform replacement case conversion is unsupported");
      if (next && next >= "1" && next <= "9" && Number(next) > pattern.groupCount) fail("transform references an undefined capture group");
    }
    transforms.push({ pattern, replacement, global });
    if (source[offset] === ";") offset++;
  }
  if (!transforms.length) fail("empty transform expression");
  return transforms;
}

export class TransformedNames {
  private readonly budget: Budget;
  constructor(context: CommandContext, private readonly transforms: readonly NameTransform[], private readonly limits: ArchiveLimits) {
    this.budget = new Budget(context, {
      ...(Number.isFinite(limits.maxPatternSteps) ? { maxSteps: limits.maxPatternSteps } : {}),
      ...(Number.isFinite(limits.maxPathBytes) ? { maxBufferBytes: limits.maxPathBytes } : {}),
    });
  }
  async apply(name: string): Promise<string> {
    for (const transform of this.transforms) {
      name = (await substitute(name, transform.pattern, transform.replacement, this.budget, transform.global)).text;
      checkPath(name, this.limits);
    }
    return name;
  }
}
