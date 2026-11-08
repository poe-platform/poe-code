import type { Budget } from "../budget.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export const stringHtmlMethods = {
  anchor: ["a", "name"],
  big: ["big", ""],
  blink: ["blink", ""],
  bold: ["b", ""],
  fixed: ["tt", ""],
  fontcolor: ["font", "color"],
  fontsize: ["font", "size"],
  italics: ["i", ""],
  link: ["a", "href"],
  small: ["small", ""],
  strike: ["strike", ""],
  sub: ["sub", ""],
  sup: ["sup", ""]
} as const;

export async function createStringHtml(
  value: string,
  [tag, attribute]: readonly [string, string],
  argument: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  const release = retainValues(budget, () => [value, argument]);
  try {
    const text = attribute === "" ? "" : await sandboxString(argument, budget, context);
    budget.visitNode(value.length + text.length);
    const opening = attribute === "" ? `<${tag}>` : `<${tag} ${attribute}="${text.replaceAll('"', "&quot;")}">`;
    return budget.allocateString(`${opening}${value}</${tag}>`);
  } finally { release(); }
}
