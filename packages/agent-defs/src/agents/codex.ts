import type { AgentDefinition } from "../types.js";

export const codexAgent: AgentDefinition = {
  id: "codex",
  name: "codex",
  label: "Codex",
  summary: "Configure Codex to use Poe as the model provider.",
  binaryName: "codex",
  apiShapes: ["openai-responses"],
  otelCapture: {
    args: (endpoint, content) => [
      "-c",
      `otel.trace_exporter={"otlp-http"={endpoint=${JSON.stringify(`${endpoint}/v1/traces`)},protocol="json"}}`,
      "-c",
      `otel.exporter={"otlp-http"={endpoint=${JSON.stringify(`${endpoint}/v1/logs`)},protocol="json"}}`,
      "-c",
      `otel.log_user_prompt=${content}`
    ]
  },
  configPath: "~/.codex/config.toml",
  branding: {
    colors: {
      dark: "#D5D9DF",
      light: "#7A7F86"
    }
  }
};
