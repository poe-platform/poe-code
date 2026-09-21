import ts from "typescript";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
const providers = path("../poe-agent/src/runtime/resolve-provider.test.ts"),
  names = path("../poe-agent/src/runtime/tool-names.test.ts");
export default defineConfig({
  plugins: [
    {
      name: "rust-agent-runtime-reference",
      enforce: "pre",
      transform(code, id) {
        if (id === path("../poe-agent/src/plugins/plugins.test.ts")) {
          const source = ts.createSourceFile(
            id,
            code,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          );
          const selected = new Set([
            "poe-agent-plugin-max-iterations",
            "poe-agent-plugin-scratchpad"
          ]);
          const filtered = ts.factory.updateSourceFile(
            source,
            source.statements.filter(
              (statement) =>
                !ts.isExpressionStatement(statement) ||
                !ts.isCallExpression(statement.expression) ||
                statement.expression.expression.getText(source) !== "describe" ||
                !ts.isStringLiteral(statement.expression.arguments[0]) ||
                selected.has(statement.expression.arguments[0].text)
            )
          );
          const output =
            ts.createPrinter().printFile(filtered) +
            `\nimport nativeScratch from ${JSON.stringify(path("dist/plugin-scratchpad.js"))};\nimport nativeMaximum from ${JSON.stringify(path("dist/plugin-max-iterations.js"))};\nif(scratchpad!==nativeScratch||maxIterations!==nativeMaximum)throw new Error("Built-in contracts must execute the Rust package");`;
          return { code: output, map: null };
        }
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-policy.test.ts")) {
          const source = ts.createSourceFile(
            id,
            code,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          );
          const transformed = ts.transform(source, [
            (context) => (root) =>
              ts.visitNode(root, function visit(node) {
                if (ts.isStringLiteral(node) && node.text === "tiny-mcp-client")
                  return ts.factory.createStringLiteral(path("dist/client/index.js"));
                return ts.visitEachChild(node, visit, context);
              })
          ]);
          try {
            const output =
              ts.createPrinter().printFile(transformed.transformed[0]) +
              `\nimport nativePolicy from ${JSON.stringify(path("dist/plugin-policy.js"))};\nif(policyPlugin!==nativePolicy)throw new Error("Policy contracts must execute the Rust package");`;
            return { code: output, map: null };
          } finally {
            transformed.dispose();
          }
        }
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-mcp.test.ts"))
          return {
            code:
              code +
              `\nimport nativeMcp from ${JSON.stringify(path("dist/plugin-mcp.js"))};\nif(mcpPlugin!==nativeMcp)throw new Error("MCP plugin contracts must execute the Rust package");`,
            map: null
          };
        if (id === path("../poe-agent/src/plugins/plugin-args.test.ts"))
          return {
            code:
              code +
              `\nimport {getOptionalNumber as nativeArgument} from ${JSON.stringify(path("dist/plugin-args.js"))};\nif(getOptionalNumber!==nativeArgument)throw new Error("Argument contracts must execute the Rust package");`,
            map: null
          };
        if (
          id === path("../poe-agent/src/runtime/plugin-api-impl.test.ts") ||
          id === path("../poe-agent/src/runtime/plugin-api-impl.in-memory.test.ts")
        ) {
          const source = ts.createSourceFile(
            id,
            code,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          );
          const transformed = ts.transform(source, [
            (context) => (root) =>
              ts.visitNode(root, function visit(node) {
                if (ts.isStringLiteral(node) && node.text === "tiny-mcp-client")
                  return ts.factory.createStringLiteral(path("dist/client/index.js"));
                return ts.visitEachChild(node, visit, context);
              })
          ]);
          try {
            let output = ts.createPrinter().printFile(transformed.transformed[0]);
            output += `\nimport {PluginApiImpl as nativePluginApiContract} from ${JSON.stringify(path("dist/plugin-api.js"))};\nif(PluginApiImpl!==nativePluginApiContract)throw new Error("Plugin API contracts must execute the Rust package");`;
            if (id === path("../poe-agent/src/runtime/plugin-api-impl.test.ts"))
              output += `\nimport {runPluginSetup as nativePluginSetupContract} from ${JSON.stringify(path("dist/plugin-setup.js"))};\nif(runPluginSetup!==nativePluginSetupContract)throw new Error("Plugin setup contracts must execute the Rust package");`;
            return { code: output, map: null };
          } finally {
            transformed.dispose();
          }
        }
        if (id !== path("../poe-agent/src/runtime/runtime.test.ts")) return;
        const source = ts.createSourceFile(
          id,
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        const selected = new Set([
          "runtime errors",
          "normalizeTool",
          "ToolRegistry",
          "runtime/config",
          "HookRegistry",
          "hook context factories",
          "applyHookDecision",
          "PromptRegistry",
          "RunContext",
          "runAcpCore",
          "AgentHost.handle",
          "AgentHost.fork",
          "AgentHost.spawn"
        ]);
        const ranges = source.statements
          .filter(
            (statement) =>
              ts.isExpressionStatement(statement) &&
              ts.isCallExpression(statement.expression) &&
              statement.expression.expression.getText(source) === "describe" &&
              ts.isStringLiteral(statement.expression.arguments[0]) &&
              !selected.has(statement.expression.arguments[0].text)
          )
          .map((statement) => [statement.getFullStart(), statement.end]);
        let output = code;
        for (const [start, end] of ranges.reverse())
          output =
            output.slice(0, start) +
            [...output.slice(start, end)].map((char) => (char === "\n" ? char : " ")).join("") +
            output.slice(end);
        const hostSource = ts.createSourceFile(
          id,
          output,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        const hostTransformed = ts.transform(hostSource, [
          (context) => (root) =>
            ts.visitNode(root, function visit(node) {
              if (
                ts.isImportDeclaration(node) &&
                ts.isStringLiteral(node.moduleSpecifier) &&
                node.moduleSpecifier.text === "./agent-host.js"
              ) {
                const items = node.importClause.namedBindings.elements;
                const ownItems = items.filter((item) => item.name.text === "AgentHost");
                const referenceItems = items.filter((item) => item.name.text !== "AgentHost");
                const declaration = (items, module) =>
                  ts.factory.createImportDeclaration(
                    undefined,
                    ts.factory.createImportClause(
                      false,
                      undefined,
                      ts.factory.createNamedImports(items)
                    ),
                    ts.factory.createStringLiteral(module)
                  );
                return [
                  declaration(ownItems, path("dist/agent-host.js")),
                  declaration(referenceItems, path("../poe-agent/dist/runtime/agent-host.js"))
                ];
              }
              return ts.visitEachChild(node, visit, context);
            })
        ]);
        try {
          output = ts.createPrinter().printFile(hostTransformed.transformed[0]);
        } finally {
          hostTransformed.dispose();
        }
        output += `\nimport {AgentHost as nativeHostContract} from ${JSON.stringify(path("dist/agent-host.js"))};\nif(AgentHost!==nativeHostContract)throw new Error("Host contracts must execute the Rust package");`;
        output += `\nimport {runAcpCore as nativeExecutionContract} from ${JSON.stringify(path("dist/acp-core.js"))};\nif(runAcpCore!==nativeExecutionContract)throw new Error("Execution contracts must execute the Rust package");`;
        return { code: output, map: null };
      },
      resolveId(name, importer) {
        if (
          [
            path("../poe-agent/src/plugins/plugins.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-policy.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-mcp.test.ts"),
            path("../poe-agent/src/plugins/plugin-args.test.ts")
          ].includes(importer)
        ) {
          const modules = new Map([
            ["./poe-agent-plugin-mcp.js", "plugin-mcp"],
            ["./poe-agent-plugin-policy.js", "plugin-policy"],
            ["./poe-agent-plugin-max-iterations.js", "plugin-max-iterations"],
            ["./poe-agent-plugin-scratchpad.js", "plugin-scratchpad"],
            ["./poe-agent-plugin-skills.js", "plugin-skills"],
            ["./poe-agent-plugin-spawn.js", "plugin-spawn"],
            ["./plugin-args.js", "plugin-args"],
            ["../runtime/hooks.js", "hooks"],
            ["../runtime/run-context.js", "run-context"],
            ["../runtime/acp-core.js", "acp-core"],
            ["../runtime/plugin-setup.js", "plugin-setup"]
          ]);
          if (modules.has(name)) return path("dist/" + modules.get(name) + ".js");
        }
        if (
          importer === path("../poe-agent/src/runtime/plugin-api-impl.test.ts") ||
          importer === path("../poe-agent/src/runtime/plugin-api-impl.in-memory.test.ts")
        ) {
          if (name === "./plugin-api-impl.js") return path("dist/plugin-api.js");
          if (name === "./plugin-setup.js") return path("dist/plugin-setup.js");
          if (name === "./errors.js") return path("dist/errors.js");
          if (name === "./hooks.js") return path("dist/hooks.js");
          if (name === "./run-context.js") return path("dist/run-context.js");
          if (name === "./tool-names.js") return path("dist/tool-names.js");
        }
        if (importer === path("../poe-agent/src/runtime/runtime.test.ts")) {
          if (name === "./acp-core.js") return path("dist/acp-core.js");
          if (name === "./run-context.js") return path("dist/run-context.js");
          if (name === "./prompts.js") return path("dist/prompts.js");
          if (name === "./hooks.js") return path("dist/hooks.js");
          if (name === "./config.js") return path("dist/config.js");
          if (name === "./tools.js") return path("dist/tools.js");
          if (name === "./errors.js") return path("dist/errors.js");
          if (name === "./tool-names.js") return path("dist/tool-names.js");
        }
        if (
          importer === path("../poe-agent/src/runtime/transcript.test.ts") &&
          name === "./transcript.js"
        )
          return path("dist/transcript.js");
        if (
          importer === path("../poe-agent/src/runtime/file-awareness.test.ts") &&
          name === "./file-awareness.js"
        )
          return path("dist/file-awareness.js");
        if (
          importer === path("../poe-agent/src/runtime/session/session-tree.test.ts") &&
          name === "./session-tree.js"
        )
          return path("dist/session-tree.js");
        if (importer === providers && name === "./resolve-provider.js")
          return path("dist/providers.js");
        if (
          importer === path("../poe-agent/src/session-store.test.ts") &&
          name === "./session-store.js"
        )
          return path("dist/session-store.js");
        if (
          importer === path("../poe-agent/src/runtime/session/session-store.test.ts") &&
          name === "./session-store.js"
        )
          return path("dist/session-log.js");
        if (importer === names && name === "./tool-names.js") return path("dist/tool-names.js");
      }
    }
  ],
  test: {
    include: [
      path("../poe-agent/src/plugins/plugins.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-policy.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-mcp.test.ts"),
      path("../poe-agent/src/plugins/plugin-args.test.ts"),
      path("../poe-agent/src/runtime/plugin-api-impl.test.ts"),
      path("../poe-agent/src/runtime/plugin-api-impl.in-memory.test.ts"),
      providers,
      path("../poe-agent/src/runtime/transcript.test.ts"),
      path("../poe-agent/src/runtime/session/session-tree.test.ts"),
      path("../poe-agent/src/runtime/file-awareness.test.ts"),
      names,
      path("../poe-agent/src/session-store.test.ts"),
      path("../poe-agent/src/runtime/session/session-store.test.ts"),
      path("../poe-agent/src/runtime/runtime.test.ts")
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
