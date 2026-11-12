/** Decode leading MicroDVD directives; lowercase directives end at a line break. */
export function decodeMicrodvd(text: string): string {
  const directives = new Map<string, string>();
  let opened: string[] = [];
  let result = "";
  const tags = () => {
    const style = (directives.get("Y") ?? "") + (directives.get("y") ?? "");
    const output: string[] = [];
    // Line-local fonts nest inside persistent fonts so inherited values survive.
    for (const [colorKey, faceKey, sizeKey] of [["C", "F", "S"], ["c", "f", "s"]] as const) {
      const color = directives.get(colorKey);
      if (color) output.push(`<font color="#${color}">`);
      const face = directives.get(faceKey);
      if (face) output.push(`<font face="${face}">`);
      const size = directives.get(sizeKey);
      if (size) output.push(`<font size="${size}">`);
    }
    output.push(...["i", "b", "u", "s"].filter(tag => style.includes(tag)).map(tag => `<${tag}>`));
    return output;
  };
  const transition = (next: string[]) => {
    let common = 0;
    while (common < opened.length && opened[common] === next[common]) common++;
    for (let index = opened.length - 1; index >= common; index--) {
      result += opened[index]!.startsWith("<font ") ? "</font>" : `</${opened[index]![1]}>`;
    }
    result += next.slice(common).join("");
    opened = next;
  };
  const lines = text.split("|");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    let position = 0;
    let alignment = "";
    while (line[position] === "{" && line[position + 2] === ":") {
      const end = line.indexOf("}", position + 3);
      if (end < 0) break;
      const name = line[position + 1]!;
      const key = name.toLowerCase();
      let value = line.slice(position + 3, end);
      if (name === "H") {
        position = end + 1;
        continue;
      }
      if (name === "P" || name === "o") {
        const values = value.split(",");
        if (values.length !== (name === "P" ? 1 : 2)
          || values.some(part => !part.trim() || !Number.isInteger(Number(part)))) break;
        if (name === "P") alignment = Number(values[0]) === 1 ? "" : "{\\an8}";
        position = end + 1;
        continue;
      }
      if (!["y", "c", "f", "s"].includes(key)) break;
      if (key === "c") {
        const hex = value.startsWith("$") ? value.slice(1) : value;
        if (!hex.length || hex.length > 6 || !Array.from(hex.toLowerCase()).every(char => "0123456789abcdef".includes(char))) break;
        const bgr = hex.padStart(6, "0").toLowerCase();
        value = bgr.slice(4, 6) + bgr.slice(2, 4) + bgr.slice(0, 2);
      }
      if (key === "s" && (!value.length || !Array.from(value).every(char => char >= "0" && char <= "9"))) break;
      if (key === "y") value = (directives.get(name) ?? "") + value;
      directives.set(name, value);
      position = end + 1;
    }
    const lineTags = tags();
    if (line[position] === "/") {
      position++;
      if (line[position] === "/") position++;
      if (!lineTags.includes("<i>")) lineTags.push("<i>");
    }
    transition(lineTags);
    result += alignment + line.slice(position).replaceAll("\\N", "\n").replaceAll("\\n", "\n");
    for (const key of directives.keys()) {
      if (key === key.toLowerCase()) directives.delete(key);
    }
    transition(index === lines.length - 1 ? [] : tags());
    if (index < lines.length - 1) result += "\n";
  }
  return result;
}
