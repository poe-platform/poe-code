import { Shell, createMemoryFileSystem, agentCommands, networkCommands } from "../../../../src/index.js";
import { curlCommands, type HttpTransport } from "../../../../src/commands/network/index.js";

export function createCurlShell(allowedOrigin: string, transport?: HttpTransport): Shell {
  return new Shell({ fs: createMemoryFileSystem() })
    .use(agentCommands())
    .use(networkCommands({
      authorize: ({ url }) => new URL(url).origin === allowedOrigin,
      ...(transport ? { transport } : {}),
      limits: { maxTimeMs: 5000, maxDownloadBytes: 1024 * 1024 },
    }));
}

export const networkAlias = curlCommands;
