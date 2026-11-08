export class EreSyntaxError extends Error {
    offset;
    status = 2;
    constructor(message, offset) {
        super(`invalid ERE at ${offset}: ${message}`);
        this.offset = offset;
        this.name = "EreSyntaxError";
    }
}
export class EreUnsupportedError extends Error {
    offset;
    status = 2;
    constructor(message, offset) {
        super(`unsupported ERE profile at ${offset}: ${message}`);
        this.offset = offset;
        this.name = "EreUnsupportedError";
    }
}
export class EreProfileLimitError extends Error {
    resource;
    limit;
    status = 3;
    constructor(resource, limit) {
        super(`ERE profile limit exceeded: ${resource} (${limit})`);
        this.resource = resource;
        this.limit = limit;
        this.name = "EreProfileLimitError";
    }
}
export class EreUsageUnknownError extends Error {
    status = 3;
    constructor(reason) {
        super("ERE invocation usage is unknown; further work is refused", { cause: reason });
        this.name = "EreUsageUnknownError";
    }
}
