import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "@poe-code/config-extends";
import { hasOwnErrorCode } from "./errors.js";
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
  const directories = [builtInDir, ...projectDirs];
  const fileNamesByDirectory = await Promise.all(
    directories.map(async (dir) => [dir, await listMarkdownFiles(dir)] as const)
  );
  const names = new Set<string>();

  for (const [, fileNames] of fileNamesByDirectory) {
    for (const fileName of fileNames) {
      names.add(stripPrefix(fileName.slice(0, -3)));
    }
  }

  const precedenceDirs = [...projectDirs].reverse().concat(builtInDir);
  const automations = await Promise.all([...names].map((name) => loadAutomation(name, precedenceDirs)));

  return automations
    .filter((automation): automation is AutomationDefinition => automation !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadAutomation(
  name: string,
  dirs: string[]
): Promise<AutomationDefinition | undefined> {
  for (const [index, dir] of dirs.entries()) {
    const fileNames = await listMarkdownFiles(dir);
    const prefixed = `poe-code-${name}.md`;
    const unprefixed = `${name}.md`;
    const fileName = fileNames.includes(prefixed) ? prefixed : fileNames.includes(unprefixed) ? unprefixed : undefined;

    if (fileName === undefined) {
      continue;
    }

    const baseName = fileName === prefixed ? name : undefined;
    return readAutomation(dir, fileName, baseName, dirs.slice(index + 1));
  }

  return undefined;
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

async function readAutomation(
  dir: string,
  fileName: string,
  baseName: string | undefined,
  baseDirs: string[]
): Promise<AutomationDefinition> {
  const filePath = join(dir, fileName);
  const content = await readFile(filePath, "utf8");
  const resolved = await resolve(
    [
      {
        source: "document",
        filePath,
        content,
        ...(baseName !== undefined ? { baseName } : {})
      },
      ...baseDirs.map((baseDir) => ({
        source: "base",
        path: baseDir
      })),
      {
        source: "defaults",
        data: {
          agent: "codex"
        }
      }
    ],
    {
      fs: { readFile }
    }
  );
  const name = stripPrefix(fileName.slice(0, -3));

  return {
    name,
    prompt: readPrompt(getOwnEntry(resolved.data, "prompt"), fileName),
    ...readAutomationFields(resolved.data, fileName)
  };
}

function readPrompt(value: unknown, fileName: string): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  throw new Error(`Automation "${fileName}" has invalid "prompt" content. Expected a string.`);
}

function readAutomationFields(
  frontmatter: Record<string, unknown>,
  fileName: string
): Omit<AutomationDefinition, "name" | "prompt"> {
  const label = readOptionalString(getOwnEntry(frontmatter, "label"), "label", fileName);
  const source = readOptionalString(getOwnEntry(frontmatter, "source"), "source", fileName);
  const agent = readOptionalString(getOwnEntry(frontmatter, "agent"), "agent", fileName);
  const mcp = readOptionalMcp(getOwnEntry(frontmatter, "mcp"), fileName);
  const allow = readOptionalStringArray(getOwnEntry(frontmatter, "allow"), "allow", fileName);
  const prefix = readOptionalPrefix(getOwnEntry(frontmatter, "prefix"), fileName);

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
  field: "label" | "source" | "agent",
  fileName: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Automation "${fileName}" has invalid "${field}" frontmatter. Expected a string.`);
  }
  return value;
}

function readOptionalPrefix(
  value: unknown,
  fileName: string
): AutomationDefinition["prefix"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    validatePrefixValue(value, fileName, "Expected a non-empty string without surrounding whitespace.");
    return value;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(
      `Automation "${fileName}" has invalid "prefix" frontmatter. Expected a string or an array of strings.`
    );
  }

  if (value.length === 0) {
    throw new Error(
      `Automation "${fileName}" has invalid "prefix" frontmatter. Expected at least one string.`
    );
  }

  for (const item of value) {
    validatePrefixValue(item, fileName, "Expected non-empty strings without surrounding whitespace.");
  }

  return value;
}

function validatePrefixValue(
  value: string,
  fileName: string,
  expectation: string
): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(
      `Automation "${fileName}" has invalid "prefix" frontmatter. ${expectation}`
    );
  }
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

    const command = getOwnEntry(serverValue, "command");
    if (typeof command !== "string") {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}.command" frontmatter. Expected a string.`
      );
    }

    const args = getOwnEntry(serverValue, "args");
    if (args !== undefined && (!Array.isArray(args) || args.some((item) => typeof item !== "string"))) {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}.args" frontmatter. Expected an array of strings.`
      );
    }

    const env = getOwnEntry(serverValue, "env");
    if (env !== undefined && !isStringRecord(env)) {
      throw new Error(
        `Automation "${fileName}" has invalid "mcp.${serverName}.env" frontmatter. Expected an object of strings.`
      );
    }

    defineDataProperty(mcp, serverName, {
      command,
      ...(args === undefined ? {} : { args }),
      ...(env === undefined ? {} : { env })
    });
  }

  return mcp;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "string");
}

const POE_CODE_PREFIX = "poe-code-";

function stripPrefix(name: string): string {
  return name.startsWith(POE_CODE_PREFIX) ? name.slice(POE_CODE_PREFIX.length) : name;
}
