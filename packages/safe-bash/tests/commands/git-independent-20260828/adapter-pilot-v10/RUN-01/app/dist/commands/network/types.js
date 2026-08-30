export const defaultNetworkLimits = Object.freeze({
    maxUploadBytes: 64 * 1024 * 1024,
    maxDownloadBytes: 64 * 1024 * 1024,
    maxBufferBytes: 8 * 1024 * 1024,
    maxHeaderBytes: 64 * 1024,
    maxRedirects: 10,
    maxRetries: 5,
    maxUrls: 32,
    maxTimeMs: 120_000,
});
export class CurlError extends Error {
    exitCode;
    constructor(exitCode, message) {
        super(message);
        this.exitCode = exitCode;
        this.name = "CurlError";
    }
}
//# sourceMappingURL=types.js.map