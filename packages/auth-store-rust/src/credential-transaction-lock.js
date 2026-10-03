import { randomUUID } from "node:crypto";
import path from "node:path";
function hasOwnErrorCode(error, code) { return error instanceof Error && Object.hasOwn(error, "code") && error.code === code; }
const positiveClaimValue = value => {
    try { return value > 0; }
    catch { return false; }
};
export function hasLockPredecessor(native, peers, ticket, name) {
    let captured;
    try {
        return native.lockHasPredecessor(peers, ticket, name, (left, right) => {
            try { return left < right; }
            catch (error) {
                captured = { error };
                throw new Error("Credential lock comparison failed");
            }
        });
    } catch (error) {
        if (captured) throw captured.error;
        throw error;
    }
}
function unwrap(result) {
    if (Object.hasOwn(result, "error")) throw new Error(result.error);
    return result.value;
}
/** Filesystem bakery lock: unique claims allow dead-owner cleanup without deleting a replacement owner's lock. */
export function createCredentialLockBindings(native) {
  return async function withSecretStoreFileLock(fs, lockDirectory, operation, options = {}) {
    options = { ...options, signal: options.signal, timeoutMs: options.timeoutMs };
    const timeoutMs = options.timeoutMs ?? Infinity;
    unwrap(native.lockTimeout(typeof timeoutMs === "number" ? timeoutMs : NaN));
    options.signal?.throwIfAborted();
    const deadline = performance.now() + timeoutMs;
    const directory = path.resolve(lockDirectory);
    await assertLockDirectoryPath(fs, directory, native);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await assertLockDirectoryPath(fs, directory, native);
    const name = `${process.pid}-${randomUUID()}.claim`;
    const claimPath = path.join(directory, name);
    const temporaryPath = `${claimPath}.tmp`;
    const lifecycle = new native.NativeLockLifecycle(deadline);
    let outcome;
    try {
        try {
            await fs.writeFile(claimPath, JSON.stringify({ ticket: null }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        catch (error) {
            lifecycle.claimFailed(hasOwnErrorCode(error, "EEXIST"));
            throw error;
        }
        const existing = await readClaims(fs, directory, name, native);
        const ticket = unwrap(native.lockNextTicket(existing));
        lifecycle.beginPublication();
        try {
            await fs.writeFile(temporaryPath, JSON.stringify({ ticket }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        catch (error) {
            lifecycle.publicationFailed(hasOwnErrorCode(error, "EEXIST"));
            throw error;
        }
        await fs.rename(temporaryPath, claimPath);
        lifecycle.published();
        for (;;) {
            options.signal?.throwIfAborted();
            const peers = await readClaims(fs, directory, name, native);
            if (!hasLockPredecessor(native, peers, ticket, name))
                break;
            const delay = unwrap(lifecycle.waitDelay(performance.now()));
            await new Promise((resolve, reject) => {
                const abort = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); reject(options.signal?.reason); };
                const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, delay);
                options.signal?.addEventListener("abort", abort, { once: true });
                if (options.signal?.aborted)
                    abort();
            });
        }
        options.signal?.throwIfAborted();
        outcome = { result: await operation() };
    }
    catch (error) {
        outcome = { error };
    }
    const cleanup = [];
    for (const artifact of lifecycle.cleanupTargets()) {
        const target = artifact === "temporary" ? temporaryPath : claimPath;
        try {
            await fs.unlink(target);
        }
        catch (error) {
            if (!hasOwnErrorCode(error, "ENOENT"))
                cleanup.push(error);
        }
    }
    if (cleanup.length)
        throw new AggregateError([...("error" in outcome ? [outcome.error] : []), ...cleanup], "Secret-store transaction lock cleanup failed");
    if ("error" in outcome)
        throw outcome.error;
    return outcome.result;
  };
}
async function assertNoSymbolicLink(fs, target) {
    try {
        if ((await fs.lstat(target)).isSymbolicLink())
            throw new Error("Refusing secret-store transaction lock through symbolic link");
    }
    catch (error) {
        if (!hasOwnErrorCode(error, "ENOENT"))
            throw error;
    }
}
async function assertLockDirectoryPath(fs, directory, native) {
    for (const current of native.lockProtectedPaths(directory, path.parse(directory).root.length, path.sep.charCodeAt(0)))
        await assertNoSymbolicLink(fs, current);
}
async function readClaims(fs, directory, ownName, native) {
    const claims = [];
    for (const name of await fs.readdir(directory)) {
        const pid = unwrap(native.lockOwner(name, ownName));
        if (pid === null) continue;
        const target = path.join(directory, name);
        await assertNoSymbolicLink(fs, target);
        let alive = true;
        try {
            process.kill(pid, 0);
        }
        catch (error) {
            alive = !hasOwnErrorCode(error, "ESRCH");
        }
        if (!alive) {
            try {
                await fs.unlink(target);
            }
            catch (error) {
                if (!hasOwnErrorCode(error, "ENOENT"))
                    throw error;
            }
            continue;
        }
        let ticket = null;
        let raw;
        try {
            raw = await fs.readFile(target, "utf8");
        }
        catch (error) {
            if (hasOwnErrorCode(error, "ENOENT"))
                continue;
            throw error;
        }
        try {
            ticket = native.lockClaimTicket(JSON.parse(raw), positiveClaimValue);
        }
        catch { /* Incomplete live claims remain in the choosing phase; never steal them by age. */ }
        claims.push({ name, ticket });
    }
    return claims;
}
