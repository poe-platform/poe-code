import { collectNetworkBytes as collectBytes } from "./shared.js";
import { getCommandArguments, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
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
    download: { spider: false, resume: false, noClobber: false, contentDisposition: false },
  };
  const number = (value: string, integral: boolean): number => {
    let start = 0;
    let end = value.length;
    if (!integral) {
      while (start < end && " \t\n\r\v\f".includes(value[start]!)) start++;
      while (end > start && " \t\n\r\v\f".includes(value[end - 1]!)) end--;
    }
    let multiplier = 1;
    if (!integral) {
      const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      const unit = units[value[end - 1]!];
      if (unit !== undefined) { multiplier = unit; end--; }
    }
    let position = start;
    if (!integral && (value[position] === "+" || value[position] === "-")) position++;
    let digits = 0;
    let dot = false;
    for (; position < end; position++) {
      const character = value[position]!;
      if (character >= "0" && character <= "9") digits++;
      else if (!integral && character === "." && !dot) dot = true;
      else throw new CurlError(2, "Invalid numeric option");
    }
    if (!digits) throw new CurlError(2, "Invalid numeric option");
    const parsed = Number(value.slice(start, end)) * multiplier;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) throw new CurlError(2, "Invalid numeric option");
    return parsed;
  };
  const bodies: Partial<Record<"--post-data" | "--post-file" | "--body-data" | "--body-file", string>> = {};
  const headers = new Map<string, [string, string]>();
  let agent: string | undefined;
  let referer: string | undefined;
  let ended = false;
  let inputFile: string | undefined;
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
        else if (flag === "c") result.download!.resume = true;
        else if (flag === "n" && argument[position + 1] === "c") { result.download!.noClobber = true; position++; }
        else if (flag === "n" && argument[position + 1] === "v") position++;
        else if (flag === "h") result.help = true;
        else if (flag === "r") throw new CurlError(2, "Recursive mirroring is unsupported");
        else if (["O", "P", "i", "T", "t"].includes(flag!)) {
          const output = position + 1 < argument.length ? argument.slice(position + 1) : context.args[++index];
          if (!output) throw new CurlError(2, `-${flag} requires a nonempty argument`);
          if (flag === "O") { result.output = output; result.remoteName = false; }
          else if (flag === "P") result.outputDirectory = output;
          else if (flag === "i") inputFile = output;
          else if (flag === "T") { const seconds = number(output, false); result.maxTimeMs = Math.min(seconds === 0 ? Infinity : seconds * 1000, limits.maxTimeMs); }
          else { const tries = number(output, true); result.retries = tries === 0 ? limits.maxRetries : Math.min(tries - 1, limits.maxRetries); }
          break;
        } else throw new CurlError(2, `Unsupported option: -${flag}`);
      }
      continue;
    }
    if (argument === "--quiet") { result.silent = true; continue; }
    if (argument === "--no-verbose") continue;
    if (argument === "--help") { result.help = true; continue; }
    if (argument === "--version") { result.version = true; continue; }
    if (argument === "--spider") { result.download!.spider = true; continue; }
    if (argument === "--continue") { result.download!.resume = true; continue; }
    if (argument === "--no-clobber") { result.download!.noClobber = true; continue; }
    if (argument === "--content-disposition") { result.download!.contentDisposition = true; continue; }
    if (argument === "--recursive") throw new CurlError(2, "Recursive mirroring is unsupported");
    const equal = argument.indexOf("=");
    const flag = equal < 0 ? argument : argument.slice(0, equal);
    let operand: string | undefined;
    if (["--directory-prefix", "--input-file", "--output-document", "--timeout", "--tries", "--method", "--post-data", "--post-file", "--body-data", "--body-file", "--header", "--user-agent", "--referer"].includes(flag)) {
      operand = equal < 0 ? context.args[++index] : argument.slice(equal + 1);
    } else throw new CurlError(2, `Unsupported option: ${argument}`);
    if (operand === undefined) throw new CurlError(2, `${flag} requires an argument`);
    if (flag === "--output-document") { if (!operand) throw new CurlError(2, "Output filename must not be empty"); result.output = operand; result.remoteName = false; }
    else if (flag === "--directory-prefix") result.outputDirectory = operand;
    else if (flag === "--input-file") inputFile = operand;
    else if (flag === "--timeout") { const seconds = number(operand, false); result.maxTimeMs = Math.min(seconds === 0 ? Infinity : seconds * 1000, limits.maxTimeMs); }
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
  if (!result.help && !result.version) {
    if (inputFile !== undefined) {
      let bytes: Uint8Array;
      try { bytes = inputFile === "-" ? await collectBytes(context.stdin, { signal: context.signal, maxBytes: limits.maxBufferBytes }) : await context.fs.readFile(pathOf(context, inputFile), { signal: context.signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {}) }); }
      catch { context.signal.throwIfAborted(); throw new CurlError(26, "Failed reading virtual URL input file"); }
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new CurlError(2, "URL input must be valid UTF-8"); }
      for (const line of text.split("\n")) {
        await yieldTurn(context.signal);
        const url = line.trim();
        if (url) result.urls.push(url);
        if (result.urls.length > limits.maxUrls) throw new CurlError(2, "URL count exceeds host limit");
      }
    }
    if (!result.urls.length) throw new CurlError(2, "An HTTP(S) URL is required");
    if (result.urls.length > limits.maxUrls) throw new CurlError(2, "URL count exceeds host limit");
    if (result.download!.resume && result.download!.noClobber) throw new CurlError(2, "Continue and no-clobber are incompatible");
    if (result.output === "-" && (result.download!.resume || result.download!.noClobber)) throw new CurlError(2, "Download controls require a file output");
  }
  return result;
}

export function createWgetCommand(options: NetworkCommandsOptions): CommandDefinition {
  return createTransferCommand(options, {
    name: "wget", parse: parseWget,
    help: "Usage: wget [-O FILE|-] [-q|-nv] [-T SECONDS] [-t COUNT] [URL ...]\nDownloads: --spider | -c/--continue | -nc/--no-clobber | -P/--directory-prefix DIR | --content-disposition\nInput: -i/--input-file FILE (VFS URL list; '-' reads stdin)\nRequest headers: --header 'NAME: VALUE' | --user-agent AGENT | --referer URL\nRequest bodies: --post-data DATA | --post-file FILE | --method METHOD [--body-data DATA | --body-file FILE]\nBody files are read from the VFS. Downloads require explicit host authorization. Recursive mirroring is unsupported.\nTimeout (--timeout) is aggregate and host-capped; --tries=0 remains host-capped.\n",
    version: "virtual-bash wget 0.0 (bounded HTTP HTTPS)\n",
    status: code => code === 0 ? 0 : [1, 2, 3].includes(code) ? 2 : [23, 26].includes(code) ? 3 : code === 60 ? 5 : code === 22 ? 8 : 4,
  });
}
