// Manual development contract seed. Original runtime implementations are never copied.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
function declarations(file, names) {
  const ast = ts.createSourceFile(
      file,
      readFileSync(new URL("../agent-spawn/dist/" + file, root), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    ),
    printer = ts.createPrinter();
  return ast.statements
    .filter((statement) => {
      if (ts.isImportDeclaration(statement)) return false;
      if (ts.isVariableStatement(statement))
        return statement.declarationList.declarations.some((d) =>
          names.includes(d.name.getText(ast))
        );
      return statement.name && names.includes(statement.name.text);
    })
    .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, ast))
    .join("\n");
}
const types = declarations("types.d.ts", [
  "SPAWN_MODES",
  "DEFAULT_SPAWN_MODE",
  "SpawnMode",
  "SpawnModeConfig",
  "SpawnModesConfig",
  "resolveModeConfig",
  "resolveAgentModeConfig",
  "McpSpawnServer",
  "McpSpawnConfig",
  "McpFileSpec",
  "StdinMode",
  "InteractiveSpawnConfig",
  "CliSpawnConfig",
  "ResumeSpec",
  "FileSpawnConfig",
  "AcpSpawnConfig",
  "SpawnConfig"
]);
writeFileSync(
  new URL("src/types.d.ts", root),
  "export type AdapterType='codex'|'claude'|'cursor'|'native'|'opencode'|'pi';\n" + types + "\n"
);
const imports =
  "import type {SpawnConfig,AcpSpawnConfig,CliSpawnConfig,SpawnMode,McpSpawnConfig} from './types.js';\nexport * from './types.js';\n";
const index =
  declarations("configs/index.d.ts", [
    "SpawnableAgent",
    "allSpawnConfigs",
    "getSpawnConfig",
    "getAcpSpawnConfig",
    "supportsSpawnMode",
    "supportsMcpAtSpawn",
    "listMcpSupportedAgents",
    "listSpawnableAgents",
    "resolveSpawnableAgent"
  ]) +
  "\n" +
  declarations("spawn.d.ts", ["BuildSpawnArgsOptions", "BuildSpawnArgsResult", "buildSpawnArgs"]) +
  "\n" +
  declarations("environment.d.ts", ["SpawnEnvironment", "mergeSpawnEnvironment"]) +
  "\n" +
  declarations("configs/mcp.d.ts", [
    "toJsonMcpServers",
    "JsonMcpServer",
    "serializeGooseMcpArgs",
    "serializeOpenCodeMcpEnv",
    "serializeCodexMcpArgs",
    "serializeJsonMcpArgs"
  ]) +
  "\n" +
  declarations("configs/resolve-config.d.ts", ["ResolvedSpawnConfig", "resolveConfig"]);
writeFileSync(
  new URL("src/index.d.ts", root),
  imports +
    index +
    "\nexport {createSpawnRetry,calculateBackoffMs,defaultIsRetryable} from './retry.js';\nexport type {SpawnRetryOptions,SpawnHandle,SpawnRetryFunction} from './retry.js';\n"
);

writeFileSync(
  new URL("src/retry.d.ts", root),
  "import type {AcpEvent} from './acp-types.js';\n" +
    declarations("retry.d.ts", [
      "SpawnRetryOptions",
      "SpawnHandle",
      "SpawnRetryFunction",
      "createSpawnRetry",
      "defaultIsRetryable",
      "calculateBackoffMs"
    ]) +
    "\n"
);
const acpSource = ts.createSourceFile(
  "acp/types.d.ts",
  readFileSync(new URL("../agent-spawn/dist/acp/types.d.ts", root), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const acpPrinter = ts.createPrinter();
const acpStatements = acpSource.statements.map((statement) => {
  if (!ts.isImportDeclaration(statement)) return statement;
  if (statement.moduleSpecifier.text !== "@poe-code/poe-acp-client")
    throw new Error("Unexpected ACP declaration dependency");
  return ts.factory.updateImportDeclaration(
    statement,
    statement.modifiers,
    statement.importClause,
    ts.factory.createStringLiteral("./acp-protocol-types.js"),
    statement.attributes
  );
});
writeFileSync(
  new URL("src/acp-types.d.ts", root),
  acpStatements
    .map((statement) => acpPrinter.printNode(ts.EmitHint.Unspecified, statement, acpSource))
    .join("\n") + "\n"
);
writeFileSync(
  new URL("src/acp-protocol-types.d.ts", root),
  readFileSync(new URL("../../poe-acp-client-rust/src/types.d.ts", import.meta.url), "utf8")
);
