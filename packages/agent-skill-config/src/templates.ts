import type { TemplateLoader } from "@poe-code/config-mutations";
import poeGenerateTemplate from "./templates/poe-generate.md";
import terminalPilotTemplate from "./templates/terminal-pilot.md";

const templates: Record<string, string> = {
  "poe-generate.md": poeGenerateTemplate,
  "terminal-pilot.md": terminalPilotTemplate,
};

export async function loadTemplate(templateId: string): Promise<string> {
  const template = templates[templateId];
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return template;
}

export function createTemplateLoader(): TemplateLoader {
  return loadTemplate;
}
