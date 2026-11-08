import path from "node:path";
import { readFile } from "node:fs/promises";
import { resolve } from "@poe-code/config-extends";
import { isMap, parseDocument, stringify } from "yaml";
import { hasOwnErrorCode } from "./errors.js";

const VARIABLES_FILE_NAME = "variables.yaml";
const EXTENDS_FIELD_NAME = "extends";

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

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeVariables(
  filePath: string,
  value: unknown,
  options: { allowExtends?: boolean } = {}
): Record<string, string> {
  if (value === null || value === undefined) {
    return Object.create(null) as Record<string, string>;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid GitHub workflow variables in "${filePath}": expected a top-level object.`);
  }

  const result = Object.create(null) as Record<string, string>;

  for (const [key, itemValue] of Object.entries(value)) {
    if (options.allowExtends === true && key === EXTENDS_FIELD_NAME) {
      if (typeof itemValue !== "boolean") {
        throw new Error(`Invalid GitHub workflow variables in "${filePath}": "${key}" must be a boolean.`);
      }
      continue;
    }

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

function parseProjectVariables(
  filePath: string,
  content: string
): { extendsBuiltIns: boolean; variables: Record<string, string> } {
  const parsed = parseVariablesDocument(filePath, content).toJS();
  const extendsValue = isRecord(parsed) ? getOwnEntry(parsed, EXTENDS_FIELD_NAME) : undefined;

  return {
    extendsBuiltIns: extendsValue !== false,
    variables: normalizeVariables(filePath, parsed, { allowExtends: true })
  };
}

function extractUserOverrideBlocks(
  filePath: string,
  content: string
): { metadataBlocks: string[]; variables: Record<string, string>; blocks: Record<string, string> } {
  const document = parseVariablesDocument(filePath, content);
  const parsed = document.toJS();
  const variables = normalizeVariables(filePath, parsed, { allowExtends: true });

  if (document.contents === null) {
    return { metadataBlocks: [], variables, blocks: Object.create(null) as Record<string, string> };
  }

  if (!isMap(document.contents)) {
    throw new Error(`Invalid GitHub workflow variables in "${filePath}": expected a top-level object.`);
  }

  const metadataBlocks: string[] = [];
  const blocks = Object.create(null) as Record<string, string>;
  const items = document.contents.items;

  for (const [index, item] of items.entries()) {
    const key = item.key?.toJSON();
    if (typeof key !== "string") {
      throw new Error(`Invalid GitHub workflow variables in "${filePath}": keys must be strings.`);
    }

    const start = item.key.range?.[0];
    const nextStart = items[index + 1]?.key?.range?.[0];
    const parsedValue = isRecord(parsed) ? getOwnEntry(parsed, key) : undefined;
    const block =
      typeof start === "number"
        ? content.slice(start, typeof nextStart === "number" ? nextStart : content.length).trimEnd()
        : formatYamlBlock(key, typeof parsedValue === "string" || typeof parsedValue === "boolean" ? parsedValue : "");

    if (key === EXTENDS_FIELD_NAME) {
      metadataBlocks.push(block);
      continue;
    }

    if (typeof start !== "number") {
      blocks[key] = formatVariableBlock(key, variables[key]);
      continue;
    }

    blocks[key] = block;
  }

  return { metadataBlocks, variables, blocks };
}

async function readOptionalVariablesContent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function filterDisabledVariables(variables: Record<string, string>): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;

  for (const [key, value] of Object.entries(variables)) {
    if (value === "") {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function formatVariableBlock(name: string, value: string): string {
  return formatYamlBlock(name, value);
}

function formatYamlBlock(name: string, value: boolean | string | undefined): string {
  return stringify({ [name]: value }).trimEnd();
}

function formatCommentedBlock(name: string, value: string): string {
  return formatVariableBlock(name, value)
    .split("\n")
    .map((line) => `# ${line}`)
    .join("\n");
}

async function loadVariableSources(
  builtInDir: string,
  projectDir?: string
): Promise<{
  builtInVariables: Record<string, string>;
  extendsBuiltIns: boolean;
  projectVariables: Record<string, string>;
}> {
  const builtInPath = path.join(builtInDir, VARIABLES_FILE_NAME);
  const builtInVariables = parseVariables(builtInPath, await readFile(builtInPath, "utf8"));
  const projectVariablesPath = projectDir === undefined ? undefined : path.join(projectDir, VARIABLES_FILE_NAME);
  const projectVariablesContent =
    projectVariablesPath === undefined ? undefined : await readOptionalVariablesContent(projectVariablesPath);

  if (projectVariablesPath === undefined || projectVariablesContent === undefined) {
    return { builtInVariables, extendsBuiltIns: true, projectVariables: {} };
  }

  const { extendsBuiltIns, variables: projectVariables } = parseProjectVariables(
    projectVariablesPath,
    projectVariablesContent
  );

  return { builtInVariables, extendsBuiltIns, projectVariables };
}

export type VariableStatus = "default" | "overridden" | "disabled" | "custom";

export interface VariableStatusEntry {
  name: string;
  source: string;
  status: VariableStatus;
}

export async function loadVariables(
  builtInDir: string,
  projectDir?: string
): Promise<Record<string, string>> {
  const builtInPath = path.join(builtInDir, VARIABLES_FILE_NAME);
  const builtInContent = await readFile(builtInPath, "utf8");
  const builtInVariables = parseVariables(builtInPath, builtInContent);

  if (projectDir === undefined) {
    return filterDisabledVariables(builtInVariables);
  }

  const projectVariablesPath = path.join(projectDir, VARIABLES_FILE_NAME);
  const projectVariablesContent = await readOptionalVariablesContent(projectVariablesPath);

  if (projectVariablesContent === undefined) {
    return filterDisabledVariables(builtInVariables);
  }

  parseProjectVariables(projectVariablesPath, projectVariablesContent);

  const resolved = await resolve(
    [
      {
        source: "document",
        filePath: projectVariablesPath,
        content: projectVariablesContent
      },
      {
        source: "base",
        path: builtInDir
      }
    ],
    {
      fs: { readFile },
      autoExtend: true
    }
  );

  return filterDisabledVariables(normalizeVariables(projectVariablesPath, resolved.data));
}

export async function loadVariableStatuses(
  builtInDir: string,
  projectDir?: string
): Promise<VariableStatusEntry[]> {
  const { builtInVariables, extendsBuiltIns, projectVariables } = await loadVariableSources(builtInDir, projectDir);
  const orderedNames = [
    ...(extendsBuiltIns ? Object.keys(builtInVariables) : []),
    ...Object.keys(projectVariables).filter(
      (key) => !extendsBuiltIns || !Object.prototype.hasOwnProperty.call(builtInVariables, key)
    )
  ];
  const projectVariablesPath = projectDir === undefined ? undefined : path.join(projectDir, VARIABLES_FILE_NAME);

  return orderedNames.map((name) => {
    if (!Object.prototype.hasOwnProperty.call(projectVariables, name)) {
      return {
        name,
        source: "built-in",
        status: "default"
      };
    }

    if (projectVariables[name] === "") {
      return {
        name,
        source: projectVariablesPath ?? "built-in",
        status: "disabled"
      };
    }

    return {
      name,
      source: projectVariablesPath ?? "built-in",
      status: Object.prototype.hasOwnProperty.call(builtInVariables, name) ? "overridden" : "custom"
    };
  });
}

export function generateProjectVariablesFile(
  builtInVariables: Record<string, string>,
  existingProjectFileContent?: string
): string {
  const userOverrides =
    existingProjectFileContent === undefined
      ? {
          metadataBlocks: [],
          variables: Object.create(null) as Record<string, string>,
          blocks: Object.create(null) as Record<string, string>
        }
      : extractUserOverrideBlocks(VARIABLES_FILE_NAME, existingProjectFileContent);

  const sections = [PROJECT_VARIABLES_HEADER, ...userOverrides.metadataBlocks];

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
