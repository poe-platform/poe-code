import { writeBytes } from "../../contracts/index.js";
import { CurlError, defaultNetworkLimits } from "./types.js";
export const encode = (text) => new TextEncoder().encode(text);
export function limitsFor(overrides = {}) {
    const result = { ...defaultNetworkLimits, ...overrides };
    for (const [name, value] of Object.entries(result)) {
        const minimum = name === "maxRedirects" || name === "maxRetries" ? 0 : 1;
        if (!Number.isSafeInteger(value) || value < minimum || (name === "maxTimeMs" && value > 2_147_483_647)) {
            throw new RangeError(`Invalid network limit: ${name}`);
        }
    }
    return Object.freeze(result);
}
export async function withSignal(operation, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const onAbort = () => { cleanup(); reject(signal.reason); };
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve().then(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
}
export async function delay(milliseconds, signal) {
    let timer;
    try {
        await withSignal(() => new Promise(resolve => { timer = setTimeout(resolve, milliseconds); }), signal);
    }
    finally {
        clearTimeout(timer);
    }
}
export function header(headers, name) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
export function networkError(error) {
    if (error instanceof CurlError)
        return error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (["ENOTFOUND", "EAI_AGAIN"].includes(code))
        return new CurlError(6, "Could not resolve host");
    if (["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code))
        return new CurlError(7, "Failed to connect");
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
        return new CurlError(60, "TLS certificate verification failed");
    if (/TLS|SSL/.test(code))
        return new CurlError(35, "TLS handshake failed");
    return new CurlError(56, "Network transfer failed");
}
export async function diagnostic(context, error) {
    await writeBytes(context.stderr, encode(`curl: (${error.exitCode}) ${error.message}\n`), context.signal);
}
//# sourceMappingURL=shared.js.map