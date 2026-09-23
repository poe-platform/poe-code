import { validateHeaderName, validateHeaderValue } from "./platform.js";
import { CurlError, type NetworkLimits } from "./types.js";

export interface DataArgument {
  readonly kind: "data" | "raw" | "binary" | "json" | "urlencode" | "form" | "form-string";
  readonly value: string;
}

export interface CurlArguments {
  caFile?: string;
  etagSave?: string;
  etagCompare?: string;
  etag?: string;
  query?: DataArgument[];
  httpVersion?: "1.0" | "1.1";
  ignoreContentLength?: boolean;
  agent?: string;
  referer?: string;
  autoReferer?: boolean;
  retryTransport?: boolean;
  directoryIndex?: string;
  download?: { spider: boolean; resume: boolean; noClobber: boolean; contentDisposition: boolean };
  urls: string[];
  data: DataArgument[];
  headers: [string, string | null][];
  method?: string;
  range?: string;
  continueAt?: number | "auto";
  user?: string;
  bearer?: string;
  upload?: string;
  output?: string;
  outputs?: { output?: string; remoteName: boolean }[];
  outputDirectory?: string;
  dumpHeader?: string;
  writeOut?: string;
  include: boolean;
  head: boolean;
  get: boolean;
  location: boolean;
  remoteName: boolean;
  fail: boolean;
  failWithBody: boolean;
  silent: boolean;
  showError: boolean;
  verbose: boolean;
  globoff: boolean;
  help: boolean;
  version: boolean;
  compressed?: boolean;
  raw?: boolean;
  retries: number;
  retryDelayMs: number;
  maxTimeMs: number;
  connectTimeoutMs?: number;
  maxRedirects: number;
  maxFileSize: number;
}

export const values: Readonly<Record<string, string>> = {
  C: "continue-at", X: "request", d: "data", H: "header", u: "user", A: "user-agent", e: "referer",
  o: "output", D: "dump-header", w: "write-out", T: "upload-file", m: "max-time", F: "form", r: "range",
};
export const flags: Readonly<Record<string, string>> = {
  L: "location", I: "head", i: "include", f: "fail", s: "silent", S: "show-error",
  G: "get", O: "remote-name", v: "verbose", q: "disable", N: "no-buffer", g: "globoff",
  h: "help", V: "version",
};
export const longValues = new Set([...Object.values(values), "data-ascii", "data-raw", "data-binary", "data-urlencode", "url-query",
  "json", "form-string", "url", "oauth2-bearer", "max-redirs", "max-filesize", "retry", "retry-delay", "connect-timeout", "output-dir", "cacert", "etag-save", "etag-compare"]);

const booleans: Readonly<Record<string, keyof CurlArguments>> = {
  location: "location", head: "head", include: "include", "show-headers": "include", get: "get",
  "remote-name": "remoteName", fail: "fail", "fail-with-body": "failWithBody", silent: "silent",
  "show-error": "showError", verbose: "verbose", globoff: "globoff", compressed: "compressed", raw: "raw",
  "ignore-content-length": "ignoreContentLength",
};

function number(value: string, integral = false): number {
  if (!(integral ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(value)) throw new CurlError(2, "Invalid numeric option");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) throw new CurlError(2, "Invalid numeric option");
  return parsed;
}

function timeoutSeconds(value: string): number {
  const invalid = (): never => { throw new CurlError(2, "Invalid numeric option"); };
  let index = 0;
  while (index < value.length && " \t\n\r\v\f".includes(value[index]!)) index++;
  const negative = value[index] === "-";
  if (negative || value[index] === "+") index++;
  const hexadecimal = value.slice(index, index + 2).toLowerCase() === "0x";
  if (hexadecimal) index += 2;
  const digits = hexadecimal ? "0123456789abcdef" : "0123456789";
  const radix = hexadecimal ? 16 : 10;
  let mantissa = 0;
  let digitCount = 0;
  let fractionDigits = 0;
  let point = false;
  for (; index < value.length; index++) {
    const character = value[index]!.toLowerCase();
    const digit = digits.indexOf(character);
    if (digit >= 0) {
      mantissa = mantissa * radix + digit;
      digitCount++;
      if (point) fractionDigits++;
    } else if (character === "." && !point) point = true;
    else break;
  }
  if (!digitCount) invalid();
  let exponent = 0;
  if (value[index]?.toLowerCase() === (hexadecimal ? "p" : "e")) {
    index++;
    const exponentNegative = value[index] === "-";
    if (exponentNegative || value[index] === "+") index++;
    const start = index;
    while (index < value.length && "0123456789".includes(value[index]!)) index++;
    if (index === start) invalid();
    exponent = Number(value.slice(start, index)) * (exponentNegative ? -1 : 1);
  }
  if (index !== value.length) invalid();
  const parsed = hexadecimal
    ? (negative ? -1 : 1) * mantissa * 2 ** (exponent - fractionDigits * 4)
    : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) invalid();
  return parsed;
}

export function validateRequestHeader(name: string, value: string): void {
  try { validateHeaderName(name); validateHeaderValue(name, value); }
  catch { throw new CurlError(2, "Invalid HTTP header"); }
  if (["host", "content-length", "transfer-encoding", "connection", "proxy-authorization", "upgrade", "expect"].includes(name.toLowerCase())) {
    throw new CurlError(2, "Transport-controlled HTTP header is not supported");
  }
}

function addHeader(result: CurlArguments, raw: string): void {
  const colon = raw.indexOf(":");
  const semicolon = colon < 0 && raw.endsWith(";");
  if (colon < 1 && !semicolon) throw new CurlError(2, "Invalid HTTP header");
  const name = semicolon ? raw.slice(0, -1) : raw.slice(0, colon);
  const value = semicolon ? "" : raw.slice(colon + 1).trim();
  validateRequestHeader(name, value);
  result.headers.push([name, value === "" && !semicolon ? null : value]);
}

export function parseArguments(args: readonly string[], limits: NetworkLimits): CurlArguments {
  const result: CurlArguments = {
    urls: [], data: [], headers: [], include: false, head: false, get: false, location: false,
    remoteName: false, fail: false, failWithBody: false, silent: false, showError: false,
    verbose: false, globoff: false, help: false, version: false, retries: 0, retryDelayMs: 0,
    maxTimeMs: limits.maxTimeMs, maxRedirects: limits.maxRedirects, maxFileSize: limits.maxDownloadBytes,
  };
  const apply = (option: string, value?: string): void => {
    const positive = option.startsWith("no-") ? option.slice(3) : option;
    const property = Object.hasOwn(booleans, positive) ? booleans[positive] : undefined;
    if (property) {
      Object.assign(result, { [property]: !option.startsWith("no-") });
      if (property === "remoteName") {
        (result.outputs ??= []).push({ remoteName: result.remoteName });
        if (result.remoteName) delete result.output;
      }
      return;
    }
    switch (option) {
      case "continue-at": {
        if (value === "-") result.continueAt = "auto";
        else {
          if (!value || [...value].some(character => !"0123456789".includes(character)) || !Number.isSafeInteger(Number(value))) {
            throw new CurlError(2, "Invalid resume offset");
          }
          result.continueAt = Number(value);
        }
        break;
      }
      case "etag-save": result.etagSave = value!; break;
      case "etag-compare": result.etagCompare = value!; break;
      case "cacert": result.caFile = value!; break;
      case "http1.0": result.httpVersion = "1.0"; break;
      case "http1.1": result.httpVersion = "1.1"; break;
      case "url-query": (result.query ??= []).push({ kind: value!.startsWith("+") ? "raw" : "urlencode", value: value!.startsWith("+") ? value!.slice(1) : value! }); break;
      case "request":
        if (!value || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value) || ["CONNECT", "TRACE"].includes(value.toUpperCase())) {
          throw new CurlError(2, "Invalid or unsupported HTTP method");
        }
        result.method = value; break;
      case "header": addHeader(result, value!); break;
      case "range":
        try { validateHeaderValue("Range", value!); }
        catch { throw new CurlError(2, "Invalid byte range"); }
        result.range = value!; break;
      case "user-agent": addHeader(result, `User-Agent: ${value!}`); break;
      case "referer": {
        validateRequestHeader("Referer", value!);
        const auto = value!.indexOf(";auto");
        result.autoReferer = auto >= 0;
        result.referer = auto >= 0 ? value!.slice(0, auto) : value!;
        break;
      }
      case "user":
        if (!value!.includes(":")) throw new CurlError(2, "Basic authentication requires user:password; prompting is unsupported");
        result.user = value!; break;
      case "oauth2-bearer": result.bearer = value!; break;
      case "data": case "data-ascii": result.data.push({ kind: "data", value: value! }); break;
      case "data-raw": result.data.push({ kind: "raw", value: value! }); break;
      case "data-binary": result.data.push({ kind: "binary", value: value! }); break;
      case "data-urlencode": result.data.push({ kind: "urlencode", value: value! }); break;
      case "json": case "form": case "form-string": result.data.push({ kind: option, value: value! }); break;
      case "output":
        result.output = value!; result.remoteName = false;
        (result.outputs ??= []).push({ output: value!, remoteName: false }); break;
      case "output-dir": result.outputDirectory = value!; break;
      case "dump-header": result.dumpHeader = value!; break;
      case "write-out": result.writeOut = value!; break;
      case "upload-file": result.upload = value!; break;
      case "url": result.urls.push(value!); break;
      case "max-time": {
        const milliseconds = timeoutSeconds(value!) * 1000;
        result.maxTimeMs = Math.min(milliseconds === 0 ? Infinity : milliseconds, limits.maxTimeMs);
        break;
      }
      case "connect-timeout": {
        const milliseconds = timeoutSeconds(value!) * 1000;
        if (milliseconds === 0) delete result.connectTimeoutMs;
        else result.connectTimeoutMs = Math.min(milliseconds, limits.maxTimeMs);
        break;
      }
      case "max-filesize": result.maxFileSize = Math.min(number(value!, true), limits.maxDownloadBytes); break;
      case "max-redirs": result.maxRedirects = Math.min(number(value!, true), limits.maxRedirects); break;
      case "retry": result.retries = Math.min(number(value!, true), limits.maxRetries); break;
      case "retry-delay": result.retryDelayMs = Math.min(number(value!) * 1000, limits.maxTimeMs); break;
      case "help": result.help = true; break;
      case "version": result.version = true; break;
      case "disable": case "no-buffer": case "no-progress-meter": case "basic": break;
      default: throw new CurlError(2, "Unsupported curl option");
    }
  };
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || !argument.startsWith("-") || argument === "-") { result.urls.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      let value = equals < 0 ? undefined : argument.slice(equals + 1);
      if (longValues.has(name)) {
        value ??= args[++index];
        if (value === undefined) throw new CurlError(2, "Option requires an argument");
      } else if (value !== undefined) throw new CurlError(2, "Unexpected option argument");
      apply(name, value);
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const name = argument[offset]!;
        if (values[name]) {
          const value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) throw new CurlError(2, "Option requires an argument");
          apply(values[name], value); break;
        }
        if (!flags[name]) throw new CurlError(2, "Unsupported curl option");
        apply(flags[name]);
      }
    }
  }
  if (!result.help && !result.version && !result.urls.length) throw new CurlError(2, "No URL specified");
  if (result.urls.length > limits.maxUrls) throw new CurlError(2, "URL count exceeds host limit");
  if (result.fail && result.failWithBody) throw new CurlError(2, "--fail and --fail-with-body are mutually exclusive");
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
