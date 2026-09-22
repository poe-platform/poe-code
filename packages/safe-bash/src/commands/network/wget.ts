import { getCommandArguments, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import { validateRequestHeader, type CurlArguments } from "./args.js";
import { createTransferCommand } from "./curl.js";
import { validateHeaderName } from "./platform.js";
import { CurlError, type NetworkCommandsOptions, type NetworkLimits } from "./types.js";

async function parseWget(context: CommandContext, limits: NetworkLimits): Promise<CurlArguments> {
  const carrier = getCommandArguments(context);
  let argumentBytes = 0;
  for (const value of carrier.values) {
    if (typeof value === "string" && value.length > limits.maxBufferBytes) throw new CurlError(2, "Arguments exceed host buffer limit");
    argumentBytes += shellValueByteLength(value);
    if (argumentBytes > limits.maxBufferBytes) throw new CurlError(2, "Arguments exceed host buffer limit");
    if (typeof value === "string") {
      for (let index = 0; index < value.length; index++) {
        if (index % 1024 === 0) await yieldTurn(context.signal);
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(++index);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CurlError(2, "Arguments must be valid UTF-8");
        } else if (code >= 0xdc00 && code <= 0xdfff) throw new CurlError(2, "Arguments must be valid UTF-8");
      }
      continue;
    }
    const bytes = shellValueBytes(value);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      await yieldTurn(context.signal);
      try { decoder.decode(bytes.subarray(offset, offset + 1024), { stream: offset + 1024 < bytes.length }); }
      catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof TypeError) || "code" in error && error.code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw error;
        throw new CurlError(2, "Arguments must be valid UTF-8");
      }
    }
  }
  const result: CurlArguments = {
    urls: [], data: [], headers: [], include: false, head: false, get: false, location: true,
    remoteName: true, fail: true, failWithBody: false, silent: false, showError: false,
    verbose: false, globoff: true, help: false, version: false,
    retries: Math.min(19, limits.maxRetries), retryDelayMs: 0,
    maxTimeMs: limits.maxTimeMs, maxRedirects: limits.maxRedirects, maxFileSize: limits.maxDownloadBytes,
    agent: "virtual-bash-wget/0.0", retryTransport: true, directoryIndex: "index.html",
  };
  const number = (value: string, integral: boolean): number => {
    if (!(integral ? /^\d+$/u : /^\d+(?:\.\d+)?$/u).test(value)) throw new CurlError(2, "Invalid numeric option");
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) throw new CurlError(2, "Invalid numeric option");
    return parsed;
  };
  const bodies: Partial<Record<"--post-data" | "--post-file" | "--body-data" | "--body-file", string>> = {};
  const headers = new Map<string, [string, string]>();
  let agent: string | undefined;
  let referer: string | undefined;
  let ended = false;
  for (let index = 0; index < context.args.length; index++) {
    if (index % 128 === 0) await yieldTurn(context.signal);
    const argument = context.args[index]!;
    if (ended || !argument.startsWith("-") || argument === "-") { result.urls.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    if (!argument.startsWith("--")) {
      for (let position = 1; position < argument.length; position++) {
        if (position % 1024 === 0) await yieldTurn(context.signal);
        const flag = argument[position];
        if (flag === "q") result.silent = true;
        else if (flag === "n" && argument[position + 1] === "v") position++;
        else if (flag === "h") result.help = true;
        else if (flag === "r") throw new CurlError(2, "Recursive mirroring is unsupported");
        else if (flag === "O") {
          const output = position + 1 < argument.length ? argument.slice(position + 1) : context.args[++index];
          if (!output) throw new CurlError(2, "-O requires a nonempty output filename");
          result.output = output; result.remoteName = false;
          break;
        } else throw new CurlError(2, `Unsupported option: -${flag}`);
      }
      continue;
    }
    if (argument === "--quiet") { result.silent = true; continue; }
    if (argument === "--no-verbose") continue;
    if (argument === "--help") { result.help = true; continue; }
    if (argument === "--version") { result.version = true; continue; }
    if (argument === "--recursive") throw new CurlError(2, "Recursive mirroring is unsupported");
    const equal = argument.indexOf("=");
    const flag = equal < 0 ? argument : argument.slice(0, equal);
    let operand: string | undefined;
    if (["--output-document", "--timeout", "--tries", "--method", "--post-data", "--post-file", "--body-data", "--body-file", "--header", "--user-agent", "--referer"].includes(flag)) {
      operand = equal < 0 ? context.args[++index] : argument.slice(equal + 1);
    } else throw new CurlError(2, `Unsupported option: ${argument}`);
    if (operand === undefined) throw new CurlError(2, `${flag} requires an argument`);
    if (flag === "--output-document") { if (!operand) throw new CurlError(2, "Output filename must not be empty"); result.output = operand; result.remoteName = false; }
    else if (flag === "--timeout") { const seconds = number(operand, false); result.maxTimeMs = seconds === 0 ? limits.maxTimeMs : Math.min(seconds * 1000, limits.maxTimeMs); }
    else if (flag === "--tries") { const tries = number(operand, true); result.retries = tries === 0 ? limits.maxRetries : Math.min(tries - 1, limits.maxRetries); }
    else if (flag === "--header") {
      if (operand === "") { headers.clear(); continue; }
      const colon = operand.indexOf(":");
      if (colon < 1) throw new CurlError(2, "Invalid HTTP header");
      const name = operand.slice(0, colon);
      const value = operand.slice(colon + 1).trim();
      validateRequestHeader(name, value);
      headers.set(name.toLowerCase(), [name, value]);
    } else if (flag === "--user-agent") {
      validateRequestHeader("User-Agent", operand);
      agent = operand;
    } else if (flag === "--referer") {
      validateRequestHeader("Referer", operand);
      referer = operand;
    }
    else if (flag === "--method") {
      try { validateHeaderName(operand); }
      catch { throw new CurlError(2, "Invalid or unsupported HTTP method"); }
      result.method = operand.toUpperCase();
      if (["CONNECT", "TRACE"].includes(result.method)) throw new CurlError(2, "Invalid or unsupported HTTP method");
    } else {
      const bodyFlag = flag as keyof typeof bodies;
      if (bodyFlag.endsWith("-file") && !operand) throw new CurlError(2, "Upload filename must not be empty");
      bodies[bodyFlag] = operand;
    }
  }
  if (agent !== undefined && !headers.has("user-agent")) result.headers.push(["User-Agent", agent === "" ? null : agent]);
  if (referer !== undefined && !headers.has("referer")) result.headers.push(["Referer", referer]);
  result.headers.push(...headers.values());
  const post = bodies["--post-data"] !== undefined || bodies["--post-file"] !== undefined;
  const customBody = bodies["--body-data"] !== undefined || bodies["--body-file"] !== undefined;
  if ((post && result.method !== undefined) || (customBody && result.method === undefined) ||
      (bodies["--post-data"] !== undefined && bodies["--post-file"] !== undefined) ||
      (bodies["--body-data"] !== undefined && bodies["--body-file"] !== undefined)) {
    throw new CurlError(2, "Incompatible request body options: use --post-data or --post-file, or --method with --body-data or --body-file");
  }
  const data = bodies["--post-data"] ?? bodies["--body-data"];
  const file = bodies["--post-file"] ?? bodies["--body-file"];
  if (data !== undefined) result.data.push({ kind: "raw", value: data });
  // Wget reads '-' as a filename, while curl's binary data mode treats it as stdin.
  else if (file !== undefined) result.data.push({ kind: "binary", value: `@${file === "-" ? "./-" : file}` });
  if (!result.help && !result.version && result.urls.length !== 1) throw new CurlError(2, "Exactly one HTTP(S) URL is required");
  return result;
}

export function createWgetCommand(options: NetworkCommandsOptions): CommandDefinition {
  return createTransferCommand(options, {
    name: "wget", parse: parseWget,
    help: "Usage: wget [-O FILE|-] [-q|-nv] [--timeout SECONDS] [--tries COUNT] URL\nRequest headers: --header 'NAME: VALUE' | --user-agent AGENT | --referer URL\nRequest bodies: --post-data DATA | --post-file FILE | --method METHOD [--body-data DATA | --body-file FILE]\nBody files are read from the VFS. Downloads require explicit host authorization. Recursive mirroring is unsupported.\nTimeout is aggregate and host-capped; --tries=0 remains host-capped.\n",
    version: "virtual-bash wget 0.0 (bounded HTTP HTTPS)\n",
    status: code => code === 0 ? 0 : [1, 2, 3].includes(code) ? 2 : [23, 26].includes(code) ? 3 : code === 60 ? 5 : code === 22 ? 8 : 4,
  });
}
