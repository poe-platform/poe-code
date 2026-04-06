import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { AutomationDefinition } from "./types.js";

const VALID_AUTHOR_ASSOCIATIONS = new Set([
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "MANNEQUIN",
  "MEMBER",
  "NONE",
  "OWNER"
]);

export async function discoverAutomations(
  builtInDir: string,
  ...projectDirs: string[]
): Promise<AutomationDefinition[]> {
  const automationsByName = new Map<string, AutomationDefinition>();

  for (const automation of await readAutomationsFromDirectory(builtInDir)) {
    automationsByName.set(automation.name, automation);
  }

  for (const projectDir of projectDirs) {
    for (const automation of await readAutomationsFromDirectory(projectDir)) {
      automationsByName.set(automation.name, automation);
    }
  }

  return [...automationsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadAutomation(
  name: string,
  dirs: string[]
): Promise<AutomationDefinition | undefined> {
  for (const dir of dirs) {
    const fileNames = await listMarkdownFiles(dir);

    if (!fileNames.includes(`${name}.md`)) {
      continue;
    }

    return readAutomation(dir, `${name}.md`);
  }

  return undefined;
}

async function readAutomationsFromDirectory(dir: string): Promise<AutomationDefinition[]> {
  const fileNames = await listMarkdownFiles(dir);
  const automations = await Promise.all(fileNames.map((fileName) => readAutomation(dir, fileName)));
  return automations.sort((left, right) => left.name.localeCompare(right.name));
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((entry) => entry.endsWith(".md"))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }
}

async function readAutomation(dir: string, fileName: string): Promise<AutomationDefinition> {
  const content = await readFile(join(dir, fileName), "utf8");
  const { frontmatter, body } = parseFrontmatter(content);
  const name = fileName.slice(0, -3);

  return {
    name,
    prompt: body,
    ...readAutomationFields(frontmatter, fileName)
  };
}

function readAutomationFields(
  frontmatter: Record<string, unknown>,
  fileName: string
): Omit<AutomationDefinition, "name" | "prompt"> {
  const label = readOptionalString(frontmatter.label, "label", fileName);
  const source = readOptionalString(frontmatter.source, "source", fileName);
  const agent = readOptionalString(frontmatter.agent, "agent", fileName);
  const mcp = readOptionalMcp(frontmatter.mcp, fileName);
  const allow = readOptionalStringArray(frontmatter.allow, "allow", fileName);
  const prefix = readOptionalString(frontmatter.prefix, "prefix", fileName);

  return {
    ...(label === undefined ? {} : { label }),
    ...(source === undefined ? {} : { source }),
    ...(agent === undefined ? {} : { agent }),
    ...(mcp === undefined ? {} : { mcp }),
    ...(allow === undefined ? {} : { allow }),
    ...(prefix === undefined ? {} : { prefix })
  };
}

function readOptionalString(
  value: unknown,
  field: "label" | "source" | "agent" | "prefix",
  fileName: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Automation "${fileName}" has invalid "${field}" frontmatter. Expected a string.`);
  }

  if (field === "prefix" && (value.length === 0 || value.trim() !== value)) {
    throw new Error(
      `Automation "${fileName}" has invalid "${field}" frontmatter. Expected a non-empty string without surrounding whitespace.`
    );
  }

  return value;
}

function readOptionalStringArray(
  value: unknown,
  field: "allow",
  fileName: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(
      `Automation "${fileName}" has invalid "${field}" frontmatter. Expected an array of strings.`
    );
  }

  if (value.length === 0) {
    throw new Error(
      `Automation "${fileName}" has invalid "${field}" frontmatter. Expected at least one GitHub author association.`
    );
  }

  for (const item of value) {
    if (!VALID_AUTHOR_ASSOCIATIONS.has(item)) {
      throw new Error(
        `Automation "${fileName}" has invalid "${field}" frontmatter. Unsupported value "${item}".`
      );
    }
  }

  return value;
}

function readOptionalMcp(
  value: unknown,
  fileName: string
): AutomationDefinition["mcp"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Automation "${fileName}" has invalid "mcp" frontmatter. Expected an object.`);
  }

  const mcp: NonNullable<AutomationDefinition["mcp"]> = {};

  for (const [serverName, serverValue] of Object.entries(value)) {
    if (!isRecord(serverValue)) {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}" frontmatter. Expected an object.`
      );
    }

    const command = serverValue.command;
    if (typeof command !== "string") {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}.command" frontmatter. Expected a string.`
      );
    }

    const args = serverValue.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((item) => typeof item !== "string"))) {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}.args" frontmatter. Expected an array of strings.`
      );
    }

    const env = serverValue.env;
    if (env !== undefined && !isStringRecord(env)) {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}.env" frontmatter. Expected an object of strings.`
      );
    }

    mcp[serverName] = {
      command,
      ...(args === undefined ? {} : { args }),
      ...(env === undefined ? {} : { env })
    };
  }

  return mcp;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "string");
}
