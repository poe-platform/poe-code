import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  type ConfigStoreOptions,
  createConfigStore,
  defineScope,
  resolveConfigPath,
  resolveProjectConfigPath
} from "@poe-code/poe-code-config";
import {
  type CodeReviewHumanGateConfig,
  codeReviewConfigScope,
  parseCodeReviewConfigDocument
} from "./config-scope.js";
import { resolveCodeReviewStoreDirectory } from "./review-store.js";

export interface CodeReviewConfig {
  agent?: string;
  draftStore: string;
  humanGate: CodeReviewHumanGateConfig;
}

export interface CodeReviewRunInput {
  prUrl: string;
  cwd: string;
  sessionId?: string;
  agent?: string;
  draftStore?: string;
  humanGate?: CodeReviewHumanGateConfig;
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
  stat: (filePath) => stat(filePath),
  readdir
};

export async function loadCodeReviewConfig(options: ConfigStoreOptions): Promise<CodeReviewConfig> {
  await validatePersistedCodeReviewConfig(options);
  const config = await createConfigStore(options).scope(codeReviewConfigScope).getAll();
  const agent = optionalNonEmptyString(config.agent);
  const draftStore = requireNonEmptyString(config.draftStore, "codeReview.draftStore");
  return {
    ...(agent ? { agent } : {}),
    draftStore,
    humanGate: config.humanGate
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
    const codeReview = (document as Record<string, unknown>).codeReview;
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
  const agent =
    input.agent === undefined ? config.agent : requireNonEmptyString(input.agent, "agent");
  const draftStore =
    input.draftStore === undefined
      ? config.draftStore
      : requireNonEmptyString(input.draftStore, "draftStore");
  resolveCodeReviewStoreDirectory(input.cwd, draftStore);
  return {
    prUrl: requireNonEmptyString(input.prUrl, "prUrl"),
    cwd: requireNonEmptyString(input.cwd, "cwd"),
    ...(input.sessionId === undefined
      ? {}
      : { sessionId: requireNonEmptyString(input.sessionId, "sessionId") }),
    ...(agent ? { agent } : {}),
    draftStore,
    humanGate: input.humanGate ?? config.humanGate,
    ...(input.profilePath === undefined ? {} : { profilePath: input.profilePath }),
    ...(input.promptPath === undefined ? {} : { promptPath: input.promptPath }),
    ...(input.profiles === undefined ? {} : { profiles: input.profiles }),
    ...(input.additionalFeedback === undefined
      ? {}
      : { additionalFeedback: input.additionalFeedback })
  };
}

export async function resolveCodeReviewRuntimeOptions(
  input: CodeReviewRunInput
): Promise<CodeReviewRunOptions> {
  return resolveCodeReviewRunOptions(input, {
    fs: nativeConfigFs,
    filePath: resolveConfigPath(homedir()),
    projectFilePath: resolveProjectConfigPath(input.cwd),
    env: process.env
  });
}

export async function loadDefaultPoeCodeAgent(input: {
  cwd: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  fs?: ConfigStoreOptions["fs"];
}): Promise<string | undefined> {
  const agent = await createConfigStore({
    fs: input.fs ?? nativeConfigFs,
    filePath: resolveConfigPath(input.homeDir ?? homedir()),
    projectFilePath: resolveProjectConfigPath(input.cwd),
    env: input.env ?? process.env
  })
    .scope(poeCoreAgentScope)
    .get("defaultAgent");
  return agent.trim() || undefined;
}

function optionalNonEmptyString(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function requireNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
