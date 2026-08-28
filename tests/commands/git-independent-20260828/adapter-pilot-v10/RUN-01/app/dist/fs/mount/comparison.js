import { AsyncLocalStorage } from "node:async_hooks";
import { FsError } from "../../contracts/errors.js";
import { compareIdentity } from "./identity.js";
const resolvers = new WeakMap();
const authorities = new WeakMap();
const negotiating = new AsyncLocalStorage();
export function registerEntryView(filesystem, resolver) {
    if (resolvers.has(filesystem))
        throw new TypeError("entry view already registered");
    resolvers.set(filesystem, resolver);
}
export function registerEntryAuthority(filesystem, authority) {
    if (authorities.has(filesystem))
        throw new TypeError("entry authority already registered");
    authorities.set(filesystem, authority);
}
export async function resolveEntryView(filesystem, path, options = {}) {
    let location = { filesystem, path };
    let readOnly = false;
    const visited = new Set();
    for (;;) {
        options.signal?.throwIfAborted();
        if (visited.has(location.filesystem))
            throw new FsError("EIO", { path, message: "cyclic entry view" });
        visited.add(location.filesystem);
        readOnly ||= location.readOnly === true || location.filesystem.capabilities.readOnly === true;
        if (location.stat)
            return { filesystem: location.filesystem, path: location.path, stat: location.stat, readOnly };
        const resolve = resolvers.get(location.filesystem);
        if (!resolve) {
            let stat;
            let followedPath;
            try {
                followedPath = await location.filesystem.realpath(location.path, options);
                options.signal?.throwIfAborted();
                stat = await location.filesystem.lstat(followedPath, options);
            }
            catch (error) {
                options.signal?.throwIfAborted();
                throw error;
            }
            options.signal?.throwIfAborted();
            if (stat.type === "symlink")
                throw new FsError("EIO", { path, message: "followed entry changed during observation" });
            return { filesystem: location.filesystem, path: followedPath, stat, readOnly };
        }
        let next;
        try {
            next = await resolve(location.path, options);
        }
        catch (error) {
            options.signal?.throwIfAborted();
            throw error;
        }
        options.signal?.throwIfAborted();
        if (next.filesystem === location.filesystem && next.stat) {
            return { filesystem: next.filesystem, path: next.path, stat: next.stat, readOnly: readOnly || next.readOnly === true };
        }
        location = next;
    }
}
export async function compareResolvedEntries(own, peer, options = {}) {
    options.signal?.throwIfAborted();
    if (negotiating.getStore())
        return "unknown";
    const identity = compareIdentity(own.stat, peer.stat);
    if (identity !== "unknown")
        return identity;
    return negotiating.run(true, async () => {
        const queried = new Set();
        let result = "unknown";
        for (const [left, right] of [[own, peer], [peer, own]]) {
            options.signal?.throwIfAborted();
            const authority = authorities.get(left.filesystem);
            const key = authority ?? left.filesystem;
            if (queried.has(key))
                continue;
            queried.add(key);
            let answer;
            try {
                if (authority)
                    answer = await authority(left, right, options);
                else if (left.filesystem.compareEntry)
                    answer = await left.filesystem.compareEntry(left.path, right.filesystem, right.path, options);
                else
                    continue;
            }
            catch (error) {
                options.signal?.throwIfAborted();
                throw error;
            }
            options.signal?.throwIfAborted();
            if (answer !== "same" && answer !== "distinct" && answer !== "unknown") {
                throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid entry comparison answer" });
            }
            if (answer === "unknown")
                continue;
            if (result !== "unknown" && result !== answer) {
                throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting entry comparison answers" });
            }
            result = answer;
        }
        return result;
    });
}
export async function compareEntries(filesystem, path, peer, peerPath, options = {}) {
    options.signal?.throwIfAborted();
    if (negotiating.getStore())
        return "unknown";
    const own = await resolveEntryView(filesystem, path, options);
    const other = await resolveEntryView(peer, peerPath, options);
    return compareResolvedEntries(own, other, options);
}
//# sourceMappingURL=comparison.js.map