import { Budget, ProgramError } from "./shared.js";

export function quoteAwk(value: string, budget: Budget): string {
  let output = '"';
  for (const character of value) {
    budget.step();
    const code = character.charCodeAt(0);
    const escaped = character === '"' || character === "\\" ? `\\${character}`
      : character === "\n" ? "\\n" : character === "\t" ? "\\t" : character === "\r" ? "\\r"
        : code < 32 || code === 127 ? `\\${code.toString(8).padStart(3, "0")}` : character;
    if (output.length + escaped.length + 1 > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    output += escaped;
  }
  return budget.check(output + '"');
}
