import path from "node:path";
import {
  parseDocument as parseConfigDocument,
  resolve as resolveConfigExtends
} from "@poe-code/config-extends";
import { FrontmatterParseError, parseFrontmatterDocument } from "@poe-code/frontmatter";
export type { TaskBoard, TaskItem } from "./tasks.js";

type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

type JsonSchema = {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: JsonSchemaType | readonly JsonSchemaType[];
  const?: unknown;
  default?: unknown;
  enum?: readonly unknown[];
  minimum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
};

export type SuperintendentDoc = {
  frontmatter: SuperintendentFrontmatter;
  body: string;
  filePath: string;
};

export interface SuperintendentDocumentFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
}

export type ResolvedSuperintendentDoc = {
  document: SuperintendentDoc;
  extendsPath?: string;
  frontmatterData: Record<string, unknown>;
};

export type SuperintendentFrontmatter = {
  kind: "superintendent";
  version: number;
  mcp?: Record<string, McpConfig>;
  builder: AgentRoleConfig;
  inspectors?: Record<string, AgentRoleConfig>;
  superintendent: AgentRoleConfig;
  owner: AgentRoleConfig;
  max_rounds?: number;
  status: StatusBlock;
};

export type AgentRoleConfig = {
  agent: string;
  mode?: string;
  cwd?: string;
  mcp?: Record<string, McpConfig>;
  prompt: string;
};

export type McpConfig = {
  command: string;
  args?: string[];
  timeout?: number;
};

export type StatusBlock = {
  state: "in_progress" | "review" | "completed";
  round: number;
  review_turn: number;
};

export const superintendentDocumentSchemaId =
  "https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json";
export const superintendentBaseDocumentSchemaId =
  "https://poe-platform.github.io/poe-code/schemas/plans/superintendent-base.schema.json";

const mcpConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    command: {
      type: "string",
      minLength: 1
    },
    args: {
      type: "array",
      items: {
        type: "string"
      }
    },
    timeout: {
      type: "number",
      exclusiveMinimum: 0
    }
  },
  required: ["command"],
  additionalProperties: false
};

const agentRoleSchema: JsonSchema = {
  type: "object",
  properties: {
    agent: {
      type: "string",
      minLength: 1,
      default: "claude-code"
    },
    mode: {
      type: "string",
      minLength: 1
    },
    cwd: {
      type: "string",
      minLength: 1
    },
    mcp: {
      type: "object",
      additionalProperties: mcpConfigSchema
    },
    prompt: {
      type: "string",
      minLength: 1
    }
  },
  required: ["prompt"],
  additionalProperties: false
};

const partialAgentRoleSchema: JsonSchema = {
  type: "object",
  properties: {
    agent: {
      type: "string",
      minLength: 1,
      default: "claude-code"
    },
    mode: {
      type: "string",
      minLength: 1
    },
    cwd: {
      type: "string",
      minLength: 1
    },
    mcp: {
      type: "object",
      additionalProperties: mcpConfigSchema
    },
    prompt: {
      type: "string",
      minLength: 1
    }
  },
  additionalProperties: false
};

const statusSchema: JsonSchema = {
  type: "object",
  properties: {
    state: {
      type: "string",
      enum: ["in_progress", "review", "completed"]
    },
    round: {
      type: "integer",
      minimum: 0
    },
    review_turn: {
      type: "integer",
      minimum: 0
    },
    reason: {
      type: "string",
      minLength: 1
    }
  },
  required: ["state", "round", "review_turn"],
  additionalProperties: false
};

export const superintendentDocumentSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: superintendentDocumentSchemaId,
  title: "Superintendent plan document",
  type: "object",
  properties: {
    $schema: {
      type: "string",
      const: superintendentDocumentSchemaId
    },
    kind: {
      type: "string",
      const: "superintendent"
    },
    version: {
      type: "integer",
      minimum: 1
    },
    extends: {
      type: "string",
      minLength: 1
    },
    mcp: {
      type: "object",
      additionalProperties: mcpConfigSchema
    },
    builder: agentRoleSchema,
    inspectors: {
      type: "object",
      additionalProperties: agentRoleSchema
    },
    superintendent: agentRoleSchema,
    owner: agentRoleSchema,
    max_rounds: {
      type: "integer",
      minimum: 1,
      default: 100
    },
    status: statusSchema
  },
  required: ["kind", "version", "builder", "superintendent", "owner", "status"],
  additionalProperties: true
};

export const superintendentBaseDocumentSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: superintendentBaseDocumentSchemaId,
  title: "Superintendent base document",
  type: "object",
  properties: {
    $schema: {
      type: "string",
      const: superintendentBaseDocumentSchemaId
    },
    kind: {
      type: "string",
      const: "superintendent-base"
    },
    version: {
      type: "integer",
      minimum: 1
    },
    extends: {
      type: "string",
      minLength: 1
    },
    mcp: {
      type: "object",
      additionalProperties: mcpConfigSchema
    },
    builder: partialAgentRoleSchema,
    inspectors: {
      type: "object",
      additionalProperties: partialAgentRoleSchema
    },
    superintendent: partialAgentRoleSchema,
    owner: partialAgentRoleSchema,
    max_rounds: {
      type: "integer",
      minimum: 1
    }
  },
  required: ["kind", "version"],
  additionalProperties: true
};

const validStatusStates = new Set<StatusBlock["state"]>(["in_progress", "review", "completed"]);
const maxSuperintendentExtendsDepth = 5;

export function parseSuperintendentDoc(filePath: string, content: string): SuperintendentDoc {
  const resolvedFilePath = path.resolve(filePath);
  const parsed = parseSuperintendentFrontmatterDocument(resolvedFilePath, content);

  return {
    filePath: resolvedFilePath,
    body: parsed.body,
    frontmatter: parseFrontmatter(resolvedFilePath, parsed.frontmatter)
  };
}

export async function resolveSuperintendentDoc(
  filePath: string,
  content: string,
  fs: SuperintendentDocumentFileSystem
): Promise<ResolvedSuperintendentDoc> {
  const resolvedFilePath = path.resolve(filePath);
  const { body } = parseSuperintendentFrontmatterDocument(resolvedFilePath, content);
  const resolved = await resolveConfigExtends(
    [
      {
        source: resolvedFilePath,
        filePath: resolvedFilePath,
        content
      }
    ],
    { fs }
  );

  if (resolved.chain[1] !== undefined) {
    await assertSuperintendentBaseChain(resolvedFilePath, content, fs);
  }

  const { prompt: ignoredPrompt, ...frontmatter } = resolved.data;

  void ignoredPrompt;

  return {
    document: {
      filePath: resolvedFilePath,
      body,
      frontmatter: parseFrontmatter(resolvedFilePath, frontmatter)
    },
    ...(resolved.chain[1] === undefined ? {} : { extendsPath: resolved.chain[1] }),
    frontmatterData: frontmatter
  };
}

async function assertSuperintendentBaseChain(
  filePath: string,
  content: string,
  fs: SuperintendentDocumentFileSystem
): Promise<void> {
  let currentPath = filePath;
  let currentContent = content;
  const visited = new Set<string>([filePath]);

  for (let depth = 1; depth <= maxSuperintendentExtendsDepth; depth += 1) {
    const parsed = parseConfigDocument(currentContent, currentPath);

    if (parsed.extends === false || parsed.extends === true) {
      return;
    }

    const basePath = path.resolve(path.dirname(currentPath), parsed.extends);

    if (visited.has(basePath)) {
      return;
    }

    const baseContent = await fs.readFile(basePath, "utf8");
    const baseDocument = parseConfigDocument(baseContent, basePath);
    assertSuperintendentBaseFrontmatter(basePath, baseDocument.data);

    visited.add(basePath);
    currentPath = basePath;
    currentContent = baseContent;
  }
}

function assertSuperintendentBaseFrontmatter(
  filePath: string,
  frontmatter: Record<string, unknown>
): void {
  if (frontmatter.kind !== "superintendent-base") {
    throw new Error(`${filePath}: expected kind: superintendent-base`);
  }

  if (
    typeof frontmatter.version !== "number" ||
    !Number.isInteger(frontmatter.version) ||
    frontmatter.version < 1
  ) {
    throw new Error(`${filePath}: version must be a positive integer`);
  }

  if (Object.prototype.hasOwnProperty.call(frontmatter, "status")) {
    throw new Error(`${filePath}: superintendent base must not define runtime status`);
  }
}

export function readExplicitBuilderAgent(filePath: string, content: string): string | undefined {
  const resolvedFilePath = path.resolve(filePath);
  const parsed = parseSuperintendentFrontmatterDocument(resolvedFilePath, content);
  const frontmatter = expectRecord(parsed.frontmatter, "frontmatter", resolvedFilePath);

  if (frontmatter.builder === undefined) {
    return undefined;
  }

  const builder = expectRecord(frontmatter.builder, "builder", resolvedFilePath);
  return builder.agent === undefined
    ? undefined
    : expectString(builder.agent, "builder.agent", resolvedFilePath);
}

function parseSuperintendentFrontmatterDocument(
  filePath: string,
  content: string
): { frontmatter: Record<string, unknown>; body: string } {
  try {
    const parsed = parseFrontmatterDocument(content);

    if (
      parsed.body === content &&
      Object.keys(parsed.frontmatter).length === 0 &&
      !content.startsWith("\uFEFF---\n") &&
      !content.startsWith("---\n") &&
      !content.startsWith("---\r")
    ) {
      throw new Error(`${filePath}: expected YAML frontmatter delimited by ---`);
    }

    if (parsed.errors.length > 0) {
      throw new Error(`${filePath}: invalid YAML frontmatter: ${parsed.errors[0]?.message}`);
    }

    return {
      frontmatter: parsed.frontmatter,
      body: parsed.body
    };
  } catch (error) {
    if (
      error instanceof FrontmatterParseError &&
      error.message === "Missing YAML frontmatter end delimiter (---)."
    ) {
      throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
    }

    throw error;
  }
}

function parseFrontmatter(filePath: string, value: unknown): SuperintendentFrontmatter {
  const frontmatter = expectRecord(value, "frontmatter", filePath);
  const kind = frontmatter.kind;

  if (kind === undefined) {
    throw new Error(`${filePath}: missing \`kind\` field in frontmatter`);
  }

  if (kind !== "superintendent") {
    throw new Error(`${filePath}: frontmatter kind must be "superintendent"`);
  }

  return {
    kind,
    version: expectPositiveInteger(frontmatter.version, "version", filePath),
    mcp: parseMcpMap(frontmatter.mcp, filePath),
    builder: parseRequiredRole(frontmatter.builder, "builder", filePath),
    inspectors: parseInspectorMap(frontmatter.inspectors, filePath),
    superintendent: parseRequiredRole(frontmatter.superintendent, "superintendent", filePath),
    owner: parseRequiredRole(frontmatter.owner, "owner", filePath),
    max_rounds:
      frontmatter.max_rounds === undefined
        ? 100
        : expectPositiveInteger(frontmatter.max_rounds, "max_rounds", filePath),
    status: parseStatusBlock(frontmatter.status, filePath)
  };
}

function parseRequiredRole(value: unknown, roleName: string, filePath: string): AgentRoleConfig {
  if (value === undefined) {
    throw new Error(`${filePath}: missing required role \`${roleName}\``);
  }

  const role = expectRecord(value, roleName, filePath);
  assertOnlyKeys(role, roleName, ["agent", "mode", "cwd", "mcp", "prompt"], filePath);
  const mcp =
    role.mcp === undefined ? undefined : parseMcpMap(role.mcp, filePath, `${roleName}.mcp`);

  return {
    agent:
      role.agent === undefined
        ? "claude-code"
        : expectNonEmptyString(role.agent, `${roleName}.agent`, filePath),
    mode:
      role.mode === undefined
        ? undefined
        : expectNonEmptyString(role.mode, `${roleName}.mode`, filePath),
    cwd:
      role.cwd === undefined
        ? undefined
        : expectNonEmptyString(role.cwd, `${roleName}.cwd`, filePath),
    mcp,
    prompt: expectNonEmptyString(role.prompt, `${roleName}.prompt`, filePath)
  };
}

function parseInspectorMap(
  value: unknown,
  filePath: string
): Record<string, AgentRoleConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const inspectors = expectRecord(value, "inspectors", filePath);

  return Object.fromEntries(
    Object.entries(inspectors).map(([name, config]) => {
      assertValidInspectorName(name, filePath);
      return [
        name,
        parseRequiredRole(config, `inspectors.${name}`, filePath)
      ];
    })
  );
}

function parseMcpMap(
  value: unknown,
  filePath: string,
  fieldName: string = "mcp"
): Record<string, McpConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const mcp = expectRecord(value, fieldName, filePath);

  return Object.fromEntries(
    Object.entries(mcp).map(([name, config]) => [
      name,
      parseMcpConfig(config, `${fieldName}.${name}`, filePath)
    ])
  );
}

function parseMcpConfig(value: unknown, fieldName: string, filePath: string): McpConfig {
  const config = expectRecord(value, fieldName, filePath);
  assertOnlyKeys(config, fieldName, ["command", "args", "timeout"], filePath);

  return {
    command: expectNonEmptyString(config.command, `${fieldName}.command`, filePath),
    args:
      config.args === undefined
        ? undefined
        : expectStringArray(config.args, `${fieldName}.args`, filePath),
    timeout:
      config.timeout === undefined
        ? undefined
        : expectPositiveNumber(config.timeout, `${fieldName}.timeout`, filePath)
  };
}

function parseStatusBlock(value: unknown, filePath: string): StatusBlock {
  const status = expectRecord(value, "status", filePath);
  assertOnlyKeys(status, "status", ["state", "round", "review_turn", "reason"], filePath);
  const state = expectString(status.state, "status.state", filePath);

  if (!validStatusStates.has(state as StatusBlock["state"])) {
    throw new Error(`${filePath}: status.state must be one of in_progress, review, completed`);
  }

  const parsedState = state as StatusBlock["state"];

  return {
    state: parsedState,
    round: expectNonNegativeInteger(status.round, "status.round", filePath),
    review_turn: expectNonNegativeInteger(status.review_turn, "status.review_turn", filePath)
  };
}

function expectRecord(
  value: unknown,
  fieldName: string,
  filePath: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${filePath}: ${fieldName} must be a mapping`);
  }

  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  fieldName: string,
  allowedKeys: readonly string[],
  filePath: string
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${filePath}: unknown field ${fieldName}.${key}`);
    }
  }
}

function expectString(value: unknown, fieldName: string, filePath: string): string {
  if (typeof value !== "string") {
    throw new Error(`${filePath}: ${fieldName} must be a string`);
  }

  return value;
}

function expectNonEmptyString(value: unknown, fieldName: string, filePath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${filePath}: ${fieldName} must be a non-empty string`);
  }

  return value;
}

function expectPositiveInteger(value: unknown, fieldName: string, filePath: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${filePath}: ${fieldName} must be a positive integer`);
  }

  return value as number;
}

function expectNonNegativeInteger(value: unknown, fieldName: string, filePath: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${filePath}: ${fieldName} must be a non-negative integer`);
  }

  return value as number;
}

function expectPositiveNumber(value: unknown, fieldName: string, filePath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${filePath}: ${fieldName} must be a positive number`);
  }

  return value;
}

function expectStringArray(value: unknown, fieldName: string, filePath: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`${filePath}: ${fieldName} must be an array of non-empty strings`);
  }

  return value;
}

function assertValidInspectorName(name: string, filePath: string): void {
  if (!isTemplateReferenceName(name)) {
    throw new Error(
      `${filePath}: inspectors.${name} name must use only letters, numbers, underscores, or hyphens`
    );
  }
}

function isTemplateReferenceName(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (const character of value) {
    const code = character.charCodeAt(0);
    const isNumber = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!isNumber && !isUpper && !isLower && character !== "_" && character !== "-") {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
