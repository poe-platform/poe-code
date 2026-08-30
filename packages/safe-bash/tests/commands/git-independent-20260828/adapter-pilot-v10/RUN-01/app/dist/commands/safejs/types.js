export class SafeJsCommandLimitError extends Error {
    resource;
    code = "SAFEJS_LIMIT";
    constructor(resource) {
        super(`SafeJS command limit exceeded: ${resource}`);
        this.resource = resource;
        this.name = "SafeJsCommandLimitError";
    }
}
//# sourceMappingURL=types.js.map