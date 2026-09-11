import type { FileSystem } from "../contracts/index.js";
import type { InvocationScope } from "./cleanup.js";
import type { ShellLimits } from "./types.js";

const maxCacheEntries = 256;
const maxCacheBytes = 64 * 1024;

export class PathLookup {
  readonly #entries = new Map<string, { file: boolean; bytes: number }>();
  #bytes = 0;
  #pending = 0;
  #generation = 0;

  suspend(): () => void {
    this.#entries.clear();
    this.#bytes = 0;
    this.#generation++;
    this.#pending++;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.#pending--;
      this.#generation++;
    };
  }

  suspendUntilClosed(scope: InvocationScope): void {
    scope.assertOpen();
    const resume = this.suspend();
    scope.registerFinalizer(resume);
  }

  async isFile(fs: FileSystem, path: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const cached = this.#entries.get(path);
    if (cached) return cached.file;
    const generation = this.#generation;
    let file: boolean;
    try {
      file = (await fs.stat(path, { signal })).type === "file";
    } catch (error) {
      signal.throwIfAborted();
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      file = false;
    }
    signal.throwIfAborted();
    const bytes = Buffer.byteLength(path) + 64;
    if (!this.#pending && generation === this.#generation && bytes <= maxCacheBytes && !this.#entries.has(path)) {
      while (this.#entries.size >= maxCacheEntries || this.#bytes + bytes > maxCacheBytes) {
        const oldest = this.#entries.entries().next().value!;
        this.#bytes -= oldest[1].bytes;
        this.#entries.delete(oldest[0]);
      }
      this.#entries.set(path, { file, bytes });
      this.#bytes += bytes;
    }
    return file;
  }
}

export function* pathTargets(name: string, path: string | undefined, limits: Required<ShellLimits>, signal: AbortSignal, fail: (limit: keyof ShellLimits) => never): Generator<string> {
  signal.throwIfAborted();
  if (path !== undefined && Buffer.byteLength(path) > limits.maxExpansionBytes) fail("maxExpansionBytes");
  if (name.includes("/") || path === undefined) {
    if (limits.maxExpansionFields < 1) fail("maxExpansionFields");
    yield name;
    return;
  }
  let fields = 1;
  for (let separator = path.indexOf(":"); separator >= 0; separator = path.indexOf(":", separator + 1)) {
    signal.throwIfAborted();
    if (++fields > limits.maxExpansionFields) fail("maxExpansionFields");
  }
  if (fields > limits.maxExpansionFields) fail("maxExpansionFields");
  let start = 0;
  let consulted = 0;
  while (start <= path.length) {
    signal.throwIfAborted();
    if (consulted >= limits.maxPathComponents) fail("maxPathComponents");
    consulted++;
    const end = path.indexOf(":", start);
    const component = path.slice(start, end < 0 ? path.length : end);
    yield `${component || "."}${component.endsWith("/") ? "" : "/"}${name}`;
    if (end < 0) return;
    start = end + 1;
  }
}
