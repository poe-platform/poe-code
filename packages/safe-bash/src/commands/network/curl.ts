import { scheduleNetworkDeadline } from "./deadline.js";
import { collectNetworkBytes as collectBytes } from "./shared.js";
import { normalizePath, posixPath as posix } from "../../contracts/path.js";
import { FsError } from "../../contracts/index.js";
import { inheritYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
import { createOutputOperation, readBytes, toByteSource, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { createDeadlineOutput, deadlineDiagnostic } from "./aggregate.js";
import { validateRequestHeader, type CurlArguments } from "./args.js";
import { curlRequestTarget } from "./url.js";
import { expandUrls, globFilename, type ExpandedUrl } from "./glob.js";
import { parseCurlInput } from "./input.js";
import { createBody, queryData } from "./body.js";
import { decodeContent } from "./decode.js";
import { dumpHeaders, responseHeaders, writeOutput, writeOutFormat } from "./output.js";
import { delay, diagnostic, encode, header, limitsFor, networkError, withSignal } from "./shared.js";
import { createDefaultHttpTransport } from "./platform.js";
import { CurlError, type HttpHeaders, type HttpResponse, type NetworkCommandsOptions, type NetworkLimits } from "./types.js";

const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const writeOutDefaults: Readonly<Record<string, string>> = Object.freeze({
  http_code: "000", response_code: "000", url_effective: "", redirect_url: "", content_type: "",
  size_download: "0", size_upload: "0", num_redirects: "0", num_retries: "0", time_total: "0.000000",
  exitcode: "0", errormsg: "", filename_effective: "", method: "GET", http_version: "",
});

function parseUrl(text: string, redirect = false): { url: URL; user?: string } {
  if (/[\s\x00-\x1f\x7f]/.test(text)) throw new CurlError(3, "Malformed URL");
  let url: URL;
  try { url = new URL(text); } catch { throw new CurlError(3, "Malformed URL; explicit HTTP(S) scheme required"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new CurlError(1, "Only HTTP and HTTPS are supported");
  if (!url.hostname) throw new CurlError(3, "Malformed URL");
  let user: string | undefined;
  if (url.username || url.password) {
    if (redirect) throw new CurlError(3, "Redirect URLs may not supply credentials");
    try { user = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`; }
    catch { throw new CurlError(3, "Malformed URL credentials"); }
    url.username = ""; url.password = "";
  }
  url.hash = "";
  return { url, ...(user === undefined ? {} : { user }) };
}

function requestHeaders(args: CurlArguments, contentType: string | undefined, user: string | undefined, scoped: boolean, maxBytes: number, previous?: string): HttpHeaders {
  const json = args.data[0]?.kind === "json";
  // --json supplies semantic headers even when a redirect or -G removes the body.
  if (json) contentType = "application/json";
  const defaults: [string, string][] = [["Accept", json ? "application/json" : "*/*"], ["User-Agent", args.agent ?? "virtual-bash-curl/0.0"]];
  if (contentType !== undefined) defaults.push(["Content-Type", contentType]);
  if (args.compressed) defaults.push(["Accept-Encoding", "gzip, deflate"]);
  const referer = args.autoReferer && previous !== undefined ? previous : args.referer;
  if (referer) {
    validateRequestHeader("Referer", referer);
    defaults.push(["Referer", referer]);
  }
  if (scoped && args.etag !== undefined) defaults.push(["If-None-Match", args.etag]);
  if (args.range !== undefined) defaults.push(["Range", `bytes=${args.range}`]);
  if (scoped && user !== undefined) defaults.push(["Authorization", `Basic ${Buffer.from(user).toString("base64")}`]);
  if (scoped && args.bearer !== undefined) {
    if (/[\r\n\0]/.test(args.bearer)) throw new CurlError(2, "Invalid bearer token");
    defaults.push(["Authorization", `Bearer ${args.bearer}`]);
  }
  const custom = scoped ? args.headers : [];
  const names = new Set(custom.map(([name]) => name.toLowerCase()));
  const result = [...defaults.filter(([name]) => !names.has(name.toLowerCase())),
    ...custom.filter((entry): entry is [string, string] => entry[1] !== null)];
  if (result.reduce((size, [name, value]) => size + Buffer.byteLength(name + value) + 4, 0) > maxBytes) {
    throw new CurlError(63, "Request headers exceed host byte limit");
  }
  return result;
}

async function stop(response: HttpResponse | undefined, signal: AbortSignal): Promise<void> {
  if (!response) return;
  const cleanup = Promise.resolve().then(() => response.dispose());
  void cleanup.catch(() => {});
  if (!signal.aborted) await withSignal(() => cleanup, signal).catch(() => {});
}

function pipeClosed(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPIPE";
}

function remoteFilename(url: URL): string {
  if (url.pathname === "/") return "curl_response";
  const name = posix.basename(url.pathname);
  if (!name || name === "/" || name === "." || name === "..") throw new CurlError(23, "URL has no safe remote filename");
  return name;
}

async function existingSize(context: CommandContext, output: string, signal: AbortSignal): Promise<number | undefined> {
  try { return (await context.fs.stat(pathOf(context, output), { signal })).size; }
  catch (error) {
    signal.throwIfAborted();
    if (error instanceof FsError && error.code === "ENOENT") return undefined;
    throw new CurlError(23, "Failed inspecting virtual output file");
  }
}

interface TransferProfile {
  readonly name: string;
  readonly help: string;
  readonly version: string;
  parse(context: CommandContext, limits: NetworkLimits): CurlArguments | Promise<CurlArguments>;
  status(code: number): number;
}

export function createCurlCommand(options: NetworkCommandsOptions): CommandDefinition {
  return createTransferCommand(options, {
    name: "curl",
    help: "Usage: curl [HTTP(S) URL] [-X METHOD] [-H HEADER] [-d DATA] [-L] [-o VFSFILE]\nExplicit host authorization is required. See network/README.md for supported flags and limits.\n",
    version: "virtual-bash curl 0.0 (HTTP HTTPS; Node streaming transport)\n",
    parse: parseCurlInput,
    status: code => code,
  });
}

export function createTransferCommand(options: NetworkCommandsOptions, profile: TransferProfile): CommandDefinition {
  if (typeof options?.authorize !== "function") throw new TypeError(`${profile.name} requires an explicit network authorizer`);
  const limits = limitsFor(options.limits);
  const transport = options.transport ?? createDefaultHttpTransport({ maxHeaderBytes: limits.maxHeaderBytes });
  if (typeof transport !== "function") throw new TypeError("Invalid HTTP transport");
  const authorize = options.authorize;
  const executions = new WeakMap<object, number>();
  return {
    name: profile.name,
    async execute(context) {
      context.signal.throwIfAborted();
      const scope = context.executionScope ?? {};
      let started = executions.get(scope) ?? performance.now();
      const parsing = new AbortController();
      const parsingSignal = AbortSignal.any([context.signal, parsing.signal]);
      inheritYieldCheckpoint(context.signal, parsingSignal);
      const cancelParsingDeadline = scheduleNetworkDeadline(limits.maxTotalTimeMs - (performance.now() - started),
        () => parsing.abort(new CurlError(28, "Operation timed out")));
      let args: CurlArguments;
      let expanded: (ExpandedUrl & { destination?: { output?: string; remoteName: boolean } })[];
      try {
        if (context.args.reduce((size, value) => size + Buffer.byteLength(value), 0) > limits.maxBufferBytes) throw new CurlError(2, "Arguments exceed host buffer limit");
        args = await withSignal(() => profile.parse({ ...context, signal: parsingSignal }, limits), parsingSignal);
        parsingSignal.throwIfAborted();
        if (performance.now() - started >= limits.maxTotalTimeMs) throw new CurlError(28, "Operation timed out");
        if (args.help || args.version) {
          await writeBytes(context.stdout, encode(args.version ? profile.version : profile.help), context.signal);
          return { exitCode: 0 };
        }
        if (args.connectTimeoutMs !== undefined && transport.supportsConnectTimeout !== true) {
          throw new CurlError(2, "Transport cannot enforce connection timeout");
        }
        if (args.caFile !== undefined && transport.supportsRequestCa !== true) {
          throw new CurlError(2, "Transport cannot enforce request CA trust");
        }
        if (args.httpVersion !== undefined && !transport.supportedHttpVersions?.includes(args.httpVersion)) {
          throw new CurlError(2, "Transport cannot enforce requested HTTP version");
        }
        if (args.ignoreContentLength && transport.supportsIgnoreContentLength !== true) {
          throw new CurlError(2, "Transport cannot enforce ignored Content-Length");
        }
        expanded = expandUrls(args.urls, args.globoff, limits);
        for (const item of expanded) parseUrl(item.url);
        if (!args.download) {
          expanded = args.urls.flatMap((url, index) => expandUrls([url], args.globoff, limits)
            .map(item => ({ ...item, destination: args.outputs?.[index] ?? { remoteName: false } })));
        }
      } catch (error) {
        context.signal.throwIfAborted();
        const failure = error instanceof CurlError ? error : new CurlError(2, `Invalid ${profile.name} arguments`);
        const reported = new CurlError(profile.status(failure.exitCode), failure.message);
        if (failure.exitCode === 28) {
          try { await deadlineDiagnostic(context, reported, 0); }
          catch (error) { context.signal.throwIfAborted(); if (!(error instanceof CurlError)) throw error; }
        } else await diagnostic(context, reported);
        return { exitCode: profile.status(failure.exitCode) };
      } finally {
        cancelParsingDeadline();
      }
      started = Math.min(started, executions.get(scope) ?? started);
      executions.set(scope, started);
      let exitCode = 0;
      const headerState = { dumped: false };
      for (const item of expanded) {
        context.signal.throwIfAborted();
        if (performance.now() - started >= limits.maxTotalTimeMs) {
          const failure = new CurlError(28, "Operation timed out");
          if (!args.silent || args.showError) {
            try { await deadlineDiagnostic(context, failure, 0); }
            catch (error) { context.signal.throwIfAborted(); if (!(error instanceof CurlError)) throw error; }
          }
          return { exitCode: profile.status(failure.exitCode) };
        }
        const transferArgs = { ...args };
        if (item.destination) {
          delete transferArgs.output;
          transferArgs.remoteName = item.destination.remoteName;
          if (item.destination.output !== undefined) transferArgs.output = item.destination.output;
        }
        if (transferArgs.output !== undefined) transferArgs.output = globFilename(transferArgs.output, item.captures);
        const code = await transfer(context, transferArgs, item.url, limits, transport, authorize, started, profile.status, headerState);
        exitCode = args.download ? code || exitCode : code;
      }
      return { exitCode };
    },
  };
}

async function transfer(context: CommandContext, args: CurlArguments, input: string, limits: NetworkLimits,
  transport: NonNullable<NetworkCommandsOptions["transport"]>, authorize: NetworkCommandsOptions["authorize"], started: number, status: (code: number) => number, headerState: { dumped: boolean }): Promise<number> {
  const start = performance.now();
  const remaining = (): number => Math.min(args.maxTimeMs - (performance.now() - start), limits.maxTotalTimeMs - (performance.now() - started));
  const hasFileOutput = args.etagSave !== undefined && args.etagSave !== "-" || args.remoteName || args.output !== undefined && args.output !== "-" || args.dumpHeader !== undefined && args.dumpHeader !== "-";
  const operation = createDeadlineOutput(context, hasFileOutput ? { write: chunk => context.stdout.write(chunk) } : context.stdout, remaining());
  const signal = operation.signal;
  const borrowed: ByteSource = context.stdout.ownedOutput ? { [Symbol.asyncIterator]() {
    const iterator = context.stdin[Symbol.asyncIterator]();
    return { next: () => iterator.next() };
  } } : context.stdin;
  let response: HttpResponse | undefined;
  let failure: CurlError | undefined;
  const values = { ...writeOutDefaults };
  let format = args.writeOut;
  let formatReady = false;
  let dumped = false;
  let downloaded = 0;
  let uploaded = 0;
  let included: Uint8Array[] = [];
  let closedOutput = false;
  const publish = async (bytes: Uint8Array): Promise<void> => {
    const writing = createDeadlineOutput(context, context.stdout, remaining());
    try { await writeBytes(writing.output, bytes, writing.signal); }
    catch (error) {
      context.signal.throwIfAborted();
      if (!pipeClosed(error)) throw error;
      closedOutput = true;
    } finally { await writing.close(); }
  };
  try {
    if (args.etagCompare !== undefined) {
      let bytes: Uint8Array;
      try {
        bytes = await withSignal(() => context.fs.readFile(pathOf(context, args.etagCompare!), { signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {}) }), signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof FsError && error.code === "ENOENT")) throw new CurlError(26, "Failed reading virtual ETag file");
        bytes = new Uint8Array();
      }
      if (bytes.length > limits.maxBufferBytes) throw new CurlError(63, "ETag file exceeds host buffer limit");
      const text = Buffer.from(bytes).toString("latin1");
      args.etag = text.split("\r").join("").split("\n").join("") || '""';
      validateRequestHeader("If-None-Match", args.etag);
    }
    let ca: Uint8Array | undefined;
    if (args.caFile !== undefined) {
      try {
        const bytes = await withSignal(() => context.fs.readFile(pathOf(context, args.caFile!), { signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {}) }), signal);
        signal.throwIfAborted();
        if (bytes.length > limits.maxBufferBytes) throw new CurlError(77, "CA certificate exceeds host buffer limit");
        ca = new Uint8Array(bytes);
      } catch {
        signal.throwIfAborted();
        throw new CurlError(77, "Failed reading virtual CA certificate file");
      }
    }
    if (format?.startsWith("@")) {
      try {
        const bytes = format === "@-"
          ? await collectBytes(borrowed, { signal, maxBytes: limits.maxBufferBytes })
          : await withSignal(() => context.fs.readFile(pathOf(context, format!.slice(1)), { signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {}) }), signal);
        format = Buffer.from(bytes).toString("utf8");
      } catch { signal.throwIfAborted(); throw new CurlError(26, "Failed reading write-out format"); }
    }
    if (format !== undefined) { writeOutFormat(format, values, limits.maxBufferBytes); formatReady = true; }
    const parsed = parseUrl(input);
    const initial = parsed.url;
    const rawTarget = curlRequestTarget(input);
    let initialTarget = rawTarget;
    const initialSearch = initial.search;
    if (args.query?.length) {
      const queryArgs = { ...args, data: args.query };
      delete queryArgs.upload;
      const queryBody = createBody({ ...context, stdin: borrowed }, queryArgs, limits)!;
      const encoded = await queryData(queryBody, signal, limits);
      let query = "";
      for (let index = 0; index < encoded.length; index++) {
        const character = encoded[index]!;
        if (character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126) throw new CurlError(3, "Query data must be URL encoded");
        if (character === "%" && index + 2 < encoded.length &&
            "0123456789abcdefABCDEF".includes(encoded[index + 1]!) && "0123456789abcdefABCDEF".includes(encoded[index + 2]!)) {
          query += encoded.slice(index, index + 3).toLowerCase(); index += 2;
        } else query += character;
      }
      initial.search += `${initial.search ? "&" : "?"}${query}`;
    }
    let body = createBody({ ...context, stdin: borrowed }, args, limits);
    if (args.get && body) {
      const query = await queryData(body, signal, limits);
      if (/[^\x21-\x7e]/.test(query)) throw new CurlError(3, "GET data must be URL encoded");
      initial.search += `${initial.search ? "&" : "?"}${query.replace(/%[0-9a-f]{2}/gi, escape => escape.toLowerCase())}`;
      body = undefined;
    }
    if (initial.search !== initialSearch) initialTarget += initial.search.slice(initialSearch.length);
    let output = args.remoteName ? args.directoryIndex && initial.pathname.endsWith("/") ? args.directoryIndex : remoteFilename(initial) : args.output;
    if (args.outputDirectory !== undefined && output !== undefined && output !== "-" && (!args.download || args.remoteName)) {
      output = `${args.outputDirectory}/${output}`;
    }
    values.filename_effective = output && output !== "-" ? output : "";
    let resumeOffset = 0;
    if (args.continueAt !== undefined) {
      resumeOffset = args.continueAt === "auto"
        ? output && output !== "-" ? await existingSize(context, output, signal) ?? 0 : 0
        : args.continueAt;
    }
    if (args.download && !args.download.spider && output && output !== "-") {
      if (args.download.noClobber && !args.download.contentDisposition && await existingSize(context, output, signal) !== undefined) return 0;
      if (args.download.resume) resumeOffset = await existingSize(context, output, signal) ?? 0;
    }
    if (output && output !== "-" && args.dumpHeader && args.dumpHeader !== "-" &&
      normalizePath(pathOf(context, output)) === normalizePath(pathOf(context, args.dumpHeader))) {
      throw new CurlError(23, "Body and header output files must differ");
    }
    const initialRequestMethod = args.head || args.download?.spider ? "HEAD" : args.get ? "GET" : args.upload !== undefined ? "PUT" : body ? "POST" : "GET";
    const initialMethod = args.method ?? initialRequestMethod;
    requestHeaders(args, body?.contentType, args.user ?? parsed.user, true, limits.maxHeaderBytes);
    attempts: for (let attempt = 0; attempt <= args.retries; attempt++) {
      if (attempt && args.download?.resume && output && output !== "-") resumeOffset = await existingSize(context, output, signal) ?? 0;
      values.num_retries = String(attempt);
      downloaded = 0;
      uploaded = 0;
      failure = undefined;
      let current = new URL(initial);
      let currentUrl = current.origin + initialTarget;
      let method = initialMethod;
      let requestMethod = initialRequestMethod;
      let currentBody = body;
      let credentialsInScope = true;
      let previous: string | undefined;
      let redirects = 0;
      included = [];
      let headerBytes = 0;
      while (true) {
        signal.throwIfAborted();
        if (remaining() <= 0) throw new CurlError(28, "Operation timed out");
        values.url_effective = currentUrl;
        values.method = method;
        let denyPrivateNetworks = false;
        let allowed: boolean;
        try { allowed = await withSignal(() => authorize({ url: currentUrl, method, attempt, signal,
          requirePrivateNetworkDeny() { denyPrivateNetworks = true; },
          ...(previous === undefined ? {} : { redirectFrom: previous }) }), signal); }
        catch { signal.throwIfAborted(); throw new CurlError(7, "Network authorization failed"); }
        if (remaining() <= 0) throw new CurlError(28, "Operation timed out");
        if (allowed !== true) throw new CurlError(7, "Network access denied by host policy");
        const policy = denyPrivateNetworks ? { denyPrivateNetworks: true as const } : {};
        if (policy.denyPrivateNetworks && transport.supportsPrivateNetworkDeny !== true) {
          throw new CurlError(7, "Transport cannot enforce private network policy");
        }
        const headers = requestHeaders(resumeOffset ? { ...args, range: `${resumeOffset}-` } : args, currentBody?.contentType, args.user ?? parsed.user, credentialsInScope, limits.maxHeaderBytes, previous);
        if (args.verbose) await writeBytes(context.stderr, encode(`> ${method} ${current.origin}\n${headers.map(([name]) => `> ${name}: [redacted]\n`).join("")}`), signal);
        const upload: ByteSource | undefined = currentBody && (async function* () {
          for await (const chunk of currentBody!.open(signal)) { uploaded += chunk.length; yield chunk; }
        })();
        try {
        response = await operation.acquire(async () => {
          const acquired = await transport({ url: currentUrl, method, headers, signal, responseBodyMode: args.download && method === "HEAD" || args.head || args.download?.spider ? "omit" : args.fail ? "omit-on-http-error" : "read",
            ...(args.httpVersion === undefined ? {} : { httpVersion: args.httpVersion }),
            ...(args.ignoreContentLength ? { ignoreContentLength: true as const } : {}),
            registerCleanup: operation.registerCleanup, ...policy, ...(upload ? { body: upload } : {}),
            ...(ca === undefined ? {} : { ca }),
            ...(args.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: args.connectTimeoutMs }) });
          let cleanup: Promise<void> | undefined;
          return { ...acquired, dispose() { cleanup ??= Promise.resolve().then(() => acquired.dispose()); return cleanup; } };
        }, result => result.dispose());
        } catch (error) {
          signal.throwIfAborted();
          const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
          if (args.retryTransport && (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") && attempt < args.retries) {
            await delay(args.retryDelayMs || Math.min(1000 * 2 ** attempt, 600_000), signal);
            continue attempts;
          }
          throw error;
        }
        const block = responseHeaders(response, limits.maxHeaderBytes);
        headerBytes += block.length;
        if (headerBytes > limits.maxHeaderBytes) throw new CurlError(63, "Combined response headers exceed host byte limit");
        values.http_code = values.response_code = String(response.status).padStart(3, "0");
        values.content_type = header(response.headers, "content-type") ?? "";
        values.http_version = response.httpVersion ?? "1.1";
        if (args.verbose) await writeBytes(context.stderr, encode(`< HTTP ${response.status}\n`), signal);
        if (args.dumpHeader !== undefined) {
          if (args.dumpHeader === "-") await publish(block);
          else {
            await dumpHeaders(context, args.dumpHeader, block, dumped || headerState.dumped, signal);
            headerState.dumped = true;
          }
          dumped = true;
        }
        if (args.etagSave !== undefined) {
          const tag = header(response.headers, "etag");
          const bytes = tag === undefined ? new Uint8Array() : new Uint8Array(Buffer.from(`${tag}\n`, "latin1"));
          if (args.etagSave === "-") await publish(bytes);
          else await writeOutput(context, args.etagSave, toByteSource(bytes), signal);
        }
        if (args.head || args.include) included.push(block);
        const location = header(response.headers, "location");
        if (redirectStatuses.has(response.status) && location !== undefined) {
          let target: URL;
          let targetUrl: string;
          try {
            const base = currentUrl.split("?")[0]!;
            const colon = location.indexOf(":");
            const boundary = [...location].findIndex(character => "/?#".includes(character));
            const resolved = colon >= 0 && (boundary < 0 || colon < boundary) ? location : location.startsWith("//") ? current.protocol + location
              : location.startsWith("/") ? current.origin + location
              : location.startsWith("?") ? base + location
              : location.startsWith("#") || location === "" ? currentUrl + location
              : base.slice(0, base.lastIndexOf("/") + 1) + location;
            target = parseUrl(resolved, true).url;
            targetUrl = target.origin + curlRequestTarget(resolved);
          }
          catch (error) { if (error instanceof CurlError) throw error; throw new CurlError(3, "Malformed redirect URL"); }
          values.redirect_url = targetUrl;
          if (args.location) {
            if (redirects++ >= args.maxRedirects) throw new CurlError(47, "Maximum redirects exceeded");
            if (current.protocol === "https:" && target.protocol === "http:") throw new CurlError(1, "HTTPS-to-HTTP redirects are disabled");
            if (target.origin !== current.origin) credentialsInScope = false;
            if ((response.status === 303 && method !== "HEAD") || ([301, 302].includes(response.status) && requestMethod === "POST")) {
              currentBody = undefined;
              requestMethod = "GET";
              if (args.method === undefined) method = "GET";
            }
            previous = currentUrl;
            current = target;
            currentUrl = targetUrl;
            values.num_redirects = String(redirects);
            await stop(response, signal); response = undefined;
            continue;
          }
        }
        break;
      }
      if (!response) throw new CurlError(56, "No HTTP response");
      if (args.download?.contentDisposition && args.remoteName) {
        const disposition = header(response.headers, "content-disposition");
        const parameter = disposition?.split(";").map(part => part.trim()).find(part => part.slice(0, part.indexOf("=")).toLowerCase() === "filename");
        if (parameter) {
          let filename = parameter.slice(parameter.indexOf("=") + 1).trim();
          if (filename.startsWith('"') && filename.endsWith('"')) filename = filename.slice(1, -1);
          filename = posix.basename(filename.split("\\").join("/"));
          if (filename && filename !== "." && filename !== ".." && !filename.includes("\0")) output = args.outputDirectory === undefined ? filename : `${args.outputDirectory}/${filename}`;
        }
      }
      if (args.download?.noClobber && output && output !== "-" && await existingSize(context, output, signal) !== undefined) return 0;
      let append = false;
      if (resumeOffset && response.status === 206) {
        const range = header(response.headers, "content-range") ?? "";
        if (!range.startsWith(`bytes ${resumeOffset}-`)) throw new CurlError(args.continueAt === undefined ? 56 : 33, "Invalid resume Content-Range");
        append = true;
      }
      if (resumeOffset && response.status === 416) {
        if (header(response.headers, "content-range") === `bytes */${resumeOffset}`) return 0;
      }
      if (resumeOffset && args.continueAt !== undefined && !append) throw new CurlError(33, "Server does not support resuming this transfer");
      if (response.status >= 400 && (args.fail || args.failWithBody)) failure = new CurlError(22, `HTTP response status ${response.status}`);
      const suppressBody = response.status === 304 || args.fail && failure !== undefined;
      const readBody = !(args.download && method === "HEAD") && !args.head && !suppressBody;
      let published = 0;
      if (!args.download?.spider && (!suppressBody || included.length)) {
        if (args.download && output && output !== "-") await context.fs.mkdir(posix.dirname(pathOf(context, output)), { recursive: true, signal });
        const length = args.ignoreContentLength ? undefined : header(response.headers, "content-length");
        if (readBody && length && /^\d+$/.test(length) && Number(length) > args.maxFileSize) throw new CurlError(63, "Response exceeds download byte limit");
        const final = response;
        const encoding = header(final.headers, "content-encoding");
        const writing = output === undefined || output === "-" ? createOutputOperation({ ...context, signal }, context.stdout) : undefined;
        const bodySignal = writing?.signal ?? signal;
        const source: ByteSource = (async function* () {
          for (const bytes of included) { published += bytes.length; yield bytes; }
          if (readBody) {
            if (args.raw && final.contentDecoded && encoding) throw new CurlError(61, "Transport cannot preserve encoded response bytes");
            if (args.raw && header(final.headers, "transfer-encoding")) throw new CurlError(61, "Raw transfer encoding is unsupported by this transport");
            let chunks = 0;
            const encoded: ByteSource = (async function* () {
              for await (const chunk of readBytes(final.body, bodySignal)) {
                downloaded += chunk.length;
                if (downloaded > args.maxFileSize) throw new CurlError(63, "Response exceeds download byte limit");
                yield chunk;
              }
              if (!final.contentDecoded && length && /^\d+$/.test(length) && downloaded !== Number(length)) throw new CurlError(18, "Partial HTTP response body");
            })();
            const decoded = args.compressed && !args.raw && !final.contentDecoded && encoding
              ? decodeContent(encoded, encoding, bodySignal, args.maxFileSize) : encoded;
            let outputBytes = 0;
            try {
              for await (const chunk of decoded) {
                if (++chunks % 256 === 0) { await yieldTurn(context.signal); bodySignal.throwIfAborted(); }
                outputBytes += chunk.length;
                if (outputBytes > args.maxFileSize) throw new CurlError(63, "Decoded response exceeds download byte limit");
                published += chunk.length;
                yield chunk;
              }
            } catch (error) {
              bodySignal.throwIfAborted();
              if (!(error instanceof CurlError) && !final.contentDecoded && length && /^\d+$/.test(length) && downloaded < Number(length)) throw new CurlError(18, "Partial HTTP response body");
              throw networkError(error);
            }
          }
        })();
        try { await writeOutput(writing ? { ...context, stdout: writing.output } : context, output, source, bodySignal, append, args.failWithBody && failure !== undefined); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!pipeClosed(error)) throw error;
          closedOutput = true;
        } finally { await writing?.close(); }
      }
      if (retryStatuses.has(response.status) && attempt < args.retries) {
        if (failure && (!args.silent || args.showError)) await deadlineDiagnostic(context, new CurlError(status(failure.exitCode), failure.message), remaining());
        const after = header(response.headers, "retry-after");
        let wait = args.retryDelayMs || Math.min(1000 * 2 ** attempt, 600_000);
        if (after !== undefined) {
          const parsed = /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
          if (Number.isFinite(parsed)) wait = Math.max(wait, parsed);
        }
        await stop(response, signal); response = undefined;
        if (published && output !== undefined && output !== "-" && !args.download?.resume) await writeOutput(context, output, toByteSource(""), signal);
        await delay(Math.min(wait, limits.maxTimeMs), signal);
        continue;
      }
      break;
    }
  } catch (error) {
    if (context.signal.aborted) throw context.signal.reason;
    if (pipeClosed(error)) closedOutput = true;
    else if (!hasFileOutput && context.stdout.ownedOutput?.consumerClosed.aborted) failure = new CurlError(23, "Failed writing output");
    else failure = signal.aborted && signal.reason instanceof CurlError ? signal.reason : networkError(error);
  } finally {
    try { await operation.close(); }
    finally { context.signal.throwIfAborted(); }
  }
  values.size_download = String(downloaded);
  values.size_upload = String(uploaded);
  values.time_total = ((performance.now() - start) / 1000).toFixed(6);
  values.exitcode = String(failure?.exitCode ?? 0);
  values.errormsg = failure?.message ?? "";
  if (format !== undefined && formatReady) {
    try { await publish(writeOutFormat(format, values, limits.maxBufferBytes)); }
    catch (error) { context.signal.throwIfAborted(); failure = error instanceof CurlError ? error : new CurlError(23, "Failed writing write-out result"); }
  }
  if (failure && (!args.silent || args.showError)) {
    try { await deadlineDiagnostic(context, new CurlError(status(failure.exitCode), failure.message), remaining()); }
    catch (error) { context.signal.throwIfAborted(); if (!(error instanceof CurlError)) throw error; failure = error; }
  }
  return failure ? status(failure.exitCode) : closedOutput ? 141 : 0;
}
