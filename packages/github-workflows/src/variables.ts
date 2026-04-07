import path from "node:path";
import { readFile } from "node:fs/promises";
import { isMap, parseDocument, stringify } from "yaml";

const VARIABLES_FILE_NAME = "variables.yaml";

const PROJECT_VARIABLES_HEADER = [
  "# Preview rendered prompt: poe-code github-workflows prompt-preview <name>",
  "#",
  "# Built-in defaults are shown below as comments.",
  "# To override a variable, uncomment it and replace the value.",
  '# To disable a variable, uncomment it and set it to empty string: ""',
  "# Variables left commented out keep the built-in default."
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeVariables(filePath: string, value: unknown): Record<string, string> {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid GitHub workflow variables in "${filePath}": expected a top-level object.`);
  }

  const result: Record<string, string> = {};

  for (const [key, itemValue] of Object.entries(value)) {
    if (typeof itemValue !== "string") {
      throw new Error(`Invalid GitHub workflow variables in "${filePath}": "${key}" must be a string.`);
    }
    result[key] = itemValue;
  }

  return result;
}

function parseVariablesDocument(filePath: string, content: string) {
  let document;

  try {
    document = parseDocument(content, { keepSourceTokens: true });
  } catch (error) {
    throw new Error(`Invalid GitHub workflow variables YAML in "${filePath}": ${getErrorMessage(error)}`);
  }

  if (document.errors.length > 0) {
    const [firstError] = document.errors;
    throw new Error(
      `Invalid GitHub workflow variables YAML in "${filePath}": ${firstError?.message ?? "Unknown YAML error."}`
    );
  }

  return document;
}

function parseVariables(filePath: string, content: string): Record<string, string> {
  return normalizeVariables(filePath, parseVariablesDocument(filePath, content).toJS());
}

function extractUserOverrideBlocks(
  filePath: string,
  content: string
): { variables: Record<string, string>; blocks: Record<string, string> } {
  const document = parseVariablesDocument(filePath, content);
  const variables = normalizeVariables(filePath, document.toJS());

  if (document.contents === null) {
    return { variables, blocks: {} };
  }

  if (!isMap(document.contents)) {
    throw new Error(`Invalid GitHub workflow variables in "${filePath}": expected a top-level object.`);
  }

  const blocks: Record<string, string> = {};
  const items = document.contents.items;

  for (const [index, item] of items.entries()) {
    const key = item.key?.toJSON();
    if (typeof key !== "string") {
      throw new Error(`Invalid GitHub workflow variables in "${filePath}": keys must be strings.`);
    }

    const start = item.key.range?.[0];
    const nextStart = items[index + 1]?.key?.range?.[0];
    if (typeof start !== "number") {
      blocks[key] = formatVariableBlock(key, variables[key]);
      continue;
    }

    const end = typeof nextStart === "number" ? nextStart : content.length;
    blocks[key] = content.slice(start, end).trimEnd();
  }

  return { variables, blocks };
}

async function readOptionalVariables(projectDir: string): Promise<Record<string, string>> {
  const filePath = path.join(projectDir, VARIABLES_FILE_NAME);

  try {
    return parseVariables(filePath, await readFile(filePath, "utf8"));
  } catch (error) {
    if (
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
}

function formatVariableBlock(name: string, value: string): string {
  return stringify({ [name]: value }).trimEnd();
}

function formatCommentedBlock(name: string, value: string): string {
  return formatVariableBlock(name, value)
    .split("\n")
    .map((line) => `# ${line}`)
    .join("\n");
}

export async function loadVariables(
  builtInDir: string,
  projectDir?: string
): Promise<Record<string, string>> {
  const builtInPath = path.join(builtInDir, VARIABLES_FILE_NAME);
  const builtInVariables = parseVariables(builtInPath, await readFile(builtInPath, "utf8"));
  const projectVariables = projectDir === undefined ? {} : await readOptionalVariables(projectDir);
  const merged = { ...builtInVariables, ...projectVariables };
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(merged)) {
    if (value === "") {
      continue;
    }
    result[key] = value;
  }

  return result;
}

export function generateProjectVariablesFile(
  builtInVariables: Record<string, string>,
  existingProjectFileContent?: string
): string {
  const userOverrides =
    existingProjectFileContent === undefined
      ? { variables: {}, blocks: {} }
      : extractUserOverrideBlocks(VARIABLES_FILE_NAME, existingProjectFileContent);

  const sections = [PROJECT_VARIABLES_HEADER];

  for (const [key, value] of Object.entries(builtInVariables)) {
    if (Object.prototype.hasOwnProperty.call(userOverrides.blocks, key)) {
      sections.push(userOverrides.blocks[key]);
      continue;
    }
    sections.push(formatCommentedBlock(key, value));
  }

  for (const [key, value] of Object.entries(userOverrides.variables)) {
    if (Object.prototype.hasOwnProperty.call(builtInVariables, key)) {
      continue;
    }
    sections.push(userOverrides.blocks[key] ?? formatVariableBlock(key, value));
  }

  return `${sections.join("\n\n")}\n`;
}
