import { AsyncLocalStorage } from "node:async_hooks";
import { formatAgentPlan } from "./terminal.js";
import { resolveOutputFormat } from "./logging.js";
import { color } from "./color.js";
export { formatAgentPlan };
const storage = new AsyncLocalStorage(),
  defaultWriter = (line) => process.stdout.write(`${line}\n`);
export function getAcpWriter() {
  return storage.getStore() ?? defaultWriter;
}
export function withAcpWriter(writer, operation) {
  return storage.run(writer, operation);
}
export function renderAgentPlan(entries) {
  const format = resolveOutputFormat();
  if (format === "json") {
    getAcpWriter()(JSON.stringify({ event: "plan", entries }));
    return;
  }
  const plan = formatAgentPlan(entries),
    text = plan.detail ?? plan.text;
  if (format === "markdown") {
    const [heading, ...lines] = text.split("\n");
    getAcpWriter()([`**${heading}**`, ...lines.map((line) => `- ${line.trimStart()}`)].join("\n"));
  } else getAcpWriter()(color.dim(text));
}
