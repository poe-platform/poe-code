import { formatAgentPlan } from "./terminal.js";
import { resolveOutputFormat } from "./logging.js";
import { color } from "./color.js";
export { formatAgentPlan };
import { getAcpWriter } from "./acp-writer.js";
export { getAcpWriter, withAcpWriter } from "./acp-writer.js";
export {
  renderToolStart,
  renderToolComplete,
  renderReasoning,
  renderUsage,
  renderError,
  renderPermissionRejected
} from "./acp-events.js";
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
