import type { TemplateLoader } from "@poe-code/config-mutations";
import { readFile } from "node:fs/promises";

const TEMPLATE_NAMES = ["poe-generate.md", "terminal-pilot.md"] as const;

let templatesCache: Record<string, string> | null = null;

async function getTemplates(): Promise<Record<string, string>> {
  if (templatesCache) {
    return templatesCache;
  }
  const entries = await Promise.all(
    TEMPLATE_NAMES.map(async (name) => {
      const url = new URL(`./templates/${name}`, import.meta.url);
      return [name, await readFile(url, "utf8")] as const;
    })
  );
  templatesCache = Object.fromEntries(entries);
  return templatesCache;
}

export async function loadTemplate(templateId: string): Promise<string> {
  const templates = await getTemplates();
  const template = templates[templateId];
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return template;
}

export function createTemplateLoader(): TemplateLoader {
  return loadTemplate;
}
