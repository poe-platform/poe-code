/** Parse the concise schema language shared by the CLI and SDK. */
export function parseLlmSchemaDsl(input: string, multi = false): Record<string, unknown> {
  const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const required: string[] = [];
  const types: Record<string, string> = { int: "integer", float: "number", bool: "boolean", str: "string" };
  for (const field of input.split(input.includes("\n") ? "\n" : ",").map(value => value.trim()).filter(Boolean)) {
    const colon = field.indexOf(":");
    const info = (colon < 0 ? field : field.slice(0, colon)).trim();
    const description = colon < 0 ? "" : field.slice(colon + 1).trim();
    const parts: string[] = [];
    let word = "";
    for (const character of info) {
      if (character.trim() === "") { if (word) parts.push(word); word = ""; }
      else word += character;
    }
    if (word) parts.push(word);
    const name = parts[0];
    if (!name) throw new Error("Schema field requires a name");
    const indicator = parts[1] ?? "str";
    const type = Object.hasOwn(types, indicator) ? types[indicator] : "string";
    properties[name] = { type, ...(description ? { description } : {}) };
    required.push(name);
  }
  const schema = { type: "object", properties, required };
  return multi ? { type: "object", properties: { items: { type: "array", items: schema } }, required: ["items"] } : schema;
}
