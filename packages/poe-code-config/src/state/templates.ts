import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  assertPathHasNoSymbolicLinks,
  defaultStateFs,
  isNotFoundError,
  type StateFileSystem
} from "./fs.js";
import { hasOwnErrorCode } from "../errors.js";

export type TemplateBackend = "docker" | "e2b";

export interface TemplateEntry {
  hash: string;
  template_id?: string;
  image?: string;
  runtime_type: string;
  dockerfile_path: string;
  built_at: string;
}

type TemplateState = Record<TemplateBackend, Record<string, TemplateEntry>>;

export interface TemplateRegistry {
  get(backend: TemplateBackend, hash: string): Promise<TemplateEntry | null>;
  put(backend: TemplateBackend, entry: TemplateEntry): Promise<void>;
  remove(backend: TemplateBackend, hash: string): Promise<void>;
  list(backend?: TemplateBackend): Promise<TemplateEntry[]>;
}

export function createTemplateRegistry(
  homeDir: string,
  fs: StateFileSystem = defaultStateFs
): TemplateRegistry {
  const filePath = path.join(homeDir, ".poe-code", "state", "templates.json");
  let pendingUpdate: Promise<void> = Promise.resolve();

  async function readState(): Promise<TemplateState> {
    await assertSafeStateFile();
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeTemplateState(JSON.parse(raw));
    } catch (error) {
      if (isNotFoundError(error)) {
        return createEmptyState();
      }

      throw error;
    }
  }

  async function writeState(state: TemplateState): Promise<void> {
    await assertSafeStateFile();
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let tempCreated = false;

    try {
      await assertSafeStatePath(tempPath);
      await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      tempCreated = true;
      await assertSafeStateFile();
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (tempCreated || !isAlreadyExistsError(error)) {
        await fs.unlink(tempPath).catch(() => undefined);
      }
      throw error;
    }
  }

  async function updateState(mutator: (state: TemplateState) => void): Promise<void> {
    const update = pendingUpdate.then(async () => {
      await assertSafeStateFile();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await assertSafeStateFile();
      const state = await readState();
      mutator(state);
      await writeState(state);
    });
    pendingUpdate = update.catch(() => undefined);
    await update;
  }

  async function assertSafeStateFile(): Promise<void> {
    await assertSafeStatePath(filePath);
  }

  async function assertSafeStatePath(statePath: string): Promise<void> {
    await assertPathHasNoSymbolicLinks(
      fs,
      statePath,
      "Refusing template state access through symbolic link"
    );
  }

  async function get(backend: TemplateBackend, hash: string): Promise<TemplateEntry | null> {
    const state = await readState();
    return state[backend][hash] ?? null;
  }

  async function put(backend: TemplateBackend, entry: TemplateEntry): Promise<void> {
    await updateState((state) => {
      state[backend][entry.hash] = entry;
    });
  }

  async function remove(backend: TemplateBackend, hash: string): Promise<void> {
    await updateState((state) => {
      delete state[backend][hash];
    });
  }

  async function list(backend?: TemplateBackend): Promise<TemplateEntry[]> {
    const state = await readState();
    const entries =
      backend === undefined
        ? [...Object.values(state.docker), ...Object.values(state.e2b)]
        : Object.values(state[backend]);

    return entries.sort((left, right) => left.hash.localeCompare(right.hash));
  }

  return {
    get,
    put,
    remove,
    list
  };
}

function createEmptyState(): TemplateState {
  return {
    docker: Object.create(null) as Record<string, TemplateEntry>,
    e2b: Object.create(null) as Record<string, TemplateEntry>
  };
}

function normalizeTemplateState(value: unknown): TemplateState {
  if (!isRecord(value)) {
    return createEmptyState();
  }

  return {
    docker: normalizeTemplateEntries(value.docker),
    e2b: normalizeTemplateEntries(value.e2b)
  };
}

function normalizeTemplateEntries(value: unknown): Record<string, TemplateEntry> {
  if (!isRecord(value)) {
    return Object.create(null) as Record<string, TemplateEntry>;
  }

  const entries = Object.create(null) as Record<string, TemplateEntry>;
  for (const [hash, entry] of Object.entries(value)) {
    if (isTemplateEntry(entry) && entry.hash === hash) {
      entries[hash] = entry;
    }
  }
  return entries;
}

function isTemplateEntry(value: unknown): value is TemplateEntry {
  return (
    isRecord(value) &&
    typeof value.hash === "string" &&
    typeof value.runtime_type === "string" &&
    typeof value.dockerfile_path === "string" &&
    typeof value.built_at === "string" &&
    (value.template_id === undefined || typeof value.template_id === "string") &&
    (value.image === undefined || typeof value.image === "string")
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type { StateFileSystem } from "./fs.js";
