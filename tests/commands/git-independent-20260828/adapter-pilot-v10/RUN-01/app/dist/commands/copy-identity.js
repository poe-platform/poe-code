import { FsError } from "../contracts/index.js";
function complete(stat) {
    return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
        && typeof stat.dev === "number" && Number.isSafeInteger(stat.dev) && stat.dev >= 0
        && typeof stat.ino === "number" && Number.isSafeInteger(stat.ino) && stat.ino >= 0;
}
export function compareCopyIdentity(left, right) {
    if (!left || !right || !complete(left) || !complete(right))
        return "unknown";
    return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
}
export async function compareObservedEntries(fs, path, stat, peer, peerPath, peerStat, options = {}) {
    options.signal?.throwIfAborted();
    const identity = compareCopyIdentity(stat, peerStat);
    if (identity !== "unknown")
        return identity;
    let result = "unknown";
    const operands = fs === peer
        ? [[fs, path, peer, peerPath]]
        : [[fs, path, peer, peerPath], [peer, peerPath, fs, path]];
    for (const [owner, ownPath, other, otherPath] of operands) {
        options.signal?.throwIfAborted();
        if (!owner.compareEntry)
            continue;
        let answer;
        try {
            answer = await owner.compareEntry(ownPath, other, otherPath, options);
        }
        catch (error) {
            options.signal?.throwIfAborted();
            throw error;
        }
        options.signal?.throwIfAborted();
        if (answer !== "same" && answer !== "distinct" && answer !== "unknown") {
            throw new FsError("EIO", { path, dest: peerPath, message: "invalid entry comparison answer" });
        }
        if (answer === "unknown")
            continue;
        if (result !== "unknown" && result !== answer) {
            throw new FsError("EIO", { path, dest: peerPath, message: "conflicting entry comparison answers" });
        }
        result = answer;
    }
    return result;
}
//# sourceMappingURL=copy-identity.js.map