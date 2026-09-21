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
        if (
          ["agent.test.ts", "agent-session.test.ts", "agent.mcp-spawn.test.ts"].some(
            (name) => id === path("../poe-agent/src/" + name)
          )
        ) {
          const replacements = new Map([
            ["./agent.js", "agent"],
            ["./agent-session.js", "agent-session"],
            ["./index.js", "index"],
            ["./runtime/agent-host.js", "agent-host"],
            ["./plugins/poe-agent-plugin-spawn.js", "plugin-spawn"],
            ["./plugins/poe-agent-plugin-max-iterations.js", "plugin-max-iterations"],
            ["./plugins/poe-agent-plugin-files.js", "plugin-files"],
            ["./plugins/poe-agent-plugin-shell.js", "plugin-shell"],
            ["./plugins/poe-agent-plugin-web.js", "plugin-web"],
            ["./plugins/poe-agent-plugin-system-prompt.js", "plugin-system-prompt"],
            ["./plugins/poe-agent-plugin-policy.js", "plugin-policy"],
            ["./plugins/poe-agent-plugin-openai-responses.js", "plugin-openai-responses"],
            [
              "./plugins/poe-agent-plugin-openai-chat-completions.js",
              "plugin-openai-chat-completions"
            ],
            ["./plugins/resolve-plugins.js", "resolve-plugins"],
            ["./runtime/resolve-provider.js", "providers"],
            ["./runtime/tool-names.js", "tool-names"],
            ["./runtime/file-awareness.js", "file-awareness"],
            ["./runtime/acp-core.js", "acp-core"],
            ["./system-prompt.js", "system-prompt"],
            ["tiny-mcp-client", "client/index"]
          ]);
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
                if (ts.isStringLiteral(node) && replacements.has(node.text))
                  return ts.factory.createStringLiteral(
                    path("dist/" + replacements.get(node.text) + ".js")
                  );
                return ts.visitEachChild(node, visit, context);
              })
          ]);
          try {
            const name = id.endsWith("agent-session.test.ts") ? "createAgentSession" : "agent";
            const module = name === "agent" ? "agent" : "agent-session";
            const guard =
              "\nimport {" +
              name +
              " as ownAgentContract} from " +
              JSON.stringify(path("dist/" + module + ".js")) +
              (name === "agent"
                ? '; if(agent!==ownAgentContract)throw new Error("Agent contracts must execute own module");'
                : '; if(typeof ownAgentContract!=="function")throw new Error("Session contracts require own module");');
            return {
              code: ts.createPrinter().printFile(transformed.transformed[0]) + guard,
              map: null
            };
          } finally {
            transformed.dispose();
          }
        }
        if (
          [
            "poe-agent-plugin-openai-chat-completions.test.ts",
            "poe-agent-plugin-openai-responses.test.ts",
            "openai-auth.test.ts"
          ].some((name) => id === path("../poe-agent/src/plugins/" + name))
        ) {
          const replacements = new Map([
            ["auth-store", "openai-auth-store"],
            ["openai", "openai-transport"],
            ["./openai-auth.js", "openai-auth"],
            ["./poe-agent-plugin-openai-responses.js", "plugin-openai-responses"],
            ["./poe-agent-plugin-openai-chat-completions.js", "plugin-openai-chat-completions"]
          ]);
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
                if (ts.isStringLiteral(node) && replacements.has(node.text))
                  return ts.factory.createStringLiteral(
                    path("dist/" + replacements.get(node.text) + ".js")
                  );
                return ts.visitEachChild(node, visit, context);
              })
          ]);
          try {
            const guard = id.endsWith("openai-auth.test.ts")
              ? `import {resolveOpenaiApiKey as ownAuthContract} from ${JSON.stringify(path("dist/openai-auth.js"))}; if(resolveOpenaiApiKey!==ownAuthContract)throw new Error("Auth contracts must execute own module");`
              : id.endsWith("poe-agent-plugin-openai-responses.test.ts")
                ? `import {openaiResponsesPlugin as ownResponsesContract} from ${JSON.stringify(path("dist/plugin-openai-responses.js"))}; if(openaiResponsesPlugin!==ownResponsesContract)throw new Error("Responses contracts must execute own module");`
                : `import {openaiChatCompletionsPlugin as ownChatContract} from ${JSON.stringify(path("dist/plugin-openai-chat-completions.js"))}; if(openaiChatCompletionsPlugin!==ownChatContract)throw new Error("Chat contracts must execute own module");`;
            return {
              code: ts.createPrinter().printFile(transformed.transformed[0]) + "\n" + guard,
              map: null
            };
          } finally {
            transformed.dispose();
          }
        }
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-files.test.ts")) {
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
                if (ts.isStringLiteral(node) && node.text === "./poe-agent-plugin-files.js")
                  return ts.factory.createStringLiteral(path("dist/plugin-files.js"));
                return ts.visitEachChild(node, visit, context);
              })
          ]);
          try {
            return { code: ts.createPrinter().printFile(transformed.transformed[0]), map: null };
          } finally {
            transformed.dispose();
          }
        }
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
            "poe-agent-plugin-scratchpad",
            "poe-agent-plugin-audit-log",
            "poe-agent-plugin-system-prompt",
            "poe-agent-plugin-environment",
            "poe-agent-plugin-git-context"
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
            ts
              .createPrinter()
              .printFile(filtered)
              .replace(
                'vi.mock("@poe-code/agent-spawn"',
                "vi.mock(" + JSON.stringify(path("dist/spawn-run-command.js"))
              ) +
            `\nimport nativeScratch from ${JSON.stringify(path("dist/plugin-scratchpad.js"))};\nimport nativeMaximum from ${JSON.stringify(path("dist/plugin-max-iterations.js"))};\nif(scratchpad!==nativeScratch||maxIterations!==nativeMaximum)throw new Error("Built-in contracts must execute the Rust package");\nimport nativeAudit from ${JSON.stringify(path("dist/plugin-audit-log.js"))};\nimport nativeEnvironment from ${JSON.stringify(path("dist/plugin-environment.js"))};\nimport nativeSystemPrompt from ${JSON.stringify(path("dist/plugin-system-prompt.js"))};\nif(auditLog!==nativeAudit||environment!==nativeEnvironment||systemPromptPlugin!==nativeSystemPrompt)throw new Error("Context contracts must execute the Rust package");`;
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
          [
            path("../poe-agent/src/index.test.ts"),
            path("../poe-agent/src/plugins/registry.test.ts"),
            path("../poe-agent/src/plugins/resolve-plugins.test.ts")
          ].includes(id)
        )
          return {
            code:
              code +
              `\nimport {resolvePluginsFromConfig as ownResolve} from ${JSON.stringify(path("dist/resolve-plugins.js"))}; if(resolvePluginsFromConfig!==ownResolve)throw new Error("Plugin config contracts must execute own module");`,
            map: null
          };
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-web.test.ts"))
          return {
            code:
              code +
              `\nimport ownWeb from ${JSON.stringify(path("dist/plugin-web.js"))}; if(webPlugin!==ownWeb)throw new Error("Web contracts must execute own module");`,
            map: null
          };
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-shell.test.ts"))
          return {
            code:
              code +
              `\nimport ownShell from ${JSON.stringify(path("dist/plugin-shell.js"))}; if(shellPlugin!==ownShell)throw new Error("Shell contracts must execute own module");`,
            map: null
          };
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-memory.test.ts"))
          return {
            code:
              code +
              `\nimport nativeMemory from ${JSON.stringify(path("dist/plugin-memory.js"))};\nif(memoryPlugin!==nativeMemory)throw new Error("Memory contracts must execute the Rust package");`,
            map: null
          };
        if (id === path("../poe-agent/src/plugins/poe-agent-plugin-compaction.test.ts"))
          return {
            code:
              code +
              `\nimport nativeCompaction from ${JSON.stringify(path("dist/plugin-compaction.js"))};\nif(compactionPlugin!==nativeCompaction)throw new Error("Compaction contracts must execute the Rust package");`,
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
                  declaration(referenceItems, path("dist/agent-host.js"))
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
            path("../poe-agent/src/index.test.ts"),
            path("../poe-agent/src/plugins/registry.test.ts"),
            path("../poe-agent/src/plugins/resolve-plugins.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-web.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-shell.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-files.test.ts"),
            path("../poe-agent/src/plugins/plugins.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-policy.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-mcp.test.ts"),
            path("../poe-agent/src/plugins/plugin-args.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-memory.test.ts"),
            path("../poe-agent/src/plugins/poe-agent-plugin-compaction.test.ts")
          ].includes(importer)
        ) {
          const modules = new Map([
            ["./index.js", "index"],
            ["./registry.js", "plugin-registry"],
            ["./poe-agent-plugin-openai-responses.js", "plugin-openai-responses"],
            ["./poe-agent-plugin-openai-chat-completions.js", "plugin-openai-chat-completions"],
            ["./poe-agent-plugin-git-context.js", "plugin-git-context"],
            ["./plugins/poe-agent-plugin-git-context.js", "plugin-git-context"],
            ["./runtime/transcript.js", "transcript"],
            ["./runtime/resolve-provider.js", "providers"],
            ["./runtime/tool-names.js", "tool-names"],
            ["./resolve-plugins.js", "resolve-plugins"],
            ["../runtime/provider-metadata.js", "provider-metadata"],
            ["./poe-agent-plugin-web.js", "plugin-web"],
            ["./poe-agent-plugin-shell.js", "plugin-shell"],
            ["./poe-agent-plugin-files.js", "plugin-files"],
            ["./poe-agent-plugin-mcp.js", "plugin-mcp"],
            ["./poe-agent-plugin-policy.js", "plugin-policy"],
            ["./poe-agent-plugin-max-iterations.js", "plugin-max-iterations"],
            ["./poe-agent-plugin-scratchpad.js", "plugin-scratchpad"],
            ["./poe-agent-plugin-skills.js", "plugin-skills"],
            ["./poe-agent-plugin-spawn.js", "plugin-spawn"],
            ["./plugin-args.js", "plugin-args"],
            ["./poe-agent-plugin-memory.js", "plugin-memory"],
            ["./poe-agent-plugin-compaction.js", "plugin-compaction"],
            ["./poe-agent-plugin-system-prompt.js", "plugin-system-prompt"],
            ["./poe-agent-plugin-environment.js", "plugin-environment"],
            ["./poe-agent-plugin-audit-log.js", "plugin-audit-log"],
            ["../system-prompt.js", "system-prompt"],
            ["../runtime/hooks.js", "hooks"],
            ["../runtime/run-context.js", "run-context"],
            ["../runtime/acp-core.js", "acp-core"],
            ["../runtime/plugin-setup.js", "plugin-setup"]
          ]);
          const normalized = name.startsWith("./plugins/")
            ? "./" + name.slice("./plugins/".length)
            : name;
          if (modules.has(normalized)) return path("dist/" + modules.get(normalized) + ".js");
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
      path("../poe-agent/src/index.test.ts"),
      path("../poe-agent/src/agent.test.ts"),
      path("../poe-agent/src/agent-session.test.ts"),
      path("../poe-agent/src/agent.mcp-spawn.test.ts"),
      path("../poe-agent/src/plugins/registry.test.ts"),
      path("../poe-agent/src/plugins/resolve-plugins.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-web.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-shell.test.ts"),
      path("../poe-agent/src/plugins/openai-auth.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-files.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-memory.test.ts"),
      path("../poe-agent/src/plugins/poe-agent-plugin-compaction.test.ts"),
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
