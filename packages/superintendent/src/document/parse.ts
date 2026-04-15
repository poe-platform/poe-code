import path from "node:path";
import { parseDocument } from "yaml";
export type { TaskBoard, TaskItem } from "./tasks.js";

export type SuperintendentDoc = {
  frontmatter: SuperintendentFrontmatter;
  body: string;
  filePath: string;
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
  mcp?: Record<string, McpConfig>;
  prompt: string;
};

export type McpConfig = {
  command: string;
  args?: string[];
};

export type StatusBlock = {
  state: "in_progress" | "review" | "completed";
  round: number;
  review_turn: number;
};

const validStatusStates = new Set<StatusBlock["state"]>(["in_progress", "review", "completed"]);

export function parseSuperintendentDoc(filePath: string, content: string): SuperintendentDoc {
  const resolvedFilePath = path.resolve(filePath);
  const { frontmatterText, body } = splitFrontmatter(resolvedFilePath, content);
  const parsedFrontmatter = parseYamlFrontmatter(resolvedFilePath, frontmatterText);

  return {
    filePath: resolvedFilePath,
    body,
    frontmatter: parseFrontmatter(resolvedFilePath, parsedFrontmatter)
  };
}

function splitFrontmatter(
  filePath: string,
  content: string
): { frontmatterText: string; body: string } {
  const normalizedContent = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const openingLineBreak = readOpeningLineBreak(normalizedContent);

  if (openingLineBreak === undefined) {
    throw new Error(`${filePath}: expected YAML frontmatter delimited by ---`);
  }

  const frontmatterStart = 3 + openingLineBreak.length;
  const closingFenceIndex = findClosingFence(normalizedContent, frontmatterStart, filePath);
  const frontmatterEnd = readFrontmatterEnd(normalizedContent, closingFenceIndex);

  return {
    frontmatterText: normalizedContent.slice(frontmatterStart, frontmatterEnd),
    body: readBody(normalizedContent, closingFenceIndex + 4)
  };
}

function readOpeningLineBreak(content: string): "\n" | "\r\n" | undefined {
  if (!content.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = content[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && content[4] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(content: string, searchFrom: number, filePath: string): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < content.length) {
    const candidateIndex = content.indexOf("\n---", currentIndex);

    if (candidateIndex === -1) {
      throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
    }

    const fenceEnd = candidateIndex + 4;
    const nextCharacter = content[fenceEnd];

    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && content[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
}

function readBody(content: string, bodyStart: number): string {
  const nextCharacter = content[bodyStart];

  if (nextCharacter === "\n") {
    return content.slice(bodyStart + 1);
  }

  if (nextCharacter === "\r" && content[bodyStart + 1] === "\n") {
    return content.slice(bodyStart + 2);
  }

  return content.slice(bodyStart);
}

function readFrontmatterEnd(content: string, closingFenceIndex: number): number {
  return content[closingFenceIndex - 1] === "\r" ? closingFenceIndex - 1 : closingFenceIndex;
}

function parseYamlFrontmatter(filePath: string, frontmatterText: string): unknown {
  const document = parseDocument(frontmatterText);

  if (document.errors.length > 0) {
    throw new Error(`${filePath}: invalid YAML frontmatter: ${document.errors[0].message}`);
  }

  return document.toJSON();
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
    version: expectNumber(frontmatter.version, "version", filePath),
    mcp: parseMcpMap(frontmatter.mcp, filePath),
    builder: parseRequiredRole(frontmatter.builder, "builder", filePath),
    inspectors: parseInspectorMap(frontmatter.inspectors, filePath),
    superintendent: parseRequiredRole(frontmatter.superintendent, "superintendent", filePath),
    owner: parseRequiredRole(frontmatter.owner, "owner", filePath),
    max_rounds:
      frontmatter.max_rounds === undefined
        ? 100
        : expectNumber(frontmatter.max_rounds, "max_rounds", filePath),
    status: parseStatusBlock(frontmatter.status, filePath)
  };
}

function parseRequiredRole(value: unknown, roleName: string, filePath: string): AgentRoleConfig {
  if (value === undefined) {
    throw new Error(`${filePath}: missing required role \`${roleName}\``);
  }

  const role = expectRecord(value, roleName, filePath);
  const mcp =
    role.mcp === undefined
      ? undefined
      : parseMcpMap(role.mcp, filePath, `${roleName}.mcp`);

  return {
    agent: expectString(role.agent, `${roleName}.agent`, filePath),
    mode:
      role.mode === undefined ? undefined : expectString(role.mode, `${roleName}.mode`, filePath),
    mcp,
    prompt: expectString(role.prompt, `${roleName}.prompt`, filePath)
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
    Object.entries(inspectors).map(([name, config]) => [
      name,
      parseRequiredRole(config, `inspectors.${name}`, filePath)
    ])
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

  return {
    command: expectString(config.command, `${fieldName}.command`, filePath),
    args:
      config.args === undefined
        ? undefined
        : expectStringArray(config.args, `${fieldName}.args`, filePath)
  };
}

function parseStatusBlock(value: unknown, filePath: string): StatusBlock {
  const status = expectRecord(value, "status", filePath);
  const state = expectString(status.state, "status.state", filePath);

  if (!validStatusStates.has(state as StatusBlock["state"])) {
    throw new Error(`${filePath}: status.state must be one of in_progress, review, completed`);
  }

  const parsedState = state as StatusBlock["state"];

  return {
    state: parsedState,
    round: expectNumber(status.round, "status.round", filePath),
    review_turn: expectNumber(status.review_turn, "status.review_turn", filePath)
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

function expectString(value: unknown, fieldName: string, filePath: string): string {
  if (typeof value !== "string") {
    throw new Error(`${filePath}: ${fieldName} must be a string`);
  }

  return value;
}

function expectNumber(value: unknown, fieldName: string, filePath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${filePath}: ${fieldName} must be a number`);
  }

  return value;
}

function expectStringArray(value: unknown, fieldName: string, filePath: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${filePath}: ${fieldName} must be an array of strings`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
