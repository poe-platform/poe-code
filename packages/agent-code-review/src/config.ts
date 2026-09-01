import { lstat, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  type ConfigStoreOptions,
  createConfigStore,
  defineScope,
  resolveConfigPath,
  resolveProjectConfigPath
} from "@poe-code/poe-code-config/core";
import {
  type CodeReviewHumanGateConfig,
  codeReviewConfigScope,
  parseCodeReviewConfigDocument,
  parseCodeReviewProfileDirectories
} from "./config-scope.js";
import { requireSafeDocumentSegment } from "./document-schemas.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { resolveCodeReviewStoreDirectory } from "./review-store.js";

export interface CodeReviewConfig {
  agent?: string;
  draftStore: string;
  humanGate: CodeReviewHumanGateConfig;
  profileDirectories: string[];
}

export interface CodeReviewRunInput {
  prUrl: string;
  cwd: string;
  sessionId?: string;
  agent?: string;
  draftStore?: string;
  humanGate?: CodeReviewHumanGateConfig;
  profileDirectories?: string[];
  profilePath?: string;
  promptPath?: string;
  profiles?: string[];
  additionalFeedback?: string;
}

export interface CodeReviewRunOptions extends CodeReviewRunInput {
  draftStore: string;
  humanGate: CodeReviewHumanGateConfig;
}

const poeCoreAgentScope = defineScope("core", {
  defaultAgent: {
    type: "string",
    default: "",
    env: "POE_DEFAULT_AGENT",
    doc: "Normal poe-code default agent resolution for code review runs."
  }
});

const nativeConfigFs: ConfigStoreOptions["fs"] = {
  readFile: (filePath, encoding) => readFile(filePath, encoding),
  writeFile: (filePath, content, options) => writeFile(filePath, content, options),
  mkdir: (filePath, options) => mkdir(filePath, options).then(() => undefined),
  unlink,
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  lstat: (filePath) => lstat(filePath),
  stat: (filePath) => stat(filePath),
  readdir
};

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export async function loadCodeReviewConfig(options: ConfigStoreOptions): Promise<CodeReviewConfig> {
  await validatePersistedCodeReviewConfig(options);
  const config = await createConfigStore(options).scope(codeReviewConfigScope).getAll();
  const configRecord = config as unknown as Record<string, unknown>;
  const agent = optionalNonEmptyString(getOwnEntry(configRecord, "agent"));
  const draftStore = requireNonEmptyString(
    getOwnEntry(configRecord, "draftStore"),
    "codeReview.draftStore"
  );
  const humanGate = getOwnEntry(configRecord, "humanGate") as CodeReviewHumanGateConfig;
  const profileDirectories = getOwnEntry(configRecord, "profileDirectories") as string[];
  return {
    ...(agent ? { agent } : {}),
    draftStore,
    humanGate,
    profileDirectories
  };
}

async function validatePersistedCodeReviewConfig(options: ConfigStoreOptions): Promise<void> {
  for (const filePath of [options.filePath, options.projectFilePath]) {
    if (!filePath) continue;
    let content: string;
    try {
      content = await options.fs.readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    let document: unknown;
    try {
      document = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(
        `${filePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      throw new Error(`${filePath}: config must be an object.`);
    }
    const codeReview = getOwnEntry(document as Record<string, unknown>, "codeReview");
    if (codeReview === undefined) continue;
    try {
      parseCodeReviewConfigDocument(codeReview);
    } catch (error) {
      throw new Error(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function resolveCodeReviewRunOptions(
  input: CodeReviewRunInput,
  configOptions: ConfigStoreOptions
): Promise<CodeReviewRunOptions> {
  const config = await loadCodeReviewConfig(configOptions);
  const configRecord = config as unknown as Record<string, unknown>;
  const inputRecord = input as unknown as Record<string, unknown>;
  const inputPrUrl = getOwnEntry(inputRecord, "prUrl");
  const inputCwd = getOwnEntry(inputRecord, "cwd");
  const inputAgent = getOwnEntry(inputRecord, "agent");
  const inputDraftStore = getOwnEntry(inputRecord, "draftStore");
  const inputSessionId = getOwnEntry(inputRecord, "sessionId");
  const inputHumanGate = getOwnEntry(inputRecord, "humanGate") as
    | CodeReviewHumanGateConfig
    | undefined;
  const inputProfileDirectories = getOwnEntry(inputRecord, "profileDirectories") as
    | string[]
    | undefined;
  const inputProfilePath = getOwnEntry(inputRecord, "profilePath");
  const inputPromptPath = getOwnEntry(inputRecord, "promptPath");
  const inputProfiles = getOwnEntry(inputRecord, "profiles");
  const inputAdditionalFeedback = getOwnEntry(inputRecord, "additionalFeedback");
  const agent =
    inputAgent === undefined
      ? optionalNonEmptyString(getOwnEntry(configRecord, "agent"))
      : requireNonEmptyString(inputAgent, "agent");
  const draftStore =
    inputDraftStore === undefined
      ? requireNonEmptyString(getOwnEntry(configRecord, "draftStore"), "codeReview.draftStore")
      : requireNonEmptyString(inputDraftStore, "draftStore");
  const configHumanGate = getOwnEntry(configRecord, "humanGate") as CodeReviewHumanGateConfig;
  const configProfileDirectories = getOwnEntry(configRecord, "profileDirectories") as string[];
  const cwd = requireNonEmptyString(inputCwd, "cwd");
  resolveCodeReviewStoreDirectory(cwd, draftStore);
  return {
    prUrl: requireNonEmptyString(inputPrUrl, "prUrl"),
    cwd,
    ...(inputSessionId === undefined
      ? {}
      : { sessionId: requireNonEmptyString(inputSessionId, "sessionId") }),
    ...(agent ? { agent } : {}),
    draftStore,
    humanGate: inputHumanGate ?? configHumanGate,
    profileDirectories: parseCodeReviewProfileDirectories(
      inputProfileDirectories ?? configProfileDirectories
    ),
    ...(inputProfilePath === undefined ? {} : { profilePath: inputProfilePath as string }),
    ...(inputPromptPath === undefined ? {} : { promptPath: inputPromptPath as string }),
    ...(inputProfiles === undefined ? {} : { profiles: requireProfileFilters(inputProfiles) }),
    ...(inputAdditionalFeedback === undefined
      ? {}
      : { additionalFeedback: inputAdditionalFeedback as string })
  };
}

export async function resolveCodeReviewRuntimeOptions(
  input: CodeReviewRunInput
): Promise<CodeReviewRunOptions> {
  const cwd = requireNonEmptyString(
    getOwnEntry(input as unknown as Record<string, unknown>, "cwd"),
    "cwd"
  );
  return resolveCodeReviewRunOptions(input, runtimeConfigOptions(cwd));
}

export async function loadCodeReviewRuntimeConfig(cwd: string): Promise<CodeReviewConfig> {
  return loadCodeReviewConfig(runtimeConfigOptions(cwd));
}

function runtimeConfigOptions(cwd: string): ConfigStoreOptions {
  return {
    fs: nativeConfigFs,
    filePath: resolveConfigPath(homedir()),
    projectFilePath: resolveProjectConfigPath(cwd),
    env: process.env
  };
}

export async function loadDefaultPoeCodeAgent(input: {
  cwd: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  fs?: ConfigStoreOptions["fs"];
}): Promise<string | undefined> {
  const inputRecord = input as unknown as Record<string, unknown>;
  const cwd = requireNonEmptyString(getOwnEntry(inputRecord, "cwd"), "cwd");
  const home = getOwnEntry(inputRecord, "homeDir");
  const env = getOwnEntry(inputRecord, "env") as Record<string, string | undefined> | undefined;
  const fs = getOwnEntry(inputRecord, "fs") as ConfigStoreOptions["fs"] | undefined;
  const agent = await createConfigStore({
    fs: fs ?? nativeConfigFs,
    filePath: resolveConfigPath(typeof home === "string" ? home : homedir()),
    projectFilePath: resolveProjectConfigPath(cwd),
    env: env ?? process.env
  })
    .scope(poeCoreAgentScope)
    .get("defaultAgent");
  return agent.trim() || undefined;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return normalized;
}

function requireProfileFilters(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("profiles must be an array of safe profile names.");
  }
  return value.map((profile) => {
    try {
      return requireSafeDocumentSegment(profile, "profiles");
    } catch {
      throw new Error("profiles must be an array of safe profile names.");
    }
  });
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
