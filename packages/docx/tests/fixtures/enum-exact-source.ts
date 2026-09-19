export const enumSourceCases = [
  { row: 849, action: "class-reject", member: "__class__" },
  { row: 850, action: "class-reject", member: "__repr__" },
  { row: 851, action: "class-reject", member: "__mro__" },
  { row: 852, action: "to-symbol", expected: "center" },
  { row: 853, action: "to-number", expected: "right" },
  { row: 854, action: "invalid-number" },
  { row: 855, action: "from-xml", expected: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "RIGHT" } },
  { row: 856, action: "from-null", expected: { enum: "WD_UNDERLINE", name: "INHERITED" } },
  { row: 857, action: "invalid-xml" },
  { row: 858, action: "typed-member", expected: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" } },
  { row: 859, action: "string-right", expected: "RIGHT (2)" },
  { row: 860, action: "string-center", expected: "CENTER (1)" },
  { row: 861, action: "value", expected: 1 },
  { row: 862, action: "name", expected: "CENTER" },
  { row: 863, action: "class-reject", member: "__doc__" },
  { row: 864, action: "equality", expected: [1, 2] }
] as const;
export function enumSourceOperations(c: typeof enumSourceCases[number]) {
  const base = "model.enum.text.WD_PARAGRAPH_ALIGNMENT", ref = (resultHandle: string) => ({ resultHandle });
  if (c.action === "class-reject") return [{ operation: `model.enum.base.BaseXmlEnum.${c.member}.get`, arguments: {} }];
  if (c.action === "from-xml" || c.action === "from-null" || c.action === "invalid-xml") return [{ operation: `${c.action === "from-null" ? "model.enum.text.WD_UNDERLINE" : base}.from_xml.call`, arguments: { xmlValue: c.action === "from-null" ? null : c.action === "invalid-xml" ? "baz" : "right" } }];
  const ops: { operation: string; receiver?: { resultHandle: string }; arguments: Record<string, unknown>; resultHandle?: string }[] = [{ operation: `${base}.${c.action === "string-right" ? "RIGHT" : "CENTER"}.get`, arguments: {}, resultHandle: "symbol" }];
  if (["to-symbol", "to-number", "invalid-number"].includes(c.action)) ops.push({ operation: `${base}.to_xml.call`, receiver: ref("symbol"), arguments: { value: c.action === "to-symbol" ? ref("symbol") : c.action === "to-number" ? 2 : 42 } });
  else if (c.action === "typed-member") return ops;
  else if (c.action === "string-right" || c.action === "string-center") ops.push({ operation: `${base}.__str__.call`, receiver: ref("symbol"), arguments: {} });
  else if (c.action === "equality") ops.push({ operation: `${base}.value.get`, receiver: ref("symbol"), arguments: {} }, { operation: `${base}.RIGHT.get`, arguments: {}, resultHandle: "other" }, { operation: `${base}.value.get`, receiver: ref("other"), arguments: {} });
  else ops.push({ operation: `${base}.${c.action}.get`, receiver: ref("symbol"), arguments: {} });
  return ops;
}
