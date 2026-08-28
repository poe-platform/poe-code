import { validateHeaderName, validateHeaderValue } from "node:http";
import { CurlError } from "./types.js";
const values = {
    X: "request", d: "data", H: "header", u: "user", A: "user-agent", e: "referer",
    o: "output", D: "dump-header", w: "write-out", T: "upload-file", m: "max-time", F: "form",
};
const flags = {
    L: "location", I: "head", i: "include", f: "fail", s: "silent", S: "show-error",
    G: "get", O: "remote-name", v: "verbose", q: "disable", N: "no-buffer", g: "globoff",
    h: "help", V: "version",
};
const longValues = new Set([...Object.values(values), "data-ascii", "data-raw", "data-binary", "data-urlencode",
    "json", "form-string", "url", "oauth2-bearer", "max-redirs", "max-filesize", "retry", "retry-delay"]);
function number(value, integral = false) {
    if (!(integral ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(value))
        throw new CurlError(2, "Invalid numeric option");
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER)
        throw new CurlError(2, "Invalid numeric option");
    return parsed;
}
function addHeader(result, raw) {
    const colon = raw.indexOf(":");
    const semicolon = colon < 0 && raw.endsWith(";");
    if (colon < 1 && !semicolon)
        throw new CurlError(2, "Invalid HTTP header");
    const name = semicolon ? raw.slice(0, -1) : raw.slice(0, colon);
    const value = semicolon ? "" : raw.slice(colon + 1).trim();
    try {
        validateHeaderName(name);
        validateHeaderValue(name, value);
    }
    catch {
        throw new CurlError(2, "Invalid HTTP header");
    }
    if (["host", "content-length", "transfer-encoding", "connection", "proxy-authorization", "upgrade", "expect"].includes(name.toLowerCase())) {
        throw new CurlError(2, "Transport-controlled HTTP header is not supported");
    }
    result.headers.push([name, value === "" && !semicolon ? null : value]);
}
export function parseArguments(args, limits) {
    const result = {
        urls: [], data: [], headers: [], include: false, head: false, get: false, location: false,
        remoteName: false, fail: false, failWithBody: false, silent: false, showError: false,
        verbose: false, globoff: false, help: false, version: false, retries: 0, retryDelayMs: 0,
        maxTimeMs: limits.maxTimeMs, maxRedirects: limits.maxRedirects, maxFileSize: limits.maxDownloadBytes,
    };
    const apply = (option, value) => {
        switch (option) {
            case "request":
                if (!value || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value) || ["CONNECT", "TRACE"].includes(value.toUpperCase())) {
                    throw new CurlError(2, "Invalid or unsupported HTTP method");
                }
                result.method = value;
                break;
            case "header":
                addHeader(result, value);
                break;
            case "user-agent":
                addHeader(result, `User-Agent: ${value}`);
                break;
            case "referer":
                addHeader(result, `Referer: ${value}`);
                break;
            case "user":
                if (!value.includes(":"))
                    throw new CurlError(2, "Basic authentication requires user:password; prompting is unsupported");
                result.user = value;
                break;
            case "oauth2-bearer":
                result.bearer = value;
                break;
            case "data":
            case "data-ascii":
                result.data.push({ kind: "data", value: value });
                break;
            case "data-raw":
                result.data.push({ kind: "raw", value: value });
                break;
            case "data-binary":
                result.data.push({ kind: "binary", value: value });
                break;
            case "data-urlencode":
                result.data.push({ kind: "urlencode", value: value });
                break;
            case "json":
            case "form":
            case "form-string":
                result.data.push({ kind: option, value: value });
                break;
            case "output":
                result.output = value;
                result.remoteName = false;
                break;
            case "remote-name":
                result.remoteName = true;
                delete result.output;
                break;
            case "dump-header":
                result.dumpHeader = value;
                break;
            case "write-out":
                result.writeOut = value;
                break;
            case "upload-file":
                result.upload = value;
                break;
            case "url":
                result.urls.push(value);
                break;
            case "max-time": {
                const milliseconds = number(value) * 1000;
                result.maxTimeMs = milliseconds === 0 ? limits.maxTimeMs : Math.min(milliseconds, limits.maxTimeMs);
                break;
            }
            case "max-filesize":
                result.maxFileSize = Math.min(number(value, true), limits.maxDownloadBytes);
                break;
            case "max-redirs":
                result.maxRedirects = Math.min(number(value, true), limits.maxRedirects);
                break;
            case "retry":
                result.retries = Math.min(number(value, true), limits.maxRetries);
                break;
            case "retry-delay":
                result.retryDelayMs = Math.min(number(value) * 1000, limits.maxTimeMs);
                break;
            case "location":
                result.location = true;
                break;
            case "head":
                result.head = true;
                break;
            case "include":
            case "show-headers":
                result.include = true;
                break;
            case "get":
                result.get = true;
                break;
            case "fail":
                result.fail = true;
                break;
            case "fail-with-body":
                result.failWithBody = true;
                break;
            case "silent":
                result.silent = true;
                break;
            case "show-error":
                result.showError = true;
                break;
            case "verbose":
                result.verbose = true;
                break;
            case "globoff":
                result.globoff = true;
                break;
            case "help":
                result.help = true;
                break;
            case "version":
                result.version = true;
                break;
            case "disable":
            case "no-buffer":
            case "no-progress-meter":
            case "basic": break;
            default: throw new CurlError(2, "Unsupported curl option");
        }
    };
    let ended = false;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (ended || !argument.startsWith("-") || argument === "-") {
            result.urls.push(argument);
            continue;
        }
        if (argument === "--") {
            ended = true;
            continue;
        }
        if (argument.startsWith("--")) {
            const equals = argument.indexOf("=");
            const name = argument.slice(2, equals < 0 ? undefined : equals);
            let value = equals < 0 ? undefined : argument.slice(equals + 1);
            if (longValues.has(name)) {
                value ??= args[++index];
                if (value === undefined)
                    throw new CurlError(2, "Option requires an argument");
            }
            else if (value !== undefined)
                throw new CurlError(2, "Unexpected option argument");
            apply(name, value);
        }
        else {
            for (let offset = 1; offset < argument.length; offset++) {
                const name = argument[offset];
                if (values[name]) {
                    const value = argument.slice(offset + 1) || args[++index];
                    if (value === undefined)
                        throw new CurlError(2, "Option requires an argument");
                    apply(values[name], value);
                    break;
                }
                if (!flags[name])
                    throw new CurlError(2, "Unsupported curl option");
                apply(flags[name]);
            }
        }
    }
    if (!result.help && !result.version && !result.urls.length)
        throw new CurlError(2, "No URL specified");
    if (result.urls.length > limits.maxUrls)
        throw new CurlError(2, "URL count exceeds host limit");
    if (result.fail && result.failWithBody)
        throw new CurlError(2, "--fail and --fail-with-body are mutually exclusive");
    const form = result.data.some(part => part.kind === "form" || part.kind === "form-string");
    if ((result.upload !== undefined && result.data.length) || (form && result.data.some(part => !part.kind.startsWith("form"))) ||
        (result.get && (form || result.upload !== undefined)) || (result.head && (result.upload !== undefined || result.data.length > 0) && !result.get)) {
        throw new CurlError(2, "Incompatible request body options");
    }
    if (result.data.some(part => part.kind === "json") && result.data.some(part => part.kind !== "json")) {
        throw new CurlError(2, "Mixing JSON and other data modes is unsupported");
    }
    return result;
}
//# sourceMappingURL=args.js.map