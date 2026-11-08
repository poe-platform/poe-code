/** Decode Matroska's ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text packet. */
export function decodeMatroskaAss(packet: string): string {
  let start = 0;
  for (let field = 0; field < 8; field++) {
    const comma = packet.indexOf(",", start);
    if (comma < 0) throw new Error("Invalid Matroska ASS packet");
    start = comma + 1;
  }
  const text = packet.slice(start);
  const active: string[] = [];
  let result = "";
  const close = (tag: string) => {
    const index = active.indexOf(tag);
    if (index < 0) return;
    for (let i = active.length - 1; i >= index; i--) result += `</${active[i]}>`;
    active.splice(index, 1);
    for (let i = index; i < active.length; i++) result += `<${active[i]}>`;
  };
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{\\", i)) {
      const end = text.indexOf("}", i + 2);
      if (end >= 0) {
        for (const command of text.slice(i + 1, end).split("\\")) {
          const tag = command[0]!;
          if (["i", "b", "u", "s"].includes(tag) && ["0", "1", "-1"].includes(command.slice(1))) {
            if (command.slice(1) === "0") close(tag);
            else if (!active.includes(tag)) { active.push(tag); result += `<${tag}>`; }
          } else if (tag === "r") {
            while (active.length) close(active.at(-1)!);
          }
        }
        i = end;
        continue;
      }
    }
    if (text[i] === "\\" && ["N", "n", "h"].includes(text[i + 1]!)) {
      result += text[++i] === "h" ? "\u00a0" : "\n";
    } else result += text[i];
  }
  while (active.length) close(active.at(-1)!);
  return result;
}
