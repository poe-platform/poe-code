import { randomUUID } from "node:crypto";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";

export interface SecretStoreLockOptions { signal?: AbortSignal; timeoutMs?: number }
export interface SecretStoreLockFileSystem {
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, value: string, options: { encoding: BufferEncoding; flag: string; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
}

/** Filesystem bakery lock: unique claims allow dead-owner cleanup without deleting a replacement owner's lock. */
export async function withSecretStoreFileLock<T>(
  fs: SecretStoreLockFileSystem,
  lockDirectory: string,
  operation: () => Promise<T>,
  options: SecretStoreLockOptions = {}
): Promise<T> {
  options = { ...options };
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647)
    throw new Error("Invalid secret-store transaction lock timeout");
  options.signal?.throwIfAborted();
  const deadline = performance.now() + timeoutMs;
  const directory = path.resolve(lockDirectory);
  await assertLockDirectoryPath(fs, directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await assertLockDirectoryPath(fs, directory);
  const name = `${process.pid}-${randomUUID()}.claim`;
  const claimPath = path.join(directory, name);
  const temporaryPath = `${claimPath}.tmp`;
  let claimed = true;
  let temporaryCreated = false;
  let outcome: { result: T } | { error: unknown };
  try {
    try { await fs.writeFile(claimPath, JSON.stringify({ ticket: null }), { encoding: "utf8", flag: "wx", mode: 0o600 }); }
    catch (error) { if (hasOwnErrorCode(error, "EEXIST")) claimed = false; throw error; }
    const existing = await readClaims(fs, directory, name);
    const ticket = existing.reduce((max, claim) => Math.max(max, claim.ticket ?? 0), 0) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("Secret-store transaction lock ticket overflow");
    temporaryCreated = true;
    try { await fs.writeFile(temporaryPath, JSON.stringify({ ticket }), { encoding: "utf8", flag: "wx", mode: 0o600 }); }
    catch (error) { if (hasOwnErrorCode(error, "EEXIST")) temporaryCreated = false; throw error; }
    await fs.rename(temporaryPath, claimPath);
    temporaryCreated = false;
    for (;;) {
      options.signal?.throwIfAborted();
      const peers = await readClaims(fs, directory, name);
      if (!peers.some(peer => peer.ticket === null || peer.ticket < ticket || (peer.ticket === ticket && peer.name < name))) break;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error("Timed out waiting for secret-store transaction lock");
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); reject(options.signal?.reason); };
        const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, Math.min(10, remaining));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
    options.signal?.throwIfAborted();
    outcome = { result: await operation() };
  } catch (error) { outcome = { error }; }
  const cleanup: unknown[] = [];
  for (const target of [...(temporaryCreated ? [temporaryPath] : []), ...(claimed ? [claimPath] : [])]) {
    try { await fs.unlink(target); }
    catch (error) { if (!hasOwnErrorCode(error, "ENOENT")) cleanup.push(error); }
  }
  if (cleanup.length) throw new AggregateError([...( "error" in outcome ? [outcome.error] : []), ...cleanup], "Secret-store transaction lock cleanup failed");
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}

async function assertNoSymbolicLink(fs: SecretStoreLockFileSystem, target: string): Promise<void> {
  try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error("Refusing secret-store transaction lock through symbolic link"); }
  catch (error) { if (!hasOwnErrorCode(error, "ENOENT")) throw error; }
}

async function assertLockDirectoryPath(fs: SecretStoreLockFileSystem, directory: string): Promise<void> {
  const root = path.parse(directory).root;
  const segments = directory.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    // Match encrypted credential paths: allow OS root aliases such as macOS /var.
    if (index > 0 || segments.length === 1) await assertNoSymbolicLink(fs, current);
  }
}

async function readClaims(fs: SecretStoreLockFileSystem, directory: string, ownName: string): Promise<{ name: string; ticket: number | null }[]> {
  const claims: { name: string; ticket: number | null }[] = [];
  for (const name of await fs.readdir(directory)) {
    if (name === ownName || !name.endsWith(".claim")) continue;
    const pidText = name.slice(0, name.indexOf("-"));
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid < 1 || String(pid) !== pidText) throw new Error("Malformed secret-store transaction lock owner");
    const target = path.join(directory, name);
    await assertNoSymbolicLink(fs, target);
    let alive = true;
    try { process.kill(pid, 0); }
    catch (error) { alive = !hasOwnErrorCode(error, "ESRCH"); }
    if (!alive) {
      try { await fs.unlink(target); } catch (error) { if (!hasOwnErrorCode(error, "ENOENT")) throw error; }
      continue;
    }
    let ticket: number | null = null;
    let raw: string;
    try { raw = await fs.readFile(target, "utf8"); }
    catch (error) { if (hasOwnErrorCode(error, "ENOENT")) continue; throw error; }
    try {
      const value: unknown = JSON.parse(raw);
      if (value !== null && typeof value === "object" && "ticket" in value &&
        typeof value.ticket === "number" && Number.isSafeInteger(value.ticket) && value.ticket > 0) ticket = value.ticket;
    } catch { /* Incomplete live claims remain in the choosing phase; never steal them by age. */ }
    claims.push({ name, ticket });
  }
  return claims;
}
