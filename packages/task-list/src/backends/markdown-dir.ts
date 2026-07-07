import path from "node:path";
import { parseDocument, stringify } from "yaml";
import { TASK_SCHEMA_ID } from "../schema/ids.js";
import { eventsFromState, findEvent } from "../state-machine.js";
import { resolveStateMachine } from "../state.js";
import {
  AnchorNotFoundError,
  InvalidTransitionError,
  MalformedTaskError,
  OrderMismatchError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  type BackendDeps,
  type ListFilter,
  type MoveAnchor,
  type Task,
  type TaskCreate,
  type TaskFireOptions,
  type TaskList,
  type TaskListFs,
  type Tasks,
  type TaskUpdate
} from "../types.js";
import {
  applyOrder,
  hasErrorCode,
  isTrimmedPrintableIdentifier,
  isRecord,
  rejectSymbolicLinkComponents,
  sortStrings,
  statIfExists,
  validateTaskId,
  validateTaskName,
  withFileLock,
  writeAtomically,
  type OrderedEntry
} from "./utils.js";

const ARCHIVE_DIRECTORY_NAME = "archive";
const MARKDOWN_EXTENSION = ".md";
const TASK_KIND = "task";
const TASK_VERSION = 1;
const MIN_PREFIX_WIDTH = 2;
const RESERVED_FRONTMATTER_KEYS = new Set([
  "$schema",
  "created",
  "description",
  "kind",
  "name",
  "state",
  "version"
]);
const PASSTHROUGH_RESERVED_FRONTMATTER_KEYS = new Set(["description", "name", "state"]);

type TaskRecord = Record<string, unknown>;

type TaskFile = {
  task: Task;
  frontmatter: TaskRecord;
  path: string;
};

type TaskLocation = {
  archived: boolean;
  path: string;
};

type ListLayout = { kind: "multi" } | { kind: "single"; name: string };

function resolveListLayout(deps: BackendDeps): ListLayout {
  return deps.singleList ? { kind: "single", name: deps.singleList } : { kind: "multi" };
}

function validateListName(name: string): string {
  if (
    !isTrimmedPrintableIdentifier(name) ||
    name === ARCHIVE_DIRECTORY_NAME ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new Error(`Invalid task list name "${name}".`);
  }

  return name;
}

function parseQualifiedId(qualifiedId: string): {
  id: string;
  list: string;
} {
  const separatorIndex = qualifiedId.indexOf("/");

  if (
    separatorIndex <= 0 ||
    separatorIndex !== qualifiedId.lastIndexOf("/") ||
    separatorIndex === qualifiedId.length - 1
  ) {
    throw new Error(`Invalid qualified task id "${qualifiedId}".`);
  }

  return {
    list: validateListName(qualifiedId.slice(0, separatorIndex)),
    id: validateTaskId(qualifiedId.slice(separatorIndex + 1))
  };
}

function listPath(rootPath: string, layout: ListLayout, list: string): string {
  return layout.kind === "single" ? rootPath : path.join(rootPath, list);
}

function archiveDirectoryPath(rootPath: string, layout: ListLayout, list: string): string {
  return layout.kind === "single"
    ? path.join(rootPath, ARCHIVE_DIRECTORY_NAME)
    : path.join(rootPath, list, ARCHIVE_DIRECTORY_NAME);
}

function activeTaskFilename(id: string, order: number, width: number): string {
  return `${String(order).padStart(width, "0")}-${id}${MARKDOWN_EXTENSION}`;
}

function archivedTaskPath(rootPath: string, layout: ListLayout, list: string, id: string): string {
  return path.join(archiveDirectoryPath(rootPath, layout, list), `${id}${MARKDOWN_EXTENSION}`);
}

function isMarkdownFile(entryName: string): boolean {
  return entryName.endsWith(MARKDOWN_EXTENSION);
}

function isHiddenEntry(entryName: string): boolean {
  return entryName.startsWith(".");
}

function isValidTaskIdShape(id: string): boolean {
  return (
    id.length > 0 &&
    !id.startsWith(".") &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("..")
  );
}

function parseActiveFilename(entryName: string): { id: string; order: number | null } | undefined {
  if (!isMarkdownFile(entryName)) return undefined;
  const stem = entryName.slice(0, -MARKDOWN_EXTENSION.length);

  const match = /^(\d+)-(.+)$/.exec(stem);
  if (match) {
    const id = match[2];
    if (isValidTaskIdShape(id)) {
      return { id, order: Number.parseInt(match[1], 10) };
    }
  }

  if (isValidTaskIdShape(stem)) {
    return { id: stem, order: null };
  }

  return undefined;
}

function padWidthForCount(count: number): number {
  return Math.max(MIN_PREFIX_WIDTH, String(Math.max(count, 1)).length);
}

function malformedTask(filePath: string, field: string): MalformedTaskError {
  return new MalformedTaskError(`Malformed task "${filePath}": invalid "${field}".`);
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function splitTaskDocument(
  content: string,
  filePath: string,
  mode: BackendDeps["frontmatterMode"]
): {
  body: string;
  frontmatter: string;
} {
  const lines = content.split("\n");
  const hasFrontmatterBlock = lines.length > 0 && stripTrailingCarriageReturn(lines[0]) === "---";

  if (!hasFrontmatterBlock) {
    if (mode === "passthrough") {
      return { frontmatter: "", body: content };
    }
    throw malformedTask(filePath, "frontmatter");
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (stripTrailingCarriageReturn(lines[index]) === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    throw malformedTask(filePath, "frontmatter");
  }

  const bodyLines = lines.slice(closingIndex + 1);
  if (bodyLines.length > 0 && stripTrailingCarriageReturn(bodyLines[0]) === "") {
    bodyLines.shift();
  }

  return {
    frontmatter: lines.slice(1, closingIndex).join("\n"),
    body: bodyLines.join("\n")
  };
}

function readFrontmatter(frontmatterContent: string, filePath: string): TaskRecord {
  const document = parseDocument(frontmatterContent);

  if (document.errors.length > 0) {
    throw malformedTask(filePath, "frontmatter");
  }

  const parsed = document.toJS();
  if (!isRecord(parsed)) {
    throw malformedTask(filePath, "frontmatter");
  }

  return parsed;
}

function assertValidTaskRecord(
  frontmatter: TaskRecord,
  filePath: string,
  validStates: ReadonlySet<string>
): void {
  if (hasOwnTaskField(frontmatter, "$schema") && frontmatter.$schema !== TASK_SCHEMA_ID) {
    throw malformedTask(filePath, "$schema");
  }

  if (hasOwnTaskField(frontmatter, "kind") && frontmatter.kind !== TASK_KIND) {
    throw malformedTask(filePath, "kind");
  }

  if (hasOwnTaskField(frontmatter, "version")) {
    if (
      typeof frontmatter.version !== "number" ||
      !Number.isInteger(frontmatter.version) ||
      frontmatter.version !== TASK_VERSION
    ) {
      throw malformedTask(filePath, "version");
    }
  }

  if (
    !hasOwnTaskField(frontmatter, "name") ||
    typeof frontmatter.name !== "string" ||
    frontmatter.name.length === 0
  ) {
    throw malformedTask(filePath, "name");
  }

  if (
    !hasOwnTaskField(frontmatter, "state") ||
    typeof frontmatter.state !== "string" ||
    !validStates.has(frontmatter.state)
  ) {
    throw malformedTask(filePath, "state");
  }

  if (hasOwnTaskField(frontmatter, "description") && typeof frontmatter.description !== "string") {
    throw malformedTask(filePath, "description");
  }
}

function hasOwnTaskField(frontmatter: TaskRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, key);
}

function reservedFrontmatterKeys(mode: BackendDeps["frontmatterMode"]): ReadonlySet<string> {
  return mode === "passthrough" ? PASSTHROUGH_RESERVED_FRONTMATTER_KEYS : RESERVED_FRONTMATTER_KEYS;
}

function setOwnValue(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
}

function metadataFromFrontmatter(
  frontmatter: TaskRecord,
  mode: BackendDeps["frontmatterMode"]
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const reservedKeys = reservedFrontmatterKeys(mode);

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!reservedKeys.has(key)) {
      setOwnValue(metadata, key, value);
    }
  }

  return metadata;
}

function createTask(
  list: string,
  id: string,
  frontmatter: TaskRecord,
  body: string,
  mode: BackendDeps["frontmatterMode"],
  sourcePath?: string
): Task {
  return {
    list,
    id,
    qualifiedId: `${list}/${id}`,
    name: frontmatter.name as string,
    state: frontmatter.state as string,
    description: body,
    metadata: metadataFromFrontmatter(frontmatter, mode),
    ...(sourcePath !== undefined && { sourcePath: path.resolve(sourcePath) })
  };
}

function serializeTaskDocument(frontmatter: TaskRecord, description: string): string {
  return `---\n${stringify(frontmatter)}---\n\n${description}`;
}

async function readDirectoryNames(fs: TaskListFs, directoryPath: string): Promise<string[]> {
  try {
    return sortStrings(await fs.readdir(directoryPath));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function ensureRootPath(deps: BackendDeps): Promise<void> {
  await rejectSymbolicLinkComponents(deps.fs, deps.path);

  if (deps.create) {
    await deps.fs.mkdir(deps.path, { recursive: true });
    return;
  }

  await deps.fs.stat(deps.path);
}

async function readTaskFile(
  fs: TaskListFs,
  list: string,
  id: string,
  filePath: string,
  validStates: ReadonlySet<string>,
  initialState: string,
  mode: BackendDeps["frontmatterMode"]
): Promise<TaskFile> {
  await rejectSymbolicLinkComponents(fs, filePath);
  const content = await fs.readFile(filePath, "utf8");
  const document = splitTaskDocument(content, filePath, mode);
  const frontmatter =
    mode === "passthrough" && document.frontmatter.trim().length === 0
      ? {}
      : readFrontmatter(document.frontmatter, filePath);

  if (mode !== "passthrough") {
    assertValidTaskRecord(frontmatter, filePath, validStates);
    return {
      path: filePath,
      frontmatter,
      task: createTask(list, id, frontmatter, document.body, mode, filePath)
    };
  }

  const effectiveFrontmatter: TaskRecord = {
    ...frontmatter,
    name: typeof frontmatter.name === "string" ? frontmatter.name : id,
    state:
      typeof frontmatter.state === "string" && validStates.has(frontmatter.state)
        ? frontmatter.state
        : initialState
  };

  return {
    path: filePath,
    frontmatter,
    task: createTask(list, id, effectiveFrontmatter, document.body, mode, filePath)
  };
}

async function readPassthroughFrontmatter(
  fs: TaskListFs,
  filePath: string,
  mode: BackendDeps["frontmatterMode"]
): Promise<TaskRecord> {
  if (mode !== "passthrough") {
    return {};
  }

  const content = await fs.readFile(filePath, "utf8");
  const document = splitTaskDocument(content, filePath, mode);
  if (document.frontmatter.trim().length === 0) {
    return {};
  }

  return readFrontmatter(document.frontmatter, filePath);
}

async function resolveActiveFilenameEntry(
  fs: TaskListFs,
  entryName: string,
  entryPath: string,
  parsed: ActiveEntry,
  mode: BackendDeps["frontmatterMode"]
): Promise<ActiveEntry> {
  if (mode !== "passthrough" || parsed.order === null) {
    return parsed;
  }

  const frontmatter = await readPassthroughFrontmatter(fs, entryPath, mode);
  if (
    Object.keys(frontmatter).length === 0 &&
    orderedFilenamePrefixLength(entryName) <= MIN_PREFIX_WIDTH
  ) {
    return parsed;
  }

  if (
    typeof frontmatter.state === "string" ||
    hasOwnTaskField(frontmatter, "$schema") ||
    hasOwnTaskField(frontmatter, "kind") ||
    hasOwnTaskField(frontmatter, "version")
  ) {
    return parsed;
  }

  return {
    id: entryName.slice(0, -MARKDOWN_EXTENSION.length),
    order: null,
    filename: parsed.filename
  };
}

function orderedFilenamePrefixLength(entryName: string): number {
  const stem = entryName.slice(0, -MARKDOWN_EXTENSION.length);
  const separatorIndex = stem.indexOf("-");
  if (separatorIndex <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  for (let index = 0; index < separatorIndex; index += 1) {
    const code = stem.charCodeAt(index);
    if (code < 48 || code > 57) {
      return Number.POSITIVE_INFINITY;
    }
  }

  return separatorIndex;
}

async function findActiveTaskFilename(
  fs: TaskListFs,
  listDirectoryPath: string,
  id: string,
  mode: BackendDeps["frontmatterMode"]
): Promise<string | undefined> {
  const entries = await readDirectoryNames(fs, listDirectoryPath);
  for (const entryName of entries) {
    if (isHiddenEntry(entryName)) continue;
    const parsed = parseActiveFilename(entryName);
    if (!parsed) continue;

    const entryPath = path.join(listDirectoryPath, entryName);
    const resolved = await resolveActiveFilenameEntry(
      fs,
      entryName,
      entryPath,
      { id: parsed.id, order: parsed.order, filename: entryName },
      mode
    );
    if (resolved.id === id) {
      return entryName;
    }
  }
  return undefined;
}

async function findTaskLocation(
  fs: TaskListFs,
  rootPath: string,
  layout: ListLayout,
  list: string,
  id: string,
  mode: BackendDeps["frontmatterMode"]
): Promise<TaskLocation | undefined> {
  const listDirectoryPath = listPath(rootPath, layout, list);
  await rejectSymbolicLinkComponents(fs, listDirectoryPath);
  const activeName = await findActiveTaskFilename(fs, listDirectoryPath, id, mode);
  if (activeName) {
    const activePath = path.join(listDirectoryPath, activeName);
    await rejectSymbolicLinkComponents(fs, activePath);
    const activeStat = await statIfExists(fs, activePath);
    if (activeStat?.isFile()) {
      return { archived: false, path: activePath };
    }
  }

  const archivedPath = archivedTaskPath(rootPath, layout, list, id);
  await rejectSymbolicLinkComponents(fs, archiveDirectoryPath(rootPath, layout, list));
  await rejectSymbolicLinkComponents(fs, archivedPath);
  const archivedStat = await statIfExists(fs, archivedPath);
  if (archivedStat?.isFile()) {
    return { archived: true, path: archivedPath };
  }

  return undefined;
}

async function readTaskAtLocation(
  fs: TaskListFs,
  rootPath: string,
  layout: ListLayout,
  list: string,
  id: string,
  validStates: ReadonlySet<string>,
  initialState: string,
  mode: BackendDeps["frontmatterMode"]
): Promise<TaskFile> {
  const location = await findTaskLocation(fs, rootPath, layout, list, id, mode);

  if (!location) {
    throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
  }

  return readTaskFile(fs, list, id, location.path, validStates, initialState, mode);
}

function createdFrontmatter(
  defaults: BackendDeps["defaults"],
  input: TaskCreate,
  initialState: string,
  mode: BackendDeps["frontmatterMode"]
): TaskRecord {
  const frontmatter: TaskRecord =
    mode !== "passthrough"
      ? {
          $schema: TASK_SCHEMA_ID,
          kind: TASK_KIND,
          version: TASK_VERSION,
          name: input.name,
          state: initialState
        }
      : {
          name: input.name,
          state: initialState
        };
  const reservedKeys = reservedFrontmatterKeys(mode);

  for (const [key, value] of Object.entries(defaults.metadata)) {
    if (!reservedKeys.has(key)) {
      setOwnValue(frontmatter, key, value);
    }
  }

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (!reservedKeys.has(key)) {
      setOwnValue(frontmatter, key, value);
    }
  }

  frontmatter.created = new Date().toISOString();
  return frontmatter;
}

function updatedFrontmatter(
  existingFrontmatter: TaskRecord,
  task: Task,
  patch: TaskUpdate,
  mode: BackendDeps["frontmatterMode"]
): TaskRecord {
  const nextFrontmatter: TaskRecord =
    mode !== "passthrough"
      ? {
          ...existingFrontmatter,
          $schema: existingFrontmatter.$schema ?? TASK_SCHEMA_ID,
          kind: existingFrontmatter.kind ?? TASK_KIND,
          version: existingFrontmatter.version ?? TASK_VERSION,
          name: patch.name ?? task.name,
          state: task.state
        }
      : {
          ...existingFrontmatter,
          name: patch.name ?? task.name,
          state: task.state
        };
  const reservedKeys = reservedFrontmatterKeys(mode);

  for (const [key, value] of Object.entries(patch.metadata ?? {})) {
    if (!reservedKeys.has(key)) {
      setOwnValue(nextFrontmatter, key, value);
    }
  }

  return nextFrontmatter;
}

function transitionedFrontmatter(
  existingFrontmatter: TaskRecord,
  task: Task,
  to: string,
  mode: BackendDeps["frontmatterMode"]
): TaskRecord {
  return mode !== "passthrough"
    ? {
        ...existingFrontmatter,
        $schema: existingFrontmatter.$schema ?? TASK_SCHEMA_ID,
        kind: existingFrontmatter.kind ?? TASK_KIND,
        version: existingFrontmatter.version ?? TASK_VERSION,
        name: task.name,
        state: to
      }
    : {
        ...existingFrontmatter,
        name: task.name,
        state: to
      };
}

function firedFrontmatter(
  existingFrontmatter: TaskRecord,
  task: Task,
  to: string,
  mode: BackendDeps["frontmatterMode"],
  metadataPatch?: Record<string, unknown>
): TaskRecord {
  const nextFrontmatter = transitionedFrontmatter(existingFrontmatter, task, to, mode);
  const reservedKeys = reservedFrontmatterKeys(mode);

  for (const [key, value] of Object.entries(metadataPatch ?? {})) {
    if (!reservedKeys.has(key)) {
      setOwnValue(nextFrontmatter, key, value);
    }
  }

  return nextFrontmatter;
}

function assertCreateDoesNotSetState(input: TaskCreate): void {
  if (Object.prototype.hasOwnProperty.call(input, "state")) {
    throw new Error(
      'Tasks.create() does not accept "state"; new tasks always start at stateMachine.initial.'
    );
  }
}

function assertCreateHasId(input: TaskCreate): asserts input is TaskCreate & { id: string } {
  if (input.id === undefined) {
    throw new Error("id is required for markdown-dir backend");
  }
}

function assertUpdateDoesNotSetState(patch: TaskUpdate): void {
  if (Object.prototype.hasOwnProperty.call(patch, "state")) {
    throw new Error('Tasks.update() does not accept "state"; use fire() to change task state.');
  }
}

interface ActiveEntry {
  id: string;
  order: number | null;
  filename: string;
}

function createTasksView(deps: BackendDeps, layout: ListLayout, list: string): Tasks {
  const listDirectoryPath = listPath(deps.path, layout, list);
  const stateMachine = resolveStateMachine(deps.stateMachine);
  const validStates = new Set(stateMachine.states);

  async function readActiveEntries(): Promise<ActiveEntry[]> {
    await rejectSymbolicLinkComponents(deps.fs, listDirectoryPath);
    const entries = await readDirectoryNames(deps.fs, listDirectoryPath);
    const result: ActiveEntry[] = [];

    for (const entryName of entries) {
      if (isHiddenEntry(entryName)) continue;
      const parsed = parseActiveFilename(entryName);
      if (!parsed) continue;

      const entryPath = path.join(listDirectoryPath, entryName);
      await rejectSymbolicLinkComponents(deps.fs, entryPath);
      const entryStat = await statIfExists(deps.fs, entryPath);
      if (!entryStat?.isFile()) continue;

      result.push(
        await resolveActiveFilenameEntry(
          deps.fs,
          entryName,
          entryPath,
          { id: parsed.id, order: parsed.order, filename: entryName },
          deps.frontmatterMode
        )
      );
    }

    result.sort((left, right) => {
      const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
      const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.filename.localeCompare(right.filename);
    });

    return result;
  }

  async function readActiveTasks(): Promise<{
    entries: ActiveEntry[];
    tasks: Map<string, { task: Task; raw: TaskRecord }>;
  }> {
    const entries = await readActiveEntries();
    const tasks = new Map<string, { task: Task; raw: TaskRecord }>();

    for (const entry of entries) {
      const filePath = path.join(listDirectoryPath, entry.filename);
      const file = await readTaskFile(
        deps.fs,
        list,
        entry.id,
        filePath,
        validStates,
        stateMachine.initial,
        deps.frontmatterMode
      );
      tasks.set(entry.id, { task: file.task, raw: file.frontmatter });
    }

    return { entries, tasks };
  }

  async function readArchivedTasks(): Promise<{ task: Task; raw: TaskRecord }[]> {
    const archivePath = archiveDirectoryPath(deps.path, layout, list);
    await rejectSymbolicLinkComponents(deps.fs, archivePath);
    const entries = await readDirectoryNames(deps.fs, archivePath);
    const result: { task: Task; raw: TaskRecord }[] = [];

    for (const entryName of entries) {
      if (isHiddenEntry(entryName) || !isMarkdownFile(entryName)) continue;

      const entryPath = path.join(archivePath, entryName);
      await rejectSymbolicLinkComponents(deps.fs, entryPath);
      const entryStat = await statIfExists(deps.fs, entryPath);
      if (!entryStat?.isFile()) continue;

      const id = entryName.slice(0, -MARKDOWN_EXTENSION.length);
      const file = await readTaskFile(
        deps.fs,
        list,
        id,
        entryPath,
        validStates,
        stateMachine.initial,
        deps.frontmatterMode
      );
      result.push({ task: file.task, raw: file.frontmatter });
    }

    return result.sort((left, right) =>
      left.task.qualifiedId.localeCompare(right.task.qualifiedId)
    );
  }

  async function renameActiveEntries(
    entries: ActiveEntry[],
    desiredOrdersById: ReadonlyMap<string, number>
  ): Promise<void> {
    const staged: { original: string; staging: string; target: string; finalized: boolean }[] = [];
    const maxOrder = Math.max(...desiredOrdersById.values(), entries.length);
    const width = padWidthForCount(maxOrder);

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const desiredOrder = desiredOrdersById.get(entry.id);
      if (desiredOrder === undefined) continue;

      const desiredFilename = activeTaskFilename(entry.id, desiredOrder, width);
      if (entry.filename !== desiredFilename) {
        const fromPath = path.join(listDirectoryPath, entry.filename);
        const stagingPath = path.join(
          listDirectoryPath,
          `${desiredFilename}.staging-${process.pid}-${index}`
        );
        const targetPath = path.join(listDirectoryPath, desiredFilename);
        try {
          await deps.fs.rename(fromPath, stagingPath);
          staged.push({
            original: fromPath,
            staging: stagingPath,
            target: targetPath,
            finalized: false
          });
        } catch (error) {
          for (const stagedEntry of staged.reverse()) {
            await deps.fs.rename(stagedEntry.staging, stagedEntry.original);
          }
          throw error;
        }
      }
    }

    try {
      for (const entry of staged) {
        await deps.fs.rename(entry.staging, entry.target);
        entry.finalized = true;
      }
    } catch (error) {
      for (const entry of staged.filter((stagedEntry) => stagedEntry.finalized).reverse()) {
        await deps.fs.rename(entry.target, entry.staging);
      }
      for (const entry of staged.reverse()) {
        await deps.fs.rename(entry.staging, entry.original);
      }
      throw error;
    }
  }

  async function rewriteListPrefixes(orderedIds: readonly string[]): Promise<void> {
    const entries = await readActiveEntries();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const desiredOrdersById = new Map<string, number>();

    for (let index = 0; index < orderedIds.length; index += 1) {
      const id = orderedIds[index];
      const entry = byId.get(id);
      if (!entry) continue;

      desiredOrdersById.set(id, index + 1);
    }

    await renameActiveEntries(entries, desiredOrdersById);
  }

  function entryOrder(entry: ActiveEntry, index: number): number {
    return entry.order ?? index + 1;
  }

  async function rewriteMovedPrefix(movedId: string, orderedIds: readonly string[]): Promise<void> {
    const entries = await readActiveEntries();
    const byId = new Map(entries.map((entry, index) => [entry.id, { entry, index }]));
    const movedIndex = orderedIds.indexOf(movedId);
    const moved = byId.get(movedId);
    if (movedIndex < 0 || moved === undefined) return;

    const desiredOrdersById = new Map<string, number>();
    const previousId = movedIndex > 0 ? orderedIds[movedIndex - 1] : undefined;
    const nextId = movedIndex < orderedIds.length - 1 ? orderedIds[movedIndex + 1] : undefined;
    const previous = previousId === undefined ? undefined : byId.get(previousId);
    const next = nextId === undefined ? undefined : byId.get(nextId);

    if (previous !== undefined && next === undefined) {
      desiredOrdersById.set(movedId, entryOrder(previous.entry, previous.index) + 1);
      await renameActiveEntries(entries, desiredOrdersById);
      return;
    }

    if (previous === undefined && next !== undefined) {
      const nextOrder = entryOrder(next.entry, next.index);
      if (nextOrder > 1) {
        desiredOrdersById.set(movedId, nextOrder - 1);
        await renameActiveEntries(entries, desiredOrdersById);
        return;
      }

      desiredOrdersById.set(movedId, 1);
      let lastOrder = 1;
      for (let index = movedIndex + 1; index < orderedIds.length; index += 1) {
        const candidate = byId.get(orderedIds[index]);
        if (candidate === undefined) continue;

        const currentOrder = entryOrder(candidate.entry, candidate.index);
        if (currentOrder > lastOrder) break;

        lastOrder += 1;
        desiredOrdersById.set(candidate.entry.id, lastOrder);
      }

      await renameActiveEntries(entries, desiredOrdersById);
      return;
    }

    if (previous !== undefined && next !== undefined) {
      const previousOrder = entryOrder(previous.entry, previous.index);
      const nextOrder = entryOrder(next.entry, next.index);

      if (nextOrder - previousOrder > 1) {
        desiredOrdersById.set(movedId, previousOrder + 1);
        await renameActiveEntries(entries, desiredOrdersById);
        return;
      }

      let lastOrder = previousOrder + 1;
      desiredOrdersById.set(movedId, lastOrder);
      for (let index = movedIndex + 1; index < orderedIds.length; index += 1) {
        const candidate = byId.get(orderedIds[index]);
        if (candidate === undefined) continue;

        const currentOrder = entryOrder(candidate.entry, candidate.index);
        if (currentOrder > lastOrder) break;

        lastOrder += 1;
        desiredOrdersById.set(candidate.entry.id, lastOrder);
      }

      await renameActiveEntries(entries, desiredOrdersById);
    }
  }

  async function getTaskFile(id: string): Promise<TaskFile> {
    validateTaskId(id);
    return readTaskAtLocation(
      deps.fs,
      deps.path,
      layout,
      list,
      id,
      validStates,
      stateMachine.initial,
      deps.frontmatterMode
    );
  }

  function assertFireableTaskEvent(task: Task, eventName: string) {
    const event = findEvent(stateMachine, task.state, eventName);

    if (event === undefined) {
      throw new InvalidTransitionError({
        task,
        event: eventName,
        to: stateMachine.events[eventName]?.to,
        reason: `Cannot fire event "${eventName}" from task state "${task.state}".`
      });
    }

    return event;
  }

  return {
    name: list,
    stateMachine,
    async all(filter?: ListFilter): Promise<Task[]> {
      const { entries: activeEntries, tasks: activeTasks } = await readActiveTasks();
      const archivedEntries = filter?.includeArchived ? await readArchivedTasks() : [];

      const orderedActive: OrderedEntry[] = activeEntries
        .map((entry) => activeTasks.get(entry.id)!)
        .filter((entry) => {
          if (filter?.state && entry.task.state !== filter.state) return false;
          return true;
        });

      const filteredArchived = archivedEntries.filter((entry) => {
        if (filter?.state && entry.task.state !== filter.state) return false;
        return true;
      });

      return applyOrder([...orderedActive, ...filteredArchived], filter?.order);
    },
    async get(id: string): Promise<Task> {
      return (await getTaskFile(id)).task;
    },
    async create(input: TaskCreate): Promise<Task> {
      assertCreateDoesNotSetState(input);
      assertCreateHasId(input);
      validateTaskId(input.id);
      validateTaskName(input.name);
      await rejectSymbolicLinkComponents(deps.fs, listDirectoryPath);
      return withFileLock(deps.fs, path.join(listDirectoryPath, ".transition.lock"), async () => {
        const existing = await findTaskLocation(
          deps.fs,
          deps.path,
          layout,
          list,
          input.id,
          deps.frontmatterMode
        );
        if (existing) {
          throw new TaskAlreadyExistsError(`Task "${list}/${input.id}" already exists.`);
        }

        const activeEntries = await readActiveEntries();
        const maxOrder = activeEntries.reduce(
          (max, entry) => (entry.order !== null && entry.order > max ? entry.order : max),
          0
        );
        const nextOrder = maxOrder + 1;
        const width = padWidthForCount(activeEntries.length + 1);
        const filename = activeTaskFilename(input.id, nextOrder, width);
        const targetPath = path.join(listDirectoryPath, filename);

        const frontmatter = createdFrontmatter(
          deps.defaults,
          input,
          stateMachine.initial,
          deps.frontmatterMode
        );
        const description = input.description ?? "";

        await writeAtomically(deps.fs, targetPath, serializeTaskDocument(frontmatter, description));

        return createTask(
          list,
          input.id,
          frontmatter,
          description,
          deps.frontmatterMode,
          targetPath
        );
      });
    },
    async update(id: string, patch: TaskUpdate): Promise<Task> {
      assertUpdateDoesNotSetState(patch);
      validateTaskId(id);
      if (patch.name !== undefined) {
        validateTaskName(patch.name);
      }

      const existing = await getTaskFile(id);
      const nextFrontmatter = updatedFrontmatter(
        existing.frontmatter,
        existing.task,
        patch,
        deps.frontmatterMode
      );
      const description = patch.description ?? existing.task.description;

      await writeAtomically(
        deps.fs,
        existing.path,
        serializeTaskDocument(nextFrontmatter, description)
      );

      return createTask(
        list,
        id,
        nextFrontmatter,
        description,
        deps.frontmatterMode,
        existing.path
      );
    },
    async fire(id: string, eventName: string, opts?: TaskFireOptions): Promise<Task> {
      const fireTask = async () => {
        const existing = await getTaskFile(id);
        const event = assertFireableTaskEvent(existing.task, eventName);
        const guardResult = event.guard?.(existing.task) ?? true;

        if (guardResult !== true) {
          throw new InvalidTransitionError({
            task: existing.task,
            event: eventName,
            to: event.to,
            reason: guardResult
          });
        }

        await event.onExit?.(existing.task);

        const nextFrontmatter = firedFrontmatter(
          existing.frontmatter,
          existing.task,
          event.to,
          deps.frontmatterMode,
          opts?.metadataPatch
        );
        const serializedTask = serializeTaskDocument(nextFrontmatter, existing.task.description);

        if (event.to === "archived") {
          const targetPath = archivedTaskPath(deps.path, layout, list, id);
          await rejectSymbolicLinkComponents(
            deps.fs,
            archiveDirectoryPath(deps.path, layout, list)
          );
          const archivedTargetExists = await statIfExists(deps.fs, targetPath);
          if (archivedTargetExists?.isFile()) {
            throw new TaskAlreadyExistsError(`Task "${list}/${id}" already exists in archive.`);
          }

          await deps.fs.mkdir(archiveDirectoryPath(deps.path, layout, list), { recursive: true });
          await writeAtomically(deps.fs, targetPath, serializedTask);
          try {
            await deps.fs.unlink(existing.path);
          } catch (error) {
            await deps.fs.unlink(targetPath);
            throw error;
          }
          const nextTask = createTask(
            list,
            id,
            nextFrontmatter,
            existing.task.description,
            deps.frontmatterMode,
            targetPath
          );
          return { event, nextTask };
        }

        await writeAtomically(deps.fs, existing.path, serializedTask);
        const nextTask = createTask(
          list,
          id,
          nextFrontmatter,
          existing.task.description,
          deps.frontmatterMode,
          existing.path
        );
        return { event, nextTask };
      };

      if (stateMachine.events[eventName]?.to === "archived") {
        validateTaskId(id);
        const location = await findTaskLocation(
          deps.fs,
          deps.path,
          layout,
          list,
          id,
          deps.frontmatterMode
        );
        if (!location) {
          throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
        }
      }

      validateTaskId(id);
      const { event, nextTask } = await withFileLock(
        deps.fs,
        path.join(listDirectoryPath, ".transition.lock"),
        fireTask
      );

      await event.onEnter?.(nextTask);

      return nextTask;
    },
    async canFire(id: string, eventName: string): Promise<boolean> {
      const task = (await getTaskFile(id)).task;
      const event = findEvent(stateMachine, task.state, eventName);

      if (event === undefined) {
        return false;
      }

      return (event.guard?.(task) ?? true) === true;
    },
    async events(id: string): Promise<readonly string[]> {
      const task = (await getTaskFile(id)).task;
      return eventsFromState(stateMachine, task.state);
    },
    async delete(id: string): Promise<void> {
      validateTaskId(id);
      const location = await findTaskLocation(
        deps.fs,
        deps.path,
        layout,
        list,
        id,
        deps.frontmatterMode
      );
      if (!location) {
        throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
      }

      await deps.fs.unlink(location.path);
    },
    async move(id: string, anchor: MoveAnchor): Promise<Task> {
      validateTaskId(id);

      const { entries } = await readActiveTasks();
      const fromIndex = entries.findIndex((entry) => entry.id === id);
      if (fromIndex < 0) {
        throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
      }

      const ordered = entries.map((entry) => entry.id);
      ordered.splice(fromIndex, 1);

      let insertIndex: number;
      if ("position" in anchor) {
        insertIndex = anchor.position === "top" ? 0 : ordered.length;
      } else {
        const anchorId = "before" in anchor ? anchor.before : anchor.after;
        const anchorIndex = ordered.indexOf(anchorId);
        if (anchorIndex < 0) {
          throw new AnchorNotFoundError(anchorId);
        }
        insertIndex = "before" in anchor ? anchorIndex : anchorIndex + 1;
      }

      ordered.splice(insertIndex, 0, id);
      await rewriteMovedPrefix(id, ordered);

      return (await getTaskFile(id)).task;
    },
    async reorder(ids: readonly string[]): Promise<readonly Task[]> {
      for (const id of ids) {
        validateTaskId(id);
      }

      const { entries } = await readActiveTasks();
      const currentIds = entries.map((entry) => entry.id);
      const currentSet = new Set(currentIds);
      const inputSet = new Set(ids);
      const missing = currentIds.filter((id) => !inputSet.has(id));
      const extra = ids.filter((id) => !currentSet.has(id));

      if (inputSet.size !== ids.length || missing.length > 0 || extra.length > 0) {
        throw new OrderMismatchError({ missing, extra });
      }

      await rewriteListPrefixes(ids);

      return Promise.all(ids.map(async (id) => (await getTaskFile(id)).task));
    }
  };
}

export async function markdownDirBackend(deps: BackendDeps): Promise<TaskList> {
  await ensureRootPath(deps);
  const layout = resolveListLayout(deps);
  const stateMachine = resolveStateMachine(deps.stateMachine);
  const validStates = new Set(stateMachine.states);

  const list = (name: string): Tasks => {
    if (layout.kind === "single") {
      if (name !== layout.name) {
        throw new Error(`Task list "${name}" not found.`);
      }

      return createTasksView(deps, layout, name);
    }

    const listName = validateListName(name);
    return createTasksView(deps, layout, listName);
  };

  const lists = async (): Promise<string[]> => {
    if (layout.kind === "single") {
      return [layout.name];
    }

    const entries = await readDirectoryNames(deps.fs, deps.path);
    const result: string[] = [];

    for (const entryName of entries) {
      if (entryName === ARCHIVE_DIRECTORY_NAME || isHiddenEntry(entryName)) {
        continue;
      }

      const entryPath = path.join(deps.path, entryName);
      await rejectSymbolicLinkComponents(deps.fs, entryPath);
      const entryStat = await statIfExists(deps.fs, entryPath);
      if (entryStat?.isDirectory()) {
        result.push(entryName);
      }
    }

    return sortStrings(result);
  };

  const allTasks = async (filter?: ListFilter): Promise<Task[]> => {
    const allLists = await lists();
    const tasks: Task[] = [];

    for (const taskListName of allLists) {
      tasks.push(...(await list(taskListName).all(filter)));
    }

    return tasks;
  };

  const get = async (qualifiedId: string): Promise<Task> => {
    const { list: listName, id } = parseQualifiedId(qualifiedId);
    return list(listName).get(id);
  };

  const moveBetweenLists = async (qualifiedId: string, targetList: string): Promise<Task> => {
    if (layout.kind === "single") {
      throw new Error("moveBetweenLists is unsupported in single-list mode.");
    }

    const { list: sourceListName, id } = parseQualifiedId(qualifiedId);
    const targetListName = validateListName(targetList);

    if (sourceListName === targetListName) {
      const file = await readTaskAtLocation(
        deps.fs,
        deps.path,
        layout,
        sourceListName,
        id,
        validStates,
        stateMachine.initial,
        deps.frontmatterMode
      );
      return file.task;
    }

    const targetListDir = listPath(deps.path, layout, targetListName);
    await rejectSymbolicLinkComponents(deps.fs, targetListDir);
    return withFileLock(deps.fs, path.join(targetListDir, ".transition.lock"), async () => {
      const targetExisting = await findTaskLocation(
        deps.fs,
        deps.path,
        layout,
        targetListName,
        id,
        deps.frontmatterMode
      );
      if (targetExisting) {
        throw new TaskAlreadyExistsError(`Task "${targetListName}/${id}" already exists.`);
      }

      const sourceLocation = await findTaskLocation(
        deps.fs,
        deps.path,
        layout,
        sourceListName,
        id,
        deps.frontmatterMode
      );
      if (!sourceLocation) {
        throw new TaskNotFoundError(`Task "${sourceListName}/${id}" not found.`);
      }

      const sourceFile = await readTaskFile(
        deps.fs,
        sourceListName,
        id,
        sourceLocation.path,
        validStates,
        stateMachine.initial,
        deps.frontmatterMode
      );
      const targetEntries = await (async () => {
        const out: ActiveEntry[] = [];
        const names = await readDirectoryNames(deps.fs, targetListDir);
        for (const entryName of names) {
          if (isHiddenEntry(entryName)) continue;
          const parsed = parseActiveFilename(entryName);
          if (!parsed) continue;
          out.push({ id: parsed.id, order: parsed.order, filename: entryName });
        }
        return out;
      })();

      if (sourceLocation.archived) {
        const archivedTargetDir = archiveDirectoryPath(deps.path, layout, targetListName);
        await rejectSymbolicLinkComponents(deps.fs, archivedTargetDir);
        await deps.fs.mkdir(archivedTargetDir, { recursive: true });
        const archivedTargetPath = archivedTaskPath(deps.path, layout, targetListName, id);
        await deps.fs.rename(sourceLocation.path, archivedTargetPath);
        return createTask(
          targetListName,
          id,
          sourceFile.frontmatter,
          sourceFile.task.description,
          deps.frontmatterMode,
          archivedTargetPath
        );
      }

      const maxOrder = targetEntries.reduce(
        (max, entry) => (entry.order !== null && entry.order > max ? entry.order : max),
        0
      );
      const width = padWidthForCount(targetEntries.length + 1);
      const targetFilename = activeTaskFilename(id, maxOrder + 1, width);
      const targetPath = path.join(targetListDir, targetFilename);

      await deps.fs.rename(sourceLocation.path, targetPath);
      return createTask(
        targetListName,
        id,
        sourceFile.frontmatter,
        sourceFile.task.description,
        deps.frontmatterMode,
        targetPath
      );
    });
  };

  return {
    list,
    lists,
    allTasks,
    get,
    moveBetweenLists
  };
}
