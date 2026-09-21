import { createRequire } from "node:module";
import { color } from "./color.js";
import { resolveOutputFormat } from "./logging.js";
import { getAcpWriter } from "./acp-writer.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
function writeEvent(event, format, first, second = "", cached = "", cost = "") {
  const [style, text] = native.designAcpEvent(
    event,
    format === "markdown",
    first,
    second,
    cached,
    cost
  );
  getAcpWriter()(style ? color[style](text) : text);
}
export function renderToolStart(kind, title) {
  const format = resolveOutputFormat();
  if (format === "json") getAcpWriter()(JSON.stringify({ event: "tool_start", kind, title }));
  else writeEvent("tool_start", format, kind, title);
}
export function renderToolComplete(kind) {
  const format = resolveOutputFormat();
  if (format === "json") getAcpWriter()(JSON.stringify({ event: "tool_complete", kind }));
  else writeEvent("tool_complete", format, kind);
}
export function renderReasoning(text) {
  const format = resolveOutputFormat();
  if (format === "json") getAcpWriter()(JSON.stringify({ event: "reasoning", text }));
  else writeEvent("reasoning", format, text);
}
export function renderError(message) {
  const format = resolveOutputFormat();
  if (format === "json") getAcpWriter()(JSON.stringify({ event: "error", message }));
  else writeEvent("error", format, message);
}
export function renderPermissionRejected(title) {
  const format = resolveOutputFormat();
  if (format === "json") getAcpWriter()(JSON.stringify({ event: "permission_rejected", title }));
  else writeEvent("permission_rejected", format, title);
}
export function renderUsage(tokens) {
  const format = resolveOutputFormat();
  const cached =
    typeof tokens.cached === "number" && tokens.cached > 0 ? ` (${tokens.cached} cached)` : "";
  let cost = "";
  if (typeof tokens.costUsd === "number")
    cost = ` (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(tokens.costUsd)})`;
  if (format === "json") {
    getAcpWriter()(
      JSON.stringify({
        event: "usage",
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cachedTokens: tokens.cached ?? 0,
        costUsd: tokens.costUsd ?? 0
      })
    );
    return;
  }
  if (format !== "markdown") getAcpWriter()("");
  writeEvent("usage", format, `${tokens.input}`, `${tokens.output}`, cached, cost);
}
