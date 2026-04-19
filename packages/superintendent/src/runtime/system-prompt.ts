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
    "You operate inside an autonomous build-inspect-review loop. The runtime observes your tool calls to advance the workflow — narrative text is NOT acted on. A decision is only recorded when you call the corresponding tool.",
    "",
    "## workflow.transition — control flow (required when work is ready)",
    "",
    "Call this to hand off to the owner:",
    "",
    '- `workflow.transition({ action: "request_review", summary: "<why the work is ready>" })`',
    "",
    "Without this call, the loop will start another builder round. Do not narrate readiness in text — always call the tool.",
    "",
    "## builder.run — spawn the builder mid-round (optional)",
    "",
    "Call this to run the builder with a custom prompt without waiting for the next auto-run round:",
    "",
    '- `builder.run({ prompt: "<full builder prompt>" })`',
    "",
    "The prompt replaces the configured `builder.prompt` template for this call only."
  ];

  if (input.inspectorNames.length > 0) {
    sections.push(
      "",
      "## inspector.run — re-run an inspector mid-round (optional)",
      "",
      "Call this to re-run a specific inspector (e.g. to verify a fix):",
      "",
      `- \`inspector.run({ name: "<inspector-name>", prompt?: "<override>" })\` — available inspectors: ${input.inspectorNames.join(", ")}.`
    );
  }

  return sections.join("\n");
}

export function buildOwnerSystemPrompt(): string {
  return [
    "# System",
    "",
    "You are the owner reviewing the superintendent's work. The runtime observes your tool calls — narrative text is NOT acted on. You MUST end your turn with `workflow.transition`:",
    "",
    '- `workflow.transition({ action: "approve_completion" })` — accept the work. Ends the loop.',
    '- `workflow.transition({ action: "request_changes", feedback: "<what needs to change>" })` — send the work back; the loop continues with a new builder round.'
  ].join("\n");
}

export function prependSystemPrompt(systemPrompt: string, userPrompt: string): string {
  return systemPrompt + "\n\n# Task\n\n" + userPrompt;
}
