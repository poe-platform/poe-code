/** Remove nonprinting terminal strings before presentation can split or trim them. */
export function createTerminalStringFilter(): { push(text: string): string } {
  let hidden = false;
  let allowBell = false;
  let escape = false;
  return {
    push(text) {
      if (!hidden && !escape && !text.includes("\u001b") && !text.includes("\u0090") &&
          !text.includes("\u0098") && !text.includes("\u009d") && !text.includes("\u009e") && !text.includes("\u009f")) return text;
      let output = "";
      for (const ch of text) {
        if (hidden) {
          if (ch === "\u009c" || (allowBell && ch === "\u0007") || (escape && ch === "\\")) {
            hidden = false;
            escape = false;
          } else escape = ch === "\u001b";
          continue;
        }
        if (escape) {
          escape = false;
          if (ch === "]" || ch === "P" || ch === "X" || ch === "^" || ch === "_") {
            hidden = true;
            allowBell = ch === "]";
            continue;
          }
          output += "\u001b";
        }
        if (ch === "\u001b") escape = true;
        else if (ch === "\u0090" || ch === "\u0098" || ch === "\u009d" || ch === "\u009e" || ch === "\u009f") {
          hidden = true;
          allowBell = ch === "\u009d";
        } else output += ch;
      }
      return output;
    }
  };
}
