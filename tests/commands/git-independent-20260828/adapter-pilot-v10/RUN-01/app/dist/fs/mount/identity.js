function complete(stat) {
    const { identityScope, dev, ino } = stat;
    return ((typeof identityScope === "object" && identityScope !== null) || typeof identityScope === "symbol")
        && typeof dev === "number" && Number.isSafeInteger(dev) && dev >= 0
        && typeof ino === "number" && Number.isSafeInteger(ino) && ino >= 0;
}
export function compareIdentity(left, right) {
    if (!left || !right || !complete(left) || !complete(right))
        return "unknown";
    return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino
        ? "same" : "distinct";
}
//# sourceMappingURL=identity.js.map