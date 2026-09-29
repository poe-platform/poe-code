import { syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createWgetCommand } from "./wget.js";
import { createCurlCommand } from "./curl.js";
import type { NetworkCommandsOptions } from "./types.js";

export * from "./types.js";
export { createFetchTransport, type FetchTransportOptions } from "./fetch-transport.js";
export { createOriginAuthorizer, type OriginAllowlist, type OriginAuthorizerOptions } from "./authorizer.js";
export { createCurlCommand } from "./curl.js";
export { createWgetCommand } from "./wget.js";

export function createNetworkCommands(options: NetworkCommandsOptions): readonly CommandDefinition[] {
  return [createCurlCommand(options), createWgetCommand(options)];
}

export function networkCommands(options: NetworkCommandsOptions): VirtualShellPlugin {
  const definitions = createNetworkCommands(options);
  return {
    name: "network-commands",
    setup(host) {
      if (!options.replace) for (const definition of definitions) if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}

export const createCurlCommands = createNetworkCommands;
export const curlCommands = networkCommands;

const CURL_HELP = "Usage: curl [HTTP(S) URL] [-X METHOD] [-H HEADER] [-d DATA] [-L] [-o VFSFILE]\nExplicit host authorization is required. See network/README.md for supported flags and limits.\n";
const CURL_VERSION = "virtual-bash curl 0.0 (HTTP HTTPS; Node streaming transport)\n";
const WGET_HELP = "Usage: wget [-O FILE|-] [-q|-nv] [-T SECONDS] [-t COUNT] [URL ...]\nDownloads: --spider | -c/--continue | -nc/--no-clobber | -P/--directory-prefix DIR | --content-disposition\nInput: -i/--input-file FILE (VFS URL list; '-' reads stdin)\nRequest headers: --header 'NAME: VALUE' | --user-agent AGENT | --referer URL\nRequest bodies: --post-data DATA | --post-file FILE | --method METHOD [--body-data DATA | --body-file FILE]\nBody files are read from the VFS. Downloads require explicit host authorization. Recursive mirroring is unsupported.\nTimeout (--timeout) is aggregate and host-capped; --tries=0 remains host-capped.\n";
const WGET_VERSION = "virtual-bash wget 0.0 (bounded HTTP HTTPS)\n";

export function evalSyncCurl(opArgs: readonly string[]): string | undefined {
  if (opArgs.length === 1) {
    if (opArgs[0] === "-V" || opArgs[0] === "--version") return CURL_VERSION;
    if (opArgs[0] === "-h" || opArgs[0] === "--help") return CURL_HELP;
  }
  return undefined;
}

export function evalSyncWget(opArgs: readonly string[]): string | undefined {
  if (opArgs.length === 1) {
    if (opArgs[0] === "-V" || opArgs[0] === "--version") return WGET_VERSION;
    if (opArgs[0] === "-h" || opArgs[0] === "--help") return WGET_HELP;
  }
  return undefined;
}

syncCommandEvaluators.evalSyncCurl = evalSyncCurl;
syncCommandEvaluators.evalSyncWget = evalSyncWget;
