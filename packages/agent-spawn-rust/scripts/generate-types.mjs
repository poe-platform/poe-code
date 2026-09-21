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
writeFileSync(new URL("src/index.d.ts", root), imports + index + "\n");
