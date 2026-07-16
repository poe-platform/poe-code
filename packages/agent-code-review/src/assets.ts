import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  resolvePromptDocument,
  type ResolvedPromptDocument
} from "@poe-code/config-extends";
import {
  parseCodeReviewProfileMarkdown,
  parseCodeReviewPromptMarkdown,
  requireSafeDocumentSegment
} from "./document-schemas.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { parseCodeReviewProfileDirectories } from "./config-scope.js";

export type CodeReviewAssetReader = (filePath: string, encoding: BufferEncoding) => Promise<string>;

export const CODE_REVIEW_PROMPT_ROLES = [
  "orchestrator",
  "subagent",
  "agent",
  "profile-synthesis"
] as const;

export type CodeReviewPromptRole = (typeof CODE_REVIEW_PROMPT_ROLES)[number];

export interface CodeReviewProfile {
  name: string;
  content: string;
  filePath?: string;
  source: "repo" | "external" | "built-in";
}

export interface CodeReviewInstallResult {
  created: string[];
  overwritten: string[];
  skipped: string[];
}

export const CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT =
  "In user-facing review/profile output, do not mention dry-run, fake-submit, orchestration, subagents, internal tool flow, source GitHub usernames, source URLs, or generation details.";

export const BUILT_IN_GENERIC_PROFILE = `# Generic review profile

Focus on correctness, regressions, security, and missing tests. Report only concrete, actionable findings.
`;

export const BUILT_IN_CODE_REVIEW_PROMPTS: Record<CodeReviewPromptRole, string> = {
  orchestrator: `Review this pull request and return actionable findings only. Use the available reviewer profiles where they help identify concrete issues.
`,
  subagent: `Review the assigned pull request changes using the supplied reviewer profile. Return only concrete, actionable findings.
`,
  agent: `Review the requested pull request directly without orchestrating other agents. Read the pull request context with the available tools, then create exactly one review draft with concrete, actionable findings only.

${CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT}
`,
  "profile-synthesis": `Synthesize a concise code-review profile from the supplied review evidence, emphasizing actionable review priorities and style.
`
};

function requireUserFacingOutputContract(prompt: string): string {
  if (prompt.includes(CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT)) {
    return prompt;
  }
  return `${prompt.trimEnd()}\n\n${CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT}\n`;
}

const INSTALL_ASSETS: ReadonlyArray<readonly [string, string]> = [
  ["profiles/generic.md", BUILT_IN_GENERIC_PROFILE],
  ["prompts/orchestrator.md", BUILT_IN_CODE_REVIEW_PROMPTS.orchestrator],
  ["prompts/subagent.md", BUILT_IN_CODE_REVIEW_PROMPTS.subagent],
  ["prompts/agent.md", BUILT_IN_CODE_REVIEW_PROMPTS.agent],
  ["prompts/profile-synthesis.md", BUILT_IN_CODE_REVIEW_PROMPTS["profile-synthesis"]]
];

function requireMarkdownBody(content: string, filePath: string): string {
  if (content.trim().length === 0) {
    throw new Error(`Code review asset is empty: ${filePath}`);
  }
  return content;
}

export function codeReviewAssetsDirectory(cwd: string): string {
  return join(cwd, ".poe-code", "code-review");
}

export async function loadCodeReviewProfile(
  filePath: string,
  reader?: CodeReviewAssetReader
): Promise<string> {
  const parsed = parseCodeReviewProfileMarkdown(
    await (reader ? reader(filePath, "utf8") : readRegularAssetFile(filePath)),
    filePath
  );
  return requireMarkdownBody(parsed.content, filePath);
}

export async function loadCodeReviewPrompt(
  filePath: string,
  reader?: CodeReviewAssetReader
): Promise<string> {
  const parsed = parseCodeReviewPromptMarkdown(
    await (reader ? reader(filePath, "utf8") : readRegularAssetFile(filePath)),
    filePath
  );
  return requireMarkdownBody(parsed.content, filePath);
}

export async function discoverCodeReviewProfiles(input: {
  cwd: string;
  filters?: readonly string[];
  profileDirectories?: readonly string[];
}): Promise<CodeReviewProfile[]> {
  const cwd = resolve(input.cwd);
  const directories = [
    { path: join(codeReviewAssetsDirectory(cwd), "profiles"), source: "repo" as const, root: cwd },
    ...parseCodeReviewProfileDirectories(input.profileDirectories ?? []).map((directory) => ({
      path: resolve(directory),
      source: "external" as const,
      root: resolve(directory)
    }))
  ];
  const profiles = new Map<string, CodeReviewProfile>();
  const normalizedNames = new Map<string, string>();
  for (const directory of directories) {
    for (const profile of await discoverProfilesInDirectory(directory)) {
      const normalized = profile.name.normalize("NFKC").toLowerCase();
      const existingName = normalizedNames.get(normalized);
      if (existingName && existingName !== profile.name) {
        throw new Error(`Code review profile filenames normalize to the same name: ${profile.name}`);
      }
      normalizedNames.set(normalized, profile.name);
      if (!profiles.has(profile.name)) profiles.set(profile.name, profile);
    }
  }
  const availableNames = [...profiles.keys()];
  if (availableNames.length === 0) {
    validateProfileFilters(input.filters, ["generic"]);
    return [{ name: "generic", content: BUILT_IN_GENERIC_PROFILE, source: "built-in" }];
  }
  validateProfileFilters(input.filters, availableNames);
  const filterSet = input.filters?.length ? new Set(input.filters) : undefined;
  return [...profiles.values()].filter((profile) => !filterSet || filterSet.has(profile.name));
}

async function discoverProfilesInDirectory(input: {
  path: string;
  root: string;
  source: "repo" | "external";
}): Promise<CodeReviewProfile[]> {
  const profilesDirectory = input.path;
  await assertContainedAssetDirectoryOrMissing(input.root, profilesDirectory);
  let profileFileNames: string[];
  try {
    const profileEntries = await readdir(profilesDirectory, {
      withFileTypes: true
    });
    for (const entry of profileEntries) {
      if (entry.name.endsWith(".md") && !entry.isFile()) {
        throw invalidInstallTargetError(join(profilesDirectory, entry.name));
      }
    }
    profileFileNames = profileEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
    profileFileNames = [];
  }

  return Promise.all(
    profileFileNames.map(async (fileName) => {
        const name = requireSafeDocumentSegment(
          profileNameFromFile(fileName),
          `${join(profilesDirectory, fileName)}: filename`
        );
        const filePath = join(profilesDirectory, fileName);
        return {
          name,
          content: await loadCodeReviewProfile(filePath),
          filePath,
          source: input.source
        };
      })
  );
}

export async function loadCodeReviewRolePrompt(input: {
  cwd: string;
  role: CodeReviewPromptRole;
}): Promise<string> {
  return (await resolveCodeReviewRolePrompt(input)).prompt;
}

export async function resolveCodeReviewRolePrompt(input: {
  cwd: string;
  role: CodeReviewPromptRole;
}): Promise<ResolvedPromptDocument> {
  const cwd = resolve(input.cwd);
  const relativePath = join(".poe-code", "code-review", "prompts", `${input.role}.md`);
  const builtInPath = resolve("/poe-code/code-review/prompts", `${input.role}.md`);
  const resolvedPrompt = await resolvePromptDocument({
    cwd,
    filePath: relativePath,
    optional: true,
    fs: {
      readFile: async (filePath, _encoding) => await readRegularAssetFile(filePath),
      realpath: async (filePath) => await realpath(filePath)
    },
    baseDocuments: [
      {
        filePath: builtInPath,
        content: BUILT_IN_CODE_REVIEW_PROMPTS[input.role]
      }
    ]
  });
  validateResolvedRolePrompt(resolvedPrompt, input.role);
  return input.role === "agent"
    ? { ...resolvedPrompt, prompt: requireUserFacingOutputContract(resolvedPrompt.prompt) }
    : resolvedPrompt;
}

function validateResolvedRolePrompt(
  prompt: ResolvedPromptDocument,
  role: CodeReviewPromptRole
): void {
  if (prompt.metadata.version !== undefined && prompt.metadata.version !== 1) {
    throw new Error(`${prompt.source}: frontmatter.version must equal 1`);
  }
  if (prompt.metadata.role !== undefined && prompt.metadata.role !== role) {
    throw new Error(`${prompt.source}: frontmatter.role must equal ${role}`);
  }
}

export async function installCodeReviewAssets(input: {
  cwd: string;
  force?: boolean;
  dryRun?: boolean;
}): Promise<CodeReviewInstallResult> {
  const cwd = resolve(input.cwd);
  const assetsDirectory = codeReviewAssetsDirectory(cwd);
  const result: CodeReviewInstallResult = {
    created: [],
    overwritten: [],
    skipped: []
  };
  for (const [relativePath, content] of INSTALL_ASSETS) {
    const filePath = join(assetsDirectory, relativePath);
    if (input.dryRun) {
      const exists = await assertInstallTargetIsFileOrMissing(filePath);
      if (!exists) {
        result.created.push(filePath);
      } else if (input.force) {
        result.overwritten.push(filePath);
      } else {
        result.skipped.push(filePath);
      }
      continue;
    }
    await ensureContainedDirectory(cwd, dirname(filePath));
    if (!input.force) {
      const installed = await createAssetUnlessPresent(filePath, content);
      (installed ? result.created : result.skipped).push(filePath);
      continue;
    }
    const exists = await assertInstallTargetIsFileOrMissing(filePath);
    await overwriteAssetAtomically(filePath, content);
    (exists ? result.overwritten : result.created).push(filePath);
  }
  return result;
}

async function ensureContainedDirectory(cwd: string, targetDirectory: string) {
  const pathFromCwd = relative(cwd, targetDirectory);
  if (pathFromCwd.startsWith("..") || pathFromCwd.startsWith(sep)) {
    throw new Error(`Code review asset directory escapes repository: ${targetDirectory}`);
  }
  await mkdir(cwd, { recursive: true });
  if (!(await stat(cwd)).isDirectory()) {
    throw new Error(`Code review repository path is not a directory: ${cwd}`);
  }
  let currentDirectory = cwd;
  for (const segment of pathFromCwd.split(sep).filter(Boolean)) {
    currentDirectory = join(currentDirectory, segment);
    try {
      await mkdir(currentDirectory);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
    const status = await lstat(currentDirectory);
    if (!status.isDirectory()) {
      throw new Error(
        `Code review asset directory is not a regular directory: ${currentDirectory}`
      );
    }
  }
}

async function assertContainedAssetDirectoryOrMissing(
  cwd: string,
  targetDirectory: string
): Promise<void> {
  let rootStatus: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStatus = await lstat(cwd);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  if (!rootStatus.isDirectory()) {
    throw new Error(`Code review asset directory is not a regular directory: ${cwd}`);
  }
  const pathFromCwd = relative(cwd, targetDirectory);
  if (pathFromCwd.startsWith("..") || pathFromCwd.startsWith(sep)) {
    throw new Error(`Code review asset directory escapes repository: ${targetDirectory}`);
  }
  let currentDirectory = cwd;
  for (const segment of pathFromCwd.split(sep).filter(Boolean)) {
    currentDirectory = join(currentDirectory, segment);
    let status: Awaited<ReturnType<typeof lstat>>;
    try {
      status = await lstat(currentDirectory);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      throw error;
    }
    if (!status.isDirectory()) {
      throw new Error(
        `Code review asset directory is not a regular directory: ${currentDirectory}`
      );
    }
  }
}

function profileNameFromFile(fileName: string): string {
  return basename(fileName, ".md");
}

function validateProfileFilters(
  filters: readonly string[] | undefined,
  availableNames: readonly string[]
): void {
  if (!filters?.length) {
    return;
  }
  const validatedFilters = filters.map((profile) =>
    requireSafeDocumentSegment(profile, "Code review profile filter")
  );
  const available = new Set(availableNames);
  const unknown = validatedFilters.filter((profile) => !available.has(profile));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown code review profile filter(s): ${unknown.join(", ")}. Available profiles: ${availableNames.join(", ")}.`
    );
  }
}

async function createAssetUnlessPresent(filePath: string, content: string): Promise<boolean> {
  for (;;) {
    const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
    if (await pathExists(temporaryPath)) {
      continue;
    }
    let temporary: Awaited<ReturnType<typeof open>> | undefined;
    let temporaryCreated = false;
    try {
      temporary = await open(temporaryPath, "wx");
      temporaryCreated = true;
      try {
        await temporary.writeFile(content, "utf8");
        await temporary.sync();
      } finally {
        await temporary.close();
        temporary = undefined;
      }
      await link(temporaryPath, filePath);
      await unlink(temporaryPath);
      temporaryCreated = false;
      await syncDirectory(dirname(filePath));
      return true;
    } catch (error) {
      await temporary?.close().catch(() => undefined);
      if (temporaryCreated) {
        await unlink(temporaryPath).catch(() => undefined);
      }
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      try {
        const status = await lstat(filePath);
        if (!status.isFile()) {
          throw invalidInstallTargetError(filePath);
        }
        return false;
      } catch (statusError) {
        if (isMissingFileError(statusError)) {
          continue;
        }
        throw statusError;
      }
    }
  }
}

async function assertInstallTargetIsFileOrMissing(filePath: string): Promise<boolean> {
  try {
    const status = await lstat(filePath);
    if (!status.isFile()) {
      throw invalidInstallTargetError(filePath);
    }
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function overwriteAssetAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  if (await pathExists(temporaryPath)) {
    throw new Error(`Code review asset temporary path already exists: ${temporaryPath}`);
  }
  let temporary: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryCreated = false;
  try {
    temporary = await open(temporaryPath, "wx");
    temporaryCreated = true;
    await temporary.writeFile(content, "utf8");
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, filePath);
    temporaryCreated = false;
    await syncDirectory(dirname(filePath));
  } catch (error) {
    await temporary?.close().catch(() => undefined);
    if (temporaryCreated) {
      await unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const parent = await open(directory, constants.O_RDONLY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

async function readRegularAssetFile(filePath: string): Promise<string> {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) {
      throw invalidInstallTargetError(filePath);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function invalidInstallTargetError(filePath: string): Error {
  return new Error(`Code review asset path is not a regular file: ${filePath}`);
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
