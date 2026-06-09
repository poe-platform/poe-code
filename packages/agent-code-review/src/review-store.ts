import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import {
  canonicalPullRequestUrl,
  filesystemSafeNamePart,
  parseGitHubPullRequestRef
} from "github-review";
import { requireSafeDocumentSegment } from "./document-schemas.js";
import {
  type CodeReviewDraft,
  type CodeReviewInlineComment,
  type CodeReviewOrchestratorAction,
  type CodeReviewPublishedReceipt,
  type CodeReviewState,
  type CodeReviewSubagentStatus,
  parseCodeReviewState,
  serializeCodeReviewState
} from "./review-state.js";
import { hasOwnErrorCode } from "./error-codes.js";

export const DEFAULT_CODE_REVIEW_REVIEWS_DIRECTORY = ".poe-code/code-review/reviews";
export const CODE_REVIEW_DIRECTORY = ".poe-code/code-review";
export const CODE_REVIEW_ARCHIVE_DIRECTORY = "archive";

export interface CreateCodeReviewInput {
  sessionId: string;
  prUrl: string;
  selectedAgent: string;
  selectedProfiles: string[];
  timestamp?: string;
  subagents?: Record<string, CodeReviewSubagentStatus>;
}

export interface CodeReviewStoreOptions {
  directory?: string;
  now?: () => Date;
  lockTimeoutMs?: number;
}

export interface ReadCodeReviewDraftInput extends CodeReviewStoreOptions {
  cwd: string;
  prUrl: string;
  draftStore?: string;
}

export function codeReviewFileName(prUrl: string): string {
  const ref = requirePullRequestRef(prUrl);
  return `${safeFilePart(ref.owner)}_${safeFilePart(ref.repo)}_PR${ref.number}.yaml`;
}

export function resolveCodeReviewStoreDirectory(
  cwd: string,
  directory = DEFAULT_CODE_REVIEW_REVIEWS_DIRECTORY
): string {
  const root = resolve(cwd, CODE_REVIEW_DIRECTORY);
  const target = isAbsolute(directory) ? resolve(directory) : resolve(cwd, directory);
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith("..") || fromRoot.startsWith(sep)) {
    throw new Error(`Code review draft store must stay under ${root}: ${target}`);
  }
  return target;
}

export function createCodeReviewState(input: CreateCodeReviewInput): CodeReviewState {
  const ref = requirePullRequestRef(input.prUrl);
  const sessionId = requireSafeDocumentSegment(input.sessionId, "Code review session");
  const selectedProfiles = input.selectedProfiles.map((profile) =>
    requireSafeDocumentSegment(profile, "Code review profile")
  );
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    version: 1,
    sessionId,
    prUrl: canonicalPullRequestUrl(input.prUrl),
    prRef: {
      host: ref.host,
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number
    },
    selectedAgent: input.selectedAgent,
    selectedProfiles,
    state: "in_progress",
    timestamps: { createdAt: timestamp, updatedAt: timestamp },
    rawReviews: {},
    subagents: input.subagents ?? {},
    orchestratorActions: []
  };
}

export async function readCodeReviewDraft(
  input: ReadCodeReviewDraftInput
): Promise<CodeReviewState | undefined> {
  const directory = resolveCodeReviewStoreDirectory(input.cwd, input.draftStore ?? input.directory);
  return new CodeReviewYamlStore({
    directory,
    ...(input.now ? { now: input.now } : {}),
    ...(input.lockTimeoutMs ? { lockTimeoutMs: input.lockTimeoutMs } : {})
  }).read(input.prUrl);
}

export class CodeReviewYamlStore {
  readonly directory: string;
  readonly archiveDirectory: string;
  readonly #now: () => Date;
  readonly #lockTimeoutMs: number;

  constructor(options: CodeReviewStoreOptions = {}) {
    this.directory = resolve(options.directory ?? DEFAULT_CODE_REVIEW_REVIEWS_DIRECTORY);
    this.archiveDirectory = containedPath(this.directory, CODE_REVIEW_ARCHIVE_DIRECTORY);
    this.#now = options.now ?? (() => new Date());
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  }

  pathForPullRequest(prUrl: string): string {
    return containedPath(this.directory, codeReviewFileName(prUrl));
  }

  async create(input: CreateCodeReviewInput): Promise<CodeReviewState> {
    const state = createCodeReviewState({
      ...input,
      timestamp: input.timestamp ?? this.#timestamp()
    });
    const filePath = this.pathForPullRequest(state.prUrl);
    return this.#withLock(state.prUrl, async () => {
      if (await pathExists(filePath)) {
        throw new Error(`Code review already exists for pull request: ${state.prUrl}`);
      }
      await writeAtomically(filePath, serializeCodeReviewState(state));
      return state;
    });
  }

  async startRun(input: CreateCodeReviewInput): Promise<CodeReviewState> {
    const freshState = createCodeReviewState({
      ...input,
      timestamp: input.timestamp ?? this.#timestamp()
    });
    return this.#withLock(freshState.prUrl, async () => {
      const existing = await this.read(freshState.prUrl);
      if (existing && existing.state !== "published") {
        const resumedAt = this.#timestamp();
        const resumed = {
          ...existing,
          sessionId: freshState.sessionId,
          selectedAgent: freshState.selectedAgent,
          selectedProfiles: freshState.selectedProfiles,
          state: "in_progress" as const,
          mergedReview: undefined,
          rawReviews: {},
          subagents: {},
          orchestratorActions: [
            ...existing.orchestratorActions,
            { at: resumedAt, action: "resumed_run" }
          ]
        };
        return this.#save(resumed);
      }
      if (existing) {
        await ensureDirectory(this.archiveDirectory);
        await this.#archive(
          freshState.prUrl,
          existing.published?.publishedAt ?? freshState.timestamps.createdAt
        );
      }
      await writeAtomically(
        this.pathForPullRequest(freshState.prUrl),
        serializeCodeReviewState(freshState)
      );
      return freshState;
    });
  }

  async read(prUrl: string): Promise<CodeReviewState | undefined> {
    const filePath = this.pathForPullRequest(prUrl);
    try {
      await assertDirectoryPath(this.directory);
      const state = parseCodeReviewState(await readRegularFile(filePath), filePath);
      if (this.pathForPullRequest(state.prUrl) !== filePath) {
        throw new Error(`${filePath}: pr_ref does not match its filename.`);
      }
      return state;
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async addRawReview(
    prUrl: string,
    actor: string,
    review: CodeReviewDraft
  ): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => {
      const key = requireActor(actor);
      if (hasOwnRecordEntry(state.rawReviews, key)) {
        throw new Error(`Raw review is immutable after creation: ${key}`);
      }
      return {
        ...state,
        rawReviews: { ...state.rawReviews, [key]: review }
      };
    });
  }

  async updateSubagent(
    prUrl: string,
    actor: string,
    status: CodeReviewSubagentStatus
  ): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => ({
      ...state,
      subagents: { ...state.subagents, [requireActor(actor)]: status }
    }));
  }

  async addSubagent(
    prUrl: string,
    actor: string,
    status: CodeReviewSubagentStatus
  ): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => {
      const key = requireActor(actor);
      if (hasOwnRecordEntry(state.subagents, key)) {
        throw new Error(`Code review profile was already spawned in this session: ${key}`);
      }
      return {
        ...state,
        subagents: { ...state.subagents, [key]: status }
      };
    });
  }

  async setMergedReview(prUrl: string, review: CodeReviewDraft): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => {
      return {
        ...state,
        state: "merged",
        mergedReview: review
      };
    });
  }

  async editMergedInlineComment(
    prUrl: string,
    index: number,
    comment: CodeReviewInlineComment
  ): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => {
      const mergedReview = requireMergedReview(state);
      const commentIndex = requireInlineCommentIndex(index, mergedReview.comments.length);
      const comments = [...mergedReview.comments];
      comments[commentIndex] = comment;
      return {
        ...state,
        mergedReview: { ...mergedReview, comments }
      };
    });
  }

  async deleteMergedInlineComment(prUrl: string, index: number): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => {
      const mergedReview = requireMergedReview(state);
      const commentIndex = requireInlineCommentIndex(index, mergedReview.comments.length);
      return {
        ...state,
        mergedReview: {
          ...mergedReview,
          comments: mergedReview.comments.filter((_, currentIndex) => currentIndex !== commentIndex)
        }
      };
    });
  }

  async discardMergedReview(prUrl: string): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => {
      requireMergedReview(state);
      return { ...state, state: "in_progress", mergedReview: undefined };
    });
  }

  async appendOrchestratorAction(
    prUrl: string,
    action: Omit<CodeReviewOrchestratorAction, "at"> & { at?: string }
  ): Promise<CodeReviewState> {
    return this.#updateActive(prUrl, (state) => ({
      ...state,
      orchestratorActions: [
        ...state.orchestratorActions,
        { ...action, at: action.at ?? this.#timestamp() }
      ]
    }));
  }

  async commit(
    prUrl: string,
    receipt: Omit<CodeReviewPublishedReceipt, "publishedAt"> & {
      publishedAt?: string;
    }
  ): Promise<{ state: CodeReviewState; archivePath: string }> {
    return this.#withLock(prUrl, async () => {
      const state = await this.#requireActive(prUrl);
      if (state.mergedReview === undefined) {
        throw new Error("Code review must be merged before publishing.");
      }
      return this.#commitState(state, receipt);
    });
  }

  async publish<T>(
    prUrl: string,
    publish: (state: CodeReviewState) => Promise<{
      receipt: Omit<CodeReviewPublishedReceipt, "publishedAt"> & {
        publishedAt?: string;
      };
      result: T;
    }>
  ): Promise<{ state: CodeReviewState; archivePath: string; result: T }> {
    return this.#withLock(prUrl, async () => {
      const state = await this.#requireActive(prUrl);
      if (state.mergedReview === undefined) {
        throw new Error("Code review must be merged before publishing.");
      }
      if (hasUnresolvedPublicationClaim(state)) {
        throw new Error(
          "Code review publication may already have reached GitHub; refusing to submit a duplicate review without a persisted receipt."
        );
      }
      const claimed = await this.#save({
        ...state,
        orchestratorActions: [
          ...state.orchestratorActions,
          { at: this.#timestamp(), action: "publication_started" }
        ]
      });
      let publication: Awaited<ReturnType<typeof publish>>;
      try {
        publication = await publish(state);
      } catch (error) {
        await this.#save({
          ...claimed,
          orchestratorActions: [
            ...claimed.orchestratorActions,
            { at: this.#timestamp(), action: "publication_failed" }
          ]
        });
        throw error;
      }
      return {
        ...(await this.#commitState(claimed, publication.receipt)),
        result: publication.result
      };
    });
  }

  async resumePublished(
    prUrl: string
  ): Promise<{ state: CodeReviewState; archivePath: string } | undefined> {
    return this.#withLock(prUrl, async () => {
      const active = await this.read(prUrl);
      if (active?.state === "published" && active.published) {
        await ensureDirectory(this.archiveDirectory);
        return {
          state: active,
          archivePath: await this.#archive(prUrl, active.published.publishedAt)
        };
      }
      if (active) {
        return undefined;
      }
      return this.#findArchivedPublication(prUrl);
    });
  }

  async #require(prUrl: string): Promise<CodeReviewState> {
    const state = await this.read(prUrl);
    if (!state) {
      throw new Error(`Code review not found for pull request: ${prUrl}`);
    }
    return state;
  }

  async #requireActive(prUrl: string): Promise<CodeReviewState> {
    const state = await this.#require(prUrl);
    if (state.state === "published") {
      throw new Error("Published code reviews cannot be modified.");
    }
    return state;
  }

  async #save(state: CodeReviewState): Promise<CodeReviewState> {
    const updated = {
      ...state,
      timestamps: { ...state.timestamps, updatedAt: this.#timestamp() }
    };
    await writeAtomically(
      this.pathForPullRequest(updated.prUrl),
      serializeCodeReviewState(updated)
    );
    return updated;
  }

  async #commitState(
    state: CodeReviewState,
    receipt: Omit<CodeReviewPublishedReceipt, "publishedAt"> & {
      publishedAt?: string;
    }
  ): Promise<{ state: CodeReviewState; archivePath: string }> {
    const publishedAt = receipt.publishedAt ?? this.#timestamp();
    const publishedState = {
      ...state,
      state: "published",
      timestamps: {
        ...state.timestamps,
        updatedAt: publishedAt,
        publishedAt
      },
      published: { ...receipt, publishedAt }
    } satisfies CodeReviewState;
    await writeAtomically(
      this.pathForPullRequest(publishedState.prUrl),
      serializeCodeReviewState(publishedState)
    );
    await ensureDirectory(this.archiveDirectory);
    const archivePath = await this.#archive(state.prUrl, publishedAt);
    return { state: publishedState, archivePath };
  }

  async #updateActive(
    prUrl: string,
    update: (state: CodeReviewState) => CodeReviewState
  ): Promise<CodeReviewState> {
    return this.#withLock(prUrl, async () => this.#save(update(await this.#requireActive(prUrl))));
  }

  async #withLock<T>(prUrl: string, operation: () => Promise<T>): Promise<T> {
    await ensureDirectory(this.directory);
    return withFileLock(`${this.pathForPullRequest(prUrl)}.lock`, this.#lockTimeoutMs, operation);
  }

  async #archive(prUrl: string, publishedAt: string): Promise<string> {
    const sourcePath = this.pathForPullRequest(prUrl);
    await assertRegularFile(sourcePath);
    const filename = codeReviewFileName(prUrl);
    const suffix = publishedAt.replace(/[^0-9]/g, "");
    const stem = filename.slice(0, -".yaml".length);
    let sequence = 0;
    while (true) {
      const candidate =
        sequence === 0
          ? containedPath(this.archiveDirectory, filename)
          : containedPath(
              this.archiveDirectory,
              `${stem}_${sequence === 1 ? suffix : `${suffix}_${sequence - 1}`}.yaml`
            );
      try {
        await link(sourcePath, candidate);
        await unlink(sourcePath);
        return candidate;
      } catch (error) {
        if (!isExistingFileError(error)) {
          throw error;
        }
        if (await samePublishedState(sourcePath, candidate)) {
          await unlink(sourcePath);
          return candidate;
        }
      }
      sequence += 1;
    }
  }

  async #findArchivedPublication(
    prUrl: string
  ): Promise<{ state: CodeReviewState; archivePath: string } | undefined> {
    let names: string[];
    try {
      names = await readdir(this.archiveDirectory);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
    const stem = codeReviewFileName(prUrl).slice(0, -".yaml".length);
    const candidates: Array<{ state: CodeReviewState; archivePath: string }> = [];
    for (const name of names) {
      if (name !== `${stem}.yaml` && !name.startsWith(`${stem}_`)) continue;
      const archivePath = containedPath(this.archiveDirectory, name);
      try {
        const state = parseCodeReviewState(await readRegularFile(archivePath), archivePath);
        if (state.prUrl === canonicalPullRequestUrl(prUrl) && state.state === "published") {
          candidates.push({ state, archivePath });
        }
      } catch {
        // Ignore unrelated archive collisions while recovering a receipt.
      }
    }
    return candidates.sort((left, right) =>
      right.state.timestamps.updatedAt.localeCompare(left.state.timestamps.updatedAt)
    )[0];
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

async function samePublishedState(sourcePath: string, archivePath: string): Promise<boolean> {
  try {
    const source = parseCodeReviewState(await readRegularFile(sourcePath), sourcePath);
    const archived = parseCodeReviewState(await readRegularFile(archivePath), archivePath);
    return (
      source.state === "published" &&
      archived.state === "published" &&
      serializeCodeReviewState(source) === serializeCodeReviewState(archived)
    );
  } catch {
    return false;
  }
}


function hasUnresolvedPublicationClaim(state: CodeReviewState): boolean {
  for (let index = state.orchestratorActions.length - 1; index >= 0; index -= 1) {
    const action = state.orchestratorActions[index]?.action;
    if (action === "publication_started") return true;
    if (action === "publication_failed") return false;
  }
  return false;
}

function hasOwnRecordEntry(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

async function withFileLock<T>(
  lockPath: string,
  lockTimeoutMs: number,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  let lock: Awaited<ReturnType<typeof open>>;
  while (true) {
    try {
      lock = await open(lockPath, "wx");
      await lock.writeFile(`${process.pid}\n`, "utf8");
      break;
    } catch (error) {
      if (!isExistingFileError(error)) {
        throw error;
      }
      if (await isStaleLock(lockPath, lockTimeoutMs)) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= lockTimeoutMs) {
        throw new Error(`Timed out waiting for code review lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

async function isStaleLock(lockPath: string, lockTimeoutMs: number): Promise<boolean> {
  try {
    const ownerPid = Number.parseInt((await readFile(lockPath, "utf8")).trim(), 10);
    if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      return !isRunningProcess(ownerPid);
    }
    return Date.now() - (await stat(lockPath)).mtimeMs >= lockTimeoutMs;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function isRunningProcess(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !hasOwnErrorCode(error, "ESRCH");
  }
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const temporaryPath = containedPath(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`
  );
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
    const parent = await open(dirname(filePath), constants.O_RDONLY);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    await temporary?.close().catch(() => undefined);
    if (temporaryCreated) {
      await unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  const absoluteDirectory = resolve(directory);
  let currentDirectory = parse(absoluteDirectory).root;
  for (const segment of relative(currentDirectory, absoluteDirectory).split(sep).filter(Boolean)) {
    currentDirectory = resolve(currentDirectory, segment);
    try {
      await mkdir(currentDirectory);
    } catch (error) {
      if (!isExistingFileError(error)) {
        throw error;
      }
    }
    const status = await lstat(currentDirectory);
    if (!status.isDirectory()) {
      throw new Error(`Code review store path is not a regular directory: ${currentDirectory}`);
    }
  }
}

async function assertDirectoryPath(directory: string): Promise<void> {
  const absoluteDirectory = resolve(directory);
  let currentDirectory = parse(absoluteDirectory).root;
  for (const segment of relative(currentDirectory, absoluteDirectory).split(sep).filter(Boolean)) {
    currentDirectory = resolve(currentDirectory, segment);
    const status = await lstat(currentDirectory);
    if (!status.isDirectory()) {
      throw new Error(`Code review store path is not a regular directory: ${currentDirectory}`);
    }
  }
}

function containedPath(directory: string, name: string): string {
  if (!name || isAbsolute(name)) {
    throw new Error(`Code review path name is unsafe: ${name}`);
  }
  const root = resolve(directory);
  const target = resolve(root, name);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith("..") || fromRoot.startsWith(sep)) {
    throw new Error(`Code review path escapes store directory: ${target}`);
  }
  return target;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function readRegularFile(filePath: string): Promise<string> {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`Code review state path is not a regular file: ${filePath}`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function assertRegularFile(filePath: string): Promise<void> {
  if (!(await lstat(filePath)).isFile()) {
    throw new Error(`Code review state path is not a regular file: ${filePath}`);
  }
}

function requirePullRequestRef(prUrl: string) {
  const ref = parseGitHubPullRequestRef(prUrl);
  if (!ref) {
    throw new Error(`Invalid GitHub pull request URL: ${prUrl}`);
  }
  requireSafeDocumentSegment(ref.owner, "Pull request owner");
  requireSafeDocumentSegment(ref.repo, "Pull request repository");
  return ref;
}

function requireActor(actor: string): string {
  return requireSafeDocumentSegment(actor, "Code review actor");
}

function requireMergedReview(state: CodeReviewState): CodeReviewDraft {
  if (state.mergedReview === undefined) {
    throw new Error("Code review has no merged draft to modify.");
  }
  return state.mergedReview;
}

function requireInlineCommentIndex(index: number, commentCount: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= commentCount) {
    throw new Error(`Merged review inline comment index is out of range: ${index}`);
  }
  return index;
}

function safeFilePart(part: string): string {
  return filesystemSafeNamePart(part, "Code review filename segment");
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function isExistingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}
