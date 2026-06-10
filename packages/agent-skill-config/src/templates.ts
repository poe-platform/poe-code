import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateLoader } from "@poe-code/config-mutations";
import { hasOwnErrorCode } from "./error-codes.js";

const TEMPLATE_IDS = ["poe-generate.md", "terminal-pilot.md"] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

const cache = new Map<TemplateId, string>();

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function findPackageRoot(entryFilePath: string): Promise<string> {
  let current = path.dirname(entryFilePath);
  while (true) {
    if (await pathExists(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate package root for agent-skill-config templates.");
    }
    current = parent;
  }
}

async function resolveTemplatePath(templateId: TemplateId): Promise<string> {
  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(packageRoot, "src", "templates", templateId),
    path.join(packageRoot, "dist", "templates", templateId),
    path.join(packageRoot, "dist", "templates", "skill", templateId)
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Template not found: ${templateId}`);
}

function isKnownTemplate(templateId: string): templateId is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(templateId);
}

export async function loadTemplate(templateId: string): Promise<string> {
  if (!isKnownTemplate(templateId)) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const cached = cache.get(templateId);
  if (cached !== undefined) {
    return cached;
  }

  const resolved = await resolveTemplatePath(templateId);
  const content = await readFile(resolved, "utf8");
  cache.set(templateId, content);
  return content;
}

export function createTemplateLoader(): TemplateLoader {
  return loadTemplate;
}
