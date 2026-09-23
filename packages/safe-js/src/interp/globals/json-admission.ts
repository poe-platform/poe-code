import { Budget, SandboxError } from "../budget.js";

// JSON can expand into containers, property slots, source records and a second
// sandbox copy. Reserve a conservative bound in guest data units before any
// native tree is built. This deliberately includes whitespace and duplicate keys.
export function admitJson(text: string, budget: Budget): void {
  budget.visitNode(text.length);
  const reservation = {};
  const frames: { array: boolean; entries: number; expectingValue: boolean; leave: () => void }[] = [];
  try {
    budget.setRetainedDataUsage(reservation, text.length * 16 + 8);
    let quoted = false;
    let escaped = false;
    for (const character of text) {
      budget.visitNode();
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (" \t\r\n".includes(character)) continue;
      const frame = frames.at(-1);
      if (frame?.array && frame.expectingValue && character !== "]") {
        budget.allocateArrayLength(++frame.entries);
        frame.expectingValue = false;
      }
      if (character === '"') quoted = true;
      else if (character === "[" || character === "{") {
        // Also bound stack use when the caller supplies no call-depth limit.
        if (frames.length >= 256) throw new SandboxError({ budget: "dataDepth", current: frames.length + 1, limit: 256 });
        const leave = budget.enterCall();
        frames.push({ array: character === "[", entries: 0, expectingValue: true, leave });
      } else if (character === "]" || character === "}") frames.pop()?.leave();
      else if (character === "," && frame?.array) frame.expectingValue = true;
      else if (character === ":" && frame && !frame.array) budget.allocateCollectionEntries(++frame.entries);
    }
    // Grammar validation stays native, after admission. The scan never decodes
    // strings or builds objects, including for malformed input.
  } finally {
    for (const frame of frames) frame.leave();
    budget.setRetainedDataUsage(reservation, 0);
  }
}
