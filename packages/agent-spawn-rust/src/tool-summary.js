import { native } from "./native.js";
import { stripAnsi } from "./design/index.js";
const verbDefinitions = native.spawnToolVerbs();
function stringField(input, ...keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
export function summarizeToolAction(tool) {
  const input = tool.input && typeof tool.input === "object" ? tool.input : {},
    detail = stringField(input, "command", "cmd") ?? tool.title;
  const execution = tool.kind === "exec" || tool.kind === "execute";
  const target = execution
    ? ""
    : (stringField(input, "file_path", "path", "pattern", "query") ?? tool.title);
  const query =
    !execution && tool.kind === "search" ? stringField(input, "pattern", "query") : undefined;
  const location = query ? stringField(input, "path") : undefined;
  const verbs = {...verbDefinitions};
  const inheritedVerb = !execution && verbs[tool.kind]
    ? String(verbs[tool.kind]) : undefined;
  const clean = stripAnsi(
    native.spawnToolSummary(
      execution ? "exec" : tool.kind,
      tool.title,
      detail,
      target,
      query,
      location,
      inheritedVerb
    )
  )
    .split("\n")
    .join(" ")
    .split("\r")
    .join(" ")
    .trim();
  const characters = Array.from(clean);
  return {
    label: characters.length > 100 ? characters.slice(0, 99).join("") + "…" : clean,
    detail
  };
}
