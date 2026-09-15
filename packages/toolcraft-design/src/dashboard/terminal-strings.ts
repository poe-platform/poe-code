// Normal SGR/cursor sequences are short; malformed controls must not grow retained state.
const MAX_CONTROL_SEQUENCE_CHARS = 1_024;

/** Remove nonprinting strings and retain complete CSI controls before presentation trims them. */
export function createTerminalStringFilter(): { push(text: string): string } {
  let hidden = false;
  let allowBell = false;
  let escape = false;
  let csi: string | undefined;
  let oversizedCsi = false;
  return {
    push(text) {
      if (!hidden && !escape && csi === undefined && !text.includes("\u001b") && !text.includes("\u009b") && !text.includes("\u0090") &&
          !text.includes("\u0098") && !text.includes("\u009d") && !text.includes("\u009e") && !text.includes("\u009f")) return text;
      let output = "";
      for (const ch of text) {
        if ((ch === "\u0018" || ch === "\u001a") && (hidden || escape || csi !== undefined)) {
          hidden = false;
          escape = false;
          csi = undefined;
          oversizedCsi = false;
          continue;
        }
        if (csi !== undefined) {
          if (ch === "\u001b") {
            csi = undefined;
            oversizedCsi = false;
            escape = true;
            continue;
          }
          if (!oversizedCsi) {
            csi += ch;
            if (csi.length > MAX_CONTROL_SEQUENCE_CHARS) {
              oversizedCsi = true;
              csi = "";
            }
          }
          const code = ch.charCodeAt(0);
          if (code >= 0x40 && code <= 0x7e) {
            if (!oversizedCsi) output += csi;
            csi = undefined;
            oversizedCsi = false;
          }
          continue;
        }
        if (hidden) {
          if (ch === "\u009c" || (allowBell && ch === "\u0007") || (escape && ch === "\\")) {
            hidden = false;
            escape = false;
          } else escape = ch === "\u001b";
          continue;
        }
        if (escape) {
          escape = false;
          if (ch === "[") {
            csi = "\u001b[";
            continue;
          }
          if (ch === "]" || ch === "P" || ch === "X" || ch === "^" || ch === "_") {
            hidden = true;
            allowBell = ch === "]";
            continue;
          }
          output += "\u001b";
        }
        if (ch === "\u001b") escape = true;
        else if (ch === "\u009b") csi = ch;
        else if (ch === "\u0090" || ch === "\u0098" || ch === "\u009d" || ch === "\u009e" || ch === "\u009f") {
          hidden = true;
          allowBell = ch === "\u009d";
        } else output += ch;
      }
      return output;
    }
  };
}

/** Advance a tail boundary past a control if it would retain only its parameters. */
export function terminalControlTailStart(text: string, start: number): number {
  if (!text.includes("\u001b") && !text.includes("\u009b")) return start;
  for (let index = 0; index < start; index++) {
    const ch = text[index];
    if (ch !== "\u001b" && ch !== "\u009b") continue;
    let end = index + 1;
    if (ch === "\u009b" || text[end] === "[") {
      if (ch === "\u001b") end++;
      while (end < text.length) {
        const code = text.charCodeAt(end);
        if (code >= 0x40 && code <= 0x7e) break;
        end++;
      }
    }
    if (start <= end) return Math.min(end + 1, text.length);
    index = end;
  }
  return start;
}
