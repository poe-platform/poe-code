export const operation = "shell-ere";
export const profile = "ascii-c-posix-v1";
export const resources = Object.freeze(["patternBytes", "subjectBytes", "work", "states", "allocationUnits", "captureBytes", "captureSlots"]);
export const cumulative = Object.freeze(["work", "states", "allocationUnits", "captureBytes", "captureSlots"]);
export class EreTransportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "EreTransportError";
    }
}
export class EreTransportProfileLimitError extends Error {
    resource;
    limit;
    status = 3;
    constructor(resource, limit) {
        super(`ERE transport profile limit exceeded: ${resource} (${limit})`);
        this.resource = resource;
        this.limit = limit;
        this.name = "EreTransportProfileLimitError";
    }
}
export class EreTransportSemanticError extends Error {
    category;
    offset;
    status = 2;
    constructor(category, offset) {
        super(category === "syntax" ? "invalid ERE" : "unsupported ERE profile");
        this.category = category;
        this.offset = offset;
        this.name = "EreTransportSemanticError";
    }
}
