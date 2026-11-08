import type { TemplateLoader } from "@poe-code/config-mutations";
import { templates } from "#skill-templates";

export async function loadTemplate(templateId: string): Promise<string> {
  if (!Object.hasOwn(templates, templateId)) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return templates[templateId];
}

export function createTemplateLoader(): TemplateLoader {
  return loadTemplate;
}
