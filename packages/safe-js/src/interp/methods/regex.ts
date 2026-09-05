import {
  createSandboxClosure,
  getSandboxRegexPattern,
  type SandboxRegex,
  type SandboxValue
} from "../values.js";
import { matchRegex, type RegexMatch } from "../regex/engine.js";
import type { Budget } from "../budget.js";

export type RegexMethodName = "exec" | "test";

const regexMethodNames = new Set<RegexMethodName>(["exec", "test"]);

export function isRegexMethodName(property: string | number): property is RegexMethodName {
  return typeof property === "string" && regexMethodNames.has(property as RegexMethodName);
}

export function getRegexMember(
  target: SandboxRegex,
  property: string | number,
  budget?: Budget
): SandboxValue | undefined {
  if (property === "source") return escapeRegexSource(target.source, budget);
  if (property === "flags") {
    const flags = [..."gims"].filter((flag) => target.flags.includes(flag)).join("");
    return budget === undefined ? flags : budget.allocateString(flags);
  }
  if (property === "lastIndex") return target.lastIndex;
  if (!isRegexMethodName(property)) {
    return undefined;
  }
  return createSandboxClosure({
    sandbox: true,
    name: `RegExp#${property}`,
    call: (args) => callRegexMethod(target, property, args)
  });
}

function escapeRegexSource(source: string, budget?: Budget): string {
  let text = "";
  let escaped = false;
  let inClass = false;
  for (const character of source) {
    budget?.visitNode();
    if (
      character === "\n" ||
      character === "\r" ||
      character === "\u2028" ||
      character === "\u2029"
    ) {
      if (escaped) text = text.slice(0, -1);
      text +=
        character === "\n"
          ? "\\n"
          : character === "\r"
            ? "\\r"
            : character === "\u2028"
              ? "\\u2028"
              : "\\u2029";
      escaped = false;
    } else {
      if (!escaped && character === "[") inClass = true;
      if (!escaped && character === "]") inClass = false;
      text += character === "/" && !escaped && !inClass ? "\\/" : character;
      escaped = character === "\\" && !escaped;
    }
    budget?.allocateString(text);
  }
  text = text === "" ? "(?:)" : text;
  return budget === undefined ? text : budget.allocateString(text);
}

export function setRegexMember(
  target: SandboxRegex,
  property: string | number,
  value: SandboxValue
): void {
  if (property !== "lastIndex") {
    throw new TypeError(`RegExp#${String(property)} is not writable.`);
  }
  target.lastIndex = Number(value);
}

export function callRegexMethod(
  target: SandboxRegex,
  methodName: RegexMethodName,
  args: readonly SandboxValue[]
): SandboxValue {
  const match = executeRegex(target, String(args[0]));
  return methodName === "test" ? match !== null : toMatchArray(match, String(args[0]));
}

export function executeRegex(target: SandboxRegex, input: string): RegexMatch | null {
  const pattern = getSandboxRegexPattern(target);
  const match = matchRegex(pattern, input, target.lastIndex);
  if (pattern.flags.global) {
    target.lastIndex = match === null ? 0 : match.index + match.text.length;
  }
  return match;
}

export function toMatchArray(match: RegexMatch | null, input: string): SandboxValue {
  if (match === null) {
    return null;
  }
  const result = [match.text, ...match.captures] as SandboxValue[];
  Object.assign(result, { index: match.index, input, groups: undefined });
  return result;
}
