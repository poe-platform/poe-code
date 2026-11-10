export function parseDecimateGraph(graph: string, maps: string[]) {
  let expression = graph.trim();
  const inputs: { input: number; ordinal: number }[] = [];
  const labels: string[] = [];
  while (expression.startsWith("[")) {
    const end = expression.indexOf("]");
    if (end < 0) return undefined;
    labels.push(expression.slice(1, end));
    expression = expression.slice(end + 1).trim();
  }
  const name = expression.split("=", 1)[0]!.split(",", 1)[0]!.split("@", 1)[0]!.trim();
  if (name !== "decimate" || !labels.length) return undefined;
  if (labels.length > 2) throw new Error("decimate: expected one or two video input labels");
  for (const label of labels) {
    const [input, selector, ordinal = "0", ...extra] = label.split(":");
    if (selector !== "v" || extra.length || ![input, ordinal].every(value =>
      value && [...value].every(char => char >= "0" && char <= "9") && Number.isSafeInteger(Number(value)))) {
      throw new Error(`decimate: invalid video input label ${label}`);
    }
    inputs.push({ input: Number(input), ordinal: Number(ordinal) });
  }
  if (expression.endsWith("]")) {
    const start = expression.lastIndexOf("[");
    const output = expression.slice(start + 1, -1);
    if (start < 0 || !output || maps.length !== 1 || maps[0] !== `[${output}]`) {
      throw new Error("decimate: output label must be mapped exactly once");
    }
    expression = expression.slice(0, start).trim();
  } else if (maps.length) throw new Error("decimate: unsupported output map");
  return { inputs, expression };
}
