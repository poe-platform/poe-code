import { getCommandArguments, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { yieldTurn } from "../../contracts/yield.js";
import type { CurlArguments } from "./args.js";
import { createTransferCommand } from "./curl.js";
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
    let option: "output" | "timeout" | "tries";
    if (["--output-document", "--timeout", "--tries"].includes(flag)) {
      option = flag === "--output-document" ? "output" : flag === "--timeout" ? "timeout" : "tries";
      operand = equal < 0 ? context.args[++index] : argument.slice(equal + 1);
    } else throw new CurlError(2, `Unsupported option: ${argument}`);
    if (operand === undefined) throw new CurlError(2, `${flag} requires an argument`);
    if (option === "output") { if (!operand) throw new CurlError(2, "Output filename must not be empty"); result.output = operand; result.remoteName = false; }
    else if (option === "timeout") { const seconds = number(operand, false); result.maxTimeMs = seconds === 0 ? limits.maxTimeMs : Math.min(seconds * 1000, limits.maxTimeMs); }
    else { const tries = number(operand, true); result.retries = tries === 0 ? limits.maxRetries : Math.min(tries - 1, limits.maxRetries); }
  }
  if (!result.help && !result.version && result.urls.length !== 1) throw new CurlError(2, "Exactly one HTTP(S) URL is required");
  return result;
}

export function createWgetCommand(options: NetworkCommandsOptions): CommandDefinition {
  return createTransferCommand(options, {
    name: "wget", parse: parseWget,
    help: "Usage: wget [-O FILE|-] [-q|-nv] [--timeout SECONDS] [--tries COUNT] URL\nVFS downloads require explicit host authorization. Recursive mirroring is unsupported.\nTimeout is aggregate and host-capped; --tries=0 remains host-capped.\n",
    version: "virtual-bash wget 0.0 (bounded HTTP HTTPS)\n",
    status: code => code === 0 ? 0 : [1, 2, 3].includes(code) ? 2 : [23, 26].includes(code) ? 3 : code === 60 ? 5 : code === 22 ? 8 : 4,
  });
}
