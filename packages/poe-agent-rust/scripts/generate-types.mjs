// Manual development-only declaration seed. No original runtime code is imported.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url),
  printer = ts.createPrinter();
function seed(file, target, names, imports) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL("../poe-agent/dist/" + file, root), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const statements = source.statements.filter((statement) =>
    names
      ? statement.name && names.includes(statement.name.text)
      : ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)
  );
  writeFileSync(
    new URL("src/" + target + ".d.ts", root),
    imports +
      "\n" +
      statements
        .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, source))
        .join("\n") +
      "\n"
  );
}
seed("runtime/types.d.ts", "types", null, "import type {SpawnMode} from './spawn-types.js';");
seed(
  "runtime/plugin-types.d.ts",
  "plugin-types",
  null,
  "import type {ChatMessage,ForkResult,NormalizedTool,Tool,ToolCallRecord} from './types.js';\nimport type {McpSpawnServer} from './spawn-types.js';\nimport type {AcpModel} from './acp-model.js';\nimport type {RunContextLogger} from './logger.js';"
);
seed(
  "runtime/acp-core.d.ts",
  "acp-model",
  ["AcpModelToolDefinition", "AcpModelResponse", "AcpModelRequestMessage", "AcpModel"],
  "import type {ProviderStreamEvent} from './plugin-types.js';\nimport type {ToolResultPart} from './types.js';"
);
seed("runtime/run-context.d.ts", "logger", ["RunContextLogger"], "");
seed(
  "runtime/resolve-provider.d.ts",
  "providers",
  [
    "ProviderResolutionErrorOptions",
    "ProviderResolutionError",
    "DuplicateProviderNameError",
    "collectProviders",
    "resolveProvider"
  ],
  "import type {AgentPlugin,Provider} from './plugin-types.js';"
);
seed(
  "runtime/provider-metadata.d.ts",
  "provider-metadata",
  [
    "setResolvedPluginOptions",
    "getResolvedPluginOptions",
    "setResolvedProviderOptions",
    "getResolvedProviderOptions"
  ],
  "import type {AgentPlugin,Provider} from './plugin-types.js';"
);
seed("runtime/tool-names.d.ts", "tool-names", ["InvalidToolNameError", "assertValidToolName"], "");
const spawn = ts.createSourceFile(
  "spawn-types.d.ts",
  readFileSync(new URL("../agent-spawn-rust/src/types.d.ts", root), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
writeFileSync(
  new URL("src/spawn-types.d.ts", root),
  "export type SpawnMode='yolo'|'auto'|'edit'|'read';\n" +
    spawn.statements
      .filter((statement) => statement.name?.text === "McpSpawnServer")
      .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, spawn))
      .join("\n") +
    "\n"
);
writeFileSync(
  new URL("src/index.d.ts", root),
  "export {collectProviders,resolveProvider,DuplicateProviderNameError,ProviderResolutionError} from './providers.js';\nexport {InvalidToolNameError} from './tool-names.js';\nexport type {AgentPlugin,Provider,ProviderContext,ProviderStreamEvent} from './plugin-types.js';\nexport type {ChatMessage,Tool,ToolResult,ToolResultPart} from './types.js';\nexport {createAgentSessionStore} from './session-store.js';\nexport type {AgentSessionStore,PersistedAgentSession} from './session-store.js';\nexport {createMemorySessionStore,createJsonlSessionStore} from './session-log.js';\nexport type {SessionStore} from './session-log.js';\nexport type {SessionEntry} from './entry-types.js';\nexport {normalizeTool,ToolRegistry} from './tools.js';\nexport {DuplicateToolError,PluginSetupError,PromptTransformError} from './errors.js';\n"
);

seed(
  "session-store.d.ts",
  "session-store",
  ["SessionStoreFs", "PersistedAgentSession", "AgentSessionStore", "createAgentSessionStore"],
  "import type {ChatMessage} from './types.js';"
);

seed("runtime/session/entry-types.d.ts", "entry-types", ["SessionEntry"], "");
seed(
  "runtime/session/session-store.d.ts",
  "session-log",
  ["JsonlSessionStoreFs", "SessionStore", "createMemorySessionStore", "createJsonlSessionStore"],
  "import type {SessionEntry} from './entry-types.js';"
);

seed(
  "runtime/tools.d.ts",
  "tools",
  ["normalizeTool", "ToolRegistry"],
  "import type {NormalizedTool,Tool} from './types.js';"
);
seed(
  "runtime/errors.d.ts",
  "errors",
  ["DuplicateToolError", "PluginSetupError", "PromptTransformError"],
  ""
);
