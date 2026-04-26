import path from "node:path";
import { acquireFileLock } from "@poe-code/file-lock";
import { parseDocument, stringify } from "yaml";
import taskSchema from "../schema/task.schema.json" with { type: "json" };
import { eventsFromState, findEvent } from "../state-machine.js";
import { assertTransition, resolveStateMachine } from "../state.js";
import {
  InvalidTransitionError,
  MalformedTaskError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  type BackendDeps,
  type ListFilter,
  type Task,
  type TaskCreate,
  type TaskFireOptions,
  type TaskList,
  type TaskListFs,
  type Tasks,
  type TaskUpdate
} from "../types.js";
import {
  hasErrorCode,
  isRecord,
  sortStrings,
  sortTasks,
  statIfExists,
  validateTaskId,
  writeAtomically
} from "./utils.js";

const ARCHIVE_DIRECTORY_NAME = "archive";
const MARKDOWN_EXTENSION = ".md";
const TASK_KIND = "task";
const TASK_VERSION = 1;
const TASK_SCHEMA_ID = taskSchema.$id;
const RESERVED_FRONTMATTER_KEYS = new Set([
  "$schema",
  "description",
  "kind",
  "name",
  "state",
  "version"
]);

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

function validateListName(name: string): string {
  if (
    name.length === 0 ||
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

function listPath(rootPath: string, list: string): string {
  return path.join(rootPath, list);
}

function archiveDirectoryPath(rootPath: string, list: string): string {
  return path.join(listPath(rootPath, list), ARCHIVE_DIRECTORY_NAME);
}

function activeTaskPath(rootPath: string, list: string, id: string): string {
  return path.join(listPath(rootPath, list), `${id}${MARKDOWN_EXTENSION}`);
}

function archivedTaskPath(rootPath: string, list: string, id: string): string {
  return path.join(archiveDirectoryPath(rootPath, list), `${id}${MARKDOWN_EXTENSION}`);
}

function isMarkdownFile(entryName: string): boolean {
  return entryName.endsWith(MARKDOWN_EXTENSION);
}

function isHiddenEntry(entryName: string): boolean {
  return entryName.startsWith(".");
}

function isLockFile(entryName: string): boolean {
  return entryName.endsWith(".lock");
}

function malformedTask(filePath: string, field: string): MalformedTaskError {
  return new MalformedTaskError(`Malformed task "${filePath}": invalid "${field}".`);
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function splitTaskDocument(content: string, filePath: string): {
  body: string;
  frontmatter: string;
} {
  const lines = content.split("\n");

  if (lines.length === 0 || stripTrailingCarriageReturn(lines[0]) !== "---") {
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
  if ("$schema" in frontmatter && frontmatter.$schema !== TASK_SCHEMA_ID) {
    throw malformedTask(filePath, "$schema");
  }

  if ("kind" in frontmatter && frontmatter.kind !== TASK_KIND) {
    throw malformedTask(filePath, "kind");
  }

  if ("version" in frontmatter) {
    if (
      typeof frontmatter.version !== "number" ||
      !Number.isInteger(frontmatter.version) ||
      frontmatter.version !== TASK_VERSION
    ) {
      throw malformedTask(filePath, "version");
    }
  }

  if (typeof frontmatter.name !== "string" || frontmatter.name.length === 0) {
    throw malformedTask(filePath, "name");
  }

  if (typeof frontmatter.state !== "string" || !validStates.has(frontmatter.state)) {
    throw malformedTask(filePath, "state");
  }

  if ("description" in frontmatter && typeof frontmatter.description !== "string") {
    throw malformedTask(filePath, "description");
  }
}

function metadataFromFrontmatter(frontmatter: TaskRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) {
      metadata[key] = value;
    }
  }

  return metadata;
}

function createTask(list: string, id: string, frontmatter: TaskRecord, body: string): Task {
  return {
    list,
    id,
    qualifiedId: `${list}/${id}`,
    name: frontmatter.name as string,
    state: frontmatter.state as string,
    description: body,
    metadata: metadataFromFrontmatter(frontmatter)
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
  validStates: ReadonlySet<string>
): Promise<TaskFile> {
  const content = await fs.readFile(filePath, "utf8");
  const document = splitTaskDocument(content, filePath);
  const frontmatter = readFrontmatter(document.frontmatter, filePath);

  assertValidTaskRecord(frontmatter, filePath, validStates);

  return {
    path: filePath,
    frontmatter,
    task: createTask(list, id, frontmatter, document.body)
  };
}

async function findTaskLocation(
  fs: TaskListFs,
  rootPath: string,
  list: string,
  id: string
): Promise<TaskLocation | undefined> {
  const activePath = activeTaskPath(rootPath, list, id);
  const activeStat = await statIfExists(fs, activePath);

  if (activeStat?.isFile()) {
    return {
      archived: false,
      path: activePath
    };
  }

  const archivedPath = archivedTaskPath(rootPath, list, id);
  const archivedStat = await statIfExists(fs, archivedPath);

  if (archivedStat?.isFile()) {
    return {
      archived: true,
      path: archivedPath
    };
  }

  return undefined;
}

async function readTaskAtLocation(
  fs: TaskListFs,
  rootPath: string,
  list: string,
  id: string,
  validStates: ReadonlySet<string>
): Promise<TaskFile> {
  const location = await findTaskLocation(fs, rootPath, list, id);

  if (!location) {
    throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
  }

  return readTaskFile(fs, list, id, location.path, validStates);
}

function createdFrontmatter(defaults: BackendDeps["defaults"], input: TaskCreate): TaskRecord {
  const frontmatter: TaskRecord = {
    $schema: TASK_SCHEMA_ID,
    kind: TASK_KIND,
    version: TASK_VERSION,
    name: input.name,
    state: input.state ?? defaults.state
  };

  for (const [key, value] of Object.entries(defaults.metadata)) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) {
      frontmatter[key] = value;
    }
  }

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) {
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

function updatedFrontmatter(
  existingFrontmatter: TaskRecord,
  task: Task,
  patch: TaskUpdate
): TaskRecord {
  const nextFrontmatter: TaskRecord = {
    ...existingFrontmatter,
    $schema: existingFrontmatter.$schema ?? TASK_SCHEMA_ID,
    kind: existingFrontmatter.kind ?? TASK_KIND,
    version: existingFrontmatter.version ?? TASK_VERSION,
    name: patch.name ?? task.name,
    state: task.state
  };

  for (const [key, value] of Object.entries(patch.metadata ?? {})) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) {
      nextFrontmatter[key] = value;
    }
  }

  return nextFrontmatter;
}

function transitionedFrontmatter(existingFrontmatter: TaskRecord, task: Task, to: string): TaskRecord {
  return {
    ...existingFrontmatter,
    $schema: existingFrontmatter.$schema ?? TASK_SCHEMA_ID,
    kind: existingFrontmatter.kind ?? TASK_KIND,
    version: existingFrontmatter.version ?? TASK_VERSION,
    name: task.name,
    state: to
  };
}

function firedFrontmatter(
  existingFrontmatter: TaskRecord,
  task: Task,
  to: string,
  metadataPatch?: Record<string, unknown>
): TaskRecord {
  const nextFrontmatter = transitionedFrontmatter(existingFrontmatter, task, to);

  for (const [key, value] of Object.entries(metadataPatch ?? {})) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) {
      nextFrontmatter[key] = value;
    }
  }

  return nextFrontmatter;
}

function createTasksView(deps: BackendDeps, list: string): Tasks {
  const listDirectoryPath = listPath(deps.path, list);
  const stateMachine = resolveStateMachine(deps.stateMachine);
  const validStates = new Set(stateMachine.states);

  function assertValidTaskState(state: string): void {
    if (!validStates.has(state)) {
      throw new Error(`Invalid task state "${state}".`);
    }
  }

  async function listFiles(directoryPath: string): Promise<Task[]> {
    const entries = await readDirectoryNames(deps.fs, directoryPath);
    const tasks: Task[] = [];

    for (const entryName of entries) {
      if (isHiddenEntry(entryName) || isLockFile(entryName) || !isMarkdownFile(entryName)) {
        continue;
      }

      const entryPath = path.join(directoryPath, entryName);
      const entryStat = await statIfExists(deps.fs, entryPath);
      if (!entryStat?.isFile()) {
        continue;
      }

      const id = entryName.slice(0, -MARKDOWN_EXTENSION.length);
      tasks.push((await readTaskFile(deps.fs, list, id, entryPath, validStates)).task);
    }

    return sortTasks(tasks);
  }

  async function withTaskLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    validateTaskId(id);
    const release = await acquireFileLock(activeTaskPath(deps.path, list, id), {
      fs: deps.fs,
      staleMs: deps.lockStaleMs,
      retries: deps.lockRetries
    });

    try {
      return await action();
    } finally {
      await release();
    }
  }

  async function getTaskFile(id: string): Promise<TaskFile> {
    validateTaskId(id);
    return readTaskAtLocation(deps.fs, deps.path, list, id, validStates);
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
      const activeTasks = await listFiles(listDirectoryPath);
      const archivedTasks = filter?.includeArchived
        ? await listFiles(archiveDirectoryPath(deps.path, list))
        : [];
      const combinedTasks = [...activeTasks, ...archivedTasks];

      if (filter?.state) {
        return combinedTasks.filter((task) => task.state === filter.state);
      }

      return combinedTasks;
    },
    async get(id: string): Promise<Task> {
      return (await getTaskFile(id)).task;
    },
    async create(input: TaskCreate): Promise<Task> {
      validateTaskId(input.id);
      assertValidTaskState(input.state ?? deps.defaults.state);
      await deps.fs.mkdir(listDirectoryPath, { recursive: true });

      return withTaskLock(input.id, async () => {
        const existing = await findTaskLocation(deps.fs, deps.path, list, input.id);
        if (existing) {
          throw new TaskAlreadyExistsError(`Task "${list}/${input.id}" already exists.`);
        }

        const targetPath = activeTaskPath(deps.path, list, input.id);
        const frontmatter = createdFrontmatter(deps.defaults, input);
        const description = input.description ?? "";

        await writeAtomically(deps.fs, targetPath, serializeTaskDocument(frontmatter, description));

        return createTask(list,input.id, frontmatter, description);
      });
    },
    async update(id: string, patch: TaskUpdate): Promise<Task> {
      return withTaskLock(id, async () => {
        const existing = await getTaskFile(id);
        const nextFrontmatter = updatedFrontmatter(existing.frontmatter, existing.task, patch);
        const description = patch.description ?? existing.task.description;

        await writeAtomically(deps.fs, existing.path, serializeTaskDocument(nextFrontmatter, description));

        return createTask(list,id, nextFrontmatter, description);
      });
    },
    async fire(id: string, eventName: string, opts?: TaskFireOptions): Promise<Task> {
      return withTaskLock(id, async () => {
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
          opts?.metadataPatch
        );
        const nextTask = createTask(list,id, nextFrontmatter, existing.task.description);
        const serializedTask = serializeTaskDocument(nextFrontmatter, existing.task.description);

        if (event.to === "archived") {
          const targetPath = archivedTaskPath(deps.path, list, id);
          const archivedTargetExists = await statIfExists(deps.fs, targetPath);
          if (archivedTargetExists?.isFile()) {
            throw new TaskAlreadyExistsError(`Task "${list}/${id}" already exists in archive.`);
          }

          await writeAtomically(deps.fs, existing.path, serializedTask);
          await deps.fs.mkdir(archiveDirectoryPath(deps.path, list), { recursive: true });
          await deps.fs.rename(existing.path, targetPath);
          await event.onEnter?.(nextTask);

          return nextTask;
        }

        await writeAtomically(deps.fs, existing.path, serializedTask);
        await event.onEnter?.(nextTask);

        return nextTask;
      });
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
    async transition(id: string, to: string): Promise<Task> {
      assertValidTaskState(to);

      return withTaskLock(id, async () => {
        const existing = await getTaskFile(id);

        assertTransition(stateMachine, existing.task.state, to);

        const nextFrontmatter = transitionedFrontmatter(existing.frontmatter, existing.task, to);
        const serializedTask = serializeTaskDocument(nextFrontmatter, existing.task.description);

        if (to === "archived") {
          const targetPath = archivedTaskPath(deps.path, list, id);
          const archivedTargetExists = await statIfExists(deps.fs, targetPath);
          if (archivedTargetExists?.isFile()) {
            throw new TaskAlreadyExistsError(`Task "${list}/${id}" already exists in archive.`);
          }

          await writeAtomically(deps.fs, existing.path, serializedTask);
          await deps.fs.mkdir(archiveDirectoryPath(deps.path, list), { recursive: true });
          await deps.fs.rename(existing.path, targetPath);

          return createTask(list,id, nextFrontmatter, existing.task.description);
        }

        await writeAtomically(deps.fs, existing.path, serializedTask);

        return createTask(list,id, nextFrontmatter, existing.task.description);
      });
    },
    async delete(id: string): Promise<void> {
      await withTaskLock(id, async () => {
        const location = await findTaskLocation(deps.fs, deps.path, list, id);
        if (!location) {
          throw new TaskNotFoundError(`Task "${list}/${id}" not found.`);
        }

        await deps.fs.unlink(location.path);
      });
    }
  };
}

export async function markdownDirBackend(deps: BackendDeps): Promise<TaskList> {
  await ensureRootPath(deps);

  const list = (name: string): Tasks => {
    const listName = validateListName(name);
    return createTasksView(deps, listName);
  };

  const lists = async (): Promise<string[]> => {
    const entries = await readDirectoryNames(deps.fs, deps.path);
    const result: string[] = [];

    for (const entryName of entries) {
      if (
        entryName === ARCHIVE_DIRECTORY_NAME ||
        isHiddenEntry(entryName) ||
        isLockFile(entryName)
      ) {
        continue;
      }

      const entryPath = path.join(deps.path, entryName);
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

    return sortTasks(tasks);
  };

  const get = async (qualifiedId: string): Promise<Task> => {
    const { list: listName, id } = parseQualifiedId(qualifiedId);
    return list(listName).get(id);
  };

  return {
    list,
    lists,
    allTasks,
    get
  };
}
