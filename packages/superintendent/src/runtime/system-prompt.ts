import type { StatusBlock } from "../document/parse.js";

type SuperintendentSystemPromptInput = {
  state: StatusBlock["state"];
  inspectorNames: string[];
};

export function buildSuperintendentSystemPrompt(
  input: SuperintendentSystemPromptInput
): string {
  const sections: string[] = [
    "# System",
    "",
    "You operate inside an autonomous build-inspect-review loop. The runtime advances only when you invoke MCP tools — narrative text is NOT observed. A decision is only recorded when you call the corresponding tool.",
    "",
    "## `workflow_transition` — control flow (required when work is ready)",
    "",
    "Invoke the `workflow_transition` MCP tool to hand off to the owner:",
    "",
    '- arguments: `{ "action": "request_review", "summary": "<why the work is ready>" }`',
    "",
    "Without this tool call, the loop starts another builder round. Do not narrate readiness — always invoke the tool.",
    "",
    "## `builder_run` — spawn the builder mid-round (optional)",
    "",
    "Invoke the `builder_run` MCP tool to run the builder with a custom prompt without waiting for the next auto-run round:",
    "",
    '- arguments: `{ "prompt": "<full builder prompt>" }`',
    "",
    "The prompt replaces the configured `builder.prompt` template for this call only."
  ];

  if (input.inspectorNames.length > 0) {
    sections.push(
      "",
      "## `inspector_run` — re-run an inspector mid-round (optional)",
      "",
      "Invoke the `inspector_run` MCP tool to re-run a specific inspector (e.g. to verify a fix):",
      "",
      `- arguments: \`{ "name": "<inspector-name>", "prompt"?: "<override>" }\` — available inspectors: ${input.inspectorNames.join(", ")}.`
    );
  }

  return sections.join("\n");
}

export function buildOwnerSystemPrompt(): string {
  return [
    "# System",
    "",
    "You are the owner reviewing the superintendent's work. The runtime advances only when you invoke MCP tools — narrative text is NOT observed. You MUST end your turn by invoking the `workflow_transition` MCP tool:",
    "",
    '- arguments: `{ "action": "approve_completion" }` — accept the work. Ends the loop.',
    '- arguments: `{ "action": "request_changes", "feedback": "<what needs to change>" }` — send the work back; the loop continues with a new builder round.'
  ].join("\n");
}

export function prependSystemPrompt(systemPrompt: string, userPrompt: string): string {
  return systemPrompt + "\n\n# Task\n\n" + userPrompt;
}
