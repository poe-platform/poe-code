import { FsError } from "../../contracts/errors.js";
const responses = new WeakMap();
const observations = new WeakMap();
export function registerOwnedResourceResponse(response, entries) {
    if (responses.has(response))
        throw new TypeError("resource response already registered");
    responses.set(response, new Map(entries));
}
export function recordOwnedResourceStat(response, filesystem, path, stat) {
    const entry = responses.get(response)?.get(path);
    if (entry)
        observations.set(stat, { filesystem, path, entry });
}
export function getOwnedWebDavEntry(view) {
    const observation = observations.get(view.stat);
    return observation?.filesystem === view.filesystem && observation.path === view.path
        ? observation.entry : undefined;
}
export function ownedResponseIdentifier(response, path) {
    return responses.get(response)?.get(path)?.identifier;
}
const queries = new WeakMap();
const comparisons = new WeakMap();
const callbacks = new WeakMap();
export function registerResourceQuery(filesystem, query, baseComparison, callback) {
    comparisons.set(filesystem, baseComparison);
    if (callback)
        callbacks.set(filesystem, callback);
    queries.set(filesystem, async (path, options) => {
        options.signal?.throwIfAborted();
        const identifier = await query(path, options);
        options.signal?.throwIfAborted();
        return identifier;
    });
}
export function resourceIdentifier(value) {
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(value) || /%(?![0-9A-Fa-f]{2})/.test(value)
        || /[^\x21-\x7e]/.test(value))
        throw new Error("invalid DAV:resource-id URI");
    new URL(value);
    if (/^urn:uuid:/i.test(value)) {
        if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
            throw new Error("invalid DAV:resource-id UUID");
        }
        return value.toLowerCase();
    }
    return value;
}
export const compareWebDavResources = async (own, peer, options) => {
    options.signal?.throwIfAborted();
    let explicit = false;
    let answer = "unknown";
    const visited = new Set();
    for (const [left, right] of [[own, peer], [peer, own]]) {
        const baseComparison = comparisons.get(left.filesystem);
        if (!baseComparison)
            continue;
        const method = left.filesystem.compareEntry;
        const comparison = method === baseComparison ? callbacks.get(left.filesystem) : method;
        if (method === baseComparison && !comparison)
            continue;
        explicit = true;
        if (!comparison || visited.has(left.filesystem))
            continue;
        visited.add(left.filesystem);
        options.signal?.throwIfAborted();
        const result = await comparison.call(left.filesystem, left.path, right.filesystem, right.path, options);
        options.signal?.throwIfAborted();
        if (result !== "same" && result !== "distinct" && result !== "unknown") {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit WebDAV comparison" });
        }
        if (result === "unknown")
            continue;
        if (answer !== "unknown" && answer !== result) {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting explicit WebDAV comparisons" });
        }
        answer = result;
    }
    const builtin = await compareProtocolEntries(own, peer, options);
    if (builtin === "same" && answer === "distinct") {
        throw new FsError("EIO", { path: own.path, dest: peer.path, message: "explicit WebDAV comparison contradicts built-in identity" });
    }
    if (builtin === "same")
        return "same";
    return explicit ? answer : builtin;
};
async function compareProtocolEntries(own, peer, options) {
    const left = getOwnedWebDavEntry(own);
    const right = getOwnedWebDavEntry(peer);
    const ownQuery = queries.get(own.filesystem);
    const peerQuery = queries.get(peer.filesystem);
    if (!ownQuery || !peerQuery)
        return "unknown";
    options.signal?.throwIfAborted();
    const ownId = await ownQuery(own.path, options);
    options.signal?.throwIfAborted();
    const peerId = await peerQuery(peer.path, options);
    options.signal?.throwIfAborted();
    if (ownId === undefined || peerId === undefined)
        return "unknown";
    if (left && right) {
        const same = left.storage === right.storage && left.resource === right.resource;
        if (same !== (ownId === peerId))
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting owned and protocol WebDAV identities" });
    }
    return ownId === peerId ? "same" : "distinct";
}
//# sourceMappingURL=resource-id.js.map