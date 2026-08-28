import { AsyncLocalStorage } from "node:async_hooks";
import { FsError } from "../../contracts/errors.js";
const queries = new AsyncLocalStorage();
const providerHeads = new WeakMap();
const acceptedHeads = new WeakMap();
const observedStats = new WeakMap();
const entries = new WeakMap();
const comparisons = new WeakMap();
const configuredComparisons = new WeakMap();
export function recordMockS3Head(output, input, storage) {
    const query = queries.getStore();
    if (query && query.Bucket === input.Bucket && query.Key === input.Key) {
        providerHeads.set(output, { query, entry: { storage, key: input.Key } });
    }
}
export async function queryS3Head(input, action) {
    const query = { ...input };
    return queries.run(query, async () => {
        const output = await action();
        acceptedHeads.delete(output);
        const proof = providerHeads.get(output);
        if (proof?.query === query)
            acceptedHeads.set(output, proof.entry);
        return output;
    });
}
export function recordS3Stat(filesystem, path, stat, metadata) {
    if (!metadata)
        return;
    const entry = acceptedHeads.get(metadata);
    acceptedHeads.delete(metadata);
    if (entry)
        observedStats.set(stat, { filesystem, path, entry });
}
export function registerS3EntryOwner(filesystem, normalize, intact, baseComparison, comparison) {
    comparisons.set(filesystem, baseComparison);
    if (comparison)
        configuredComparisons.set(filesystem, comparison);
    entries.set(filesystem, view => {
        if (!intact())
            return undefined;
        const observation = observedStats.get(view.stat);
        return observation?.filesystem === filesystem && observation.path === normalize(view.path) ? observation.entry : undefined;
    });
}
export function getOwnedS3Entry(view) {
    return entries.get(view.filesystem)?.(view);
}
export async function compareOwnedS3Entries(own, peer, options) {
    options.signal?.throwIfAborted();
    let explicit = false;
    let answer = "unknown";
    const visited = new Set();
    for (const [left, right] of [[own, peer], [peer, own]]) {
        const baseComparison = comparisons.get(left.filesystem);
        if (!baseComparison || visited.has(left.filesystem))
            continue;
        visited.add(left.filesystem);
        const current = left.filesystem.compareEntry;
        const comparison = current === baseComparison ? configuredComparisons.get(left.filesystem) : current;
        if (current === baseComparison && comparison === undefined)
            continue;
        explicit = true;
        if (comparison === undefined)
            continue;
        options.signal?.throwIfAborted();
        if (typeof comparison !== "function") {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit S3 comparison method" });
        }
        const result = await comparison.call(left.filesystem, left.path, right.filesystem, right.path, options);
        options.signal?.throwIfAborted();
        if (result !== "same" && result !== "distinct" && result !== "unknown") {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit S3 comparison" });
        }
        if (result === "unknown")
            continue;
        if (answer !== "unknown" && answer !== result) {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting explicit S3 comparisons" });
        }
        answer = result;
    }
    const left = getOwnedS3Entry(own);
    options.signal?.throwIfAborted();
    const right = getOwnedS3Entry(peer);
    options.signal?.throwIfAborted();
    const same = left && right && left.storage === right.storage && left.key === right.key;
    if (same && answer === "distinct") {
        throw new FsError("EIO", { path: own.path, dest: peer.path, message: "explicit S3 comparison contradicts a known alias" });
    }
    if (same)
        return "same";
    if (explicit)
        return answer;
    return left && right ? "distinct" : "unknown";
}
//# sourceMappingURL=authority.js.map