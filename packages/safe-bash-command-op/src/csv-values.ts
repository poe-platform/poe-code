export function parseOpCsv(value: string): string[] {
  if (value === "") return [];
  let input = "";
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\r" && (value[index + 1] === "\n" || index === value.length - 1)) continue;
    input += value[index];
  }
  let cursor = 0;
  while (input[cursor] === "\n") cursor++;
  if (cursor === input.length) throw new Error("CSV flag requires a record");
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (; cursor < input.length; cursor++) {
    const character = input[cursor]!;
    if (quoted) {
      if (character !== '"') field += character;
      else if (input[cursor + 1] === '"') { field += '"'; cursor++; }
      else { quoted = false; closed = true; }
    } else if (character === "\n") return [...fields, field];
    else if (character === ",") { fields.push(field); field = ""; closed = false; }
    else if (closed || character === '"' && field.length !== 0) throw new Error("Invalid CSV quoting");
    else if (character === '"') quoted = true;
    else field += character;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  return [...fields, field];
}
