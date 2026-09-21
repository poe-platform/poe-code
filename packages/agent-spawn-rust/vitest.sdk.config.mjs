import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
const args = path("../agent-spawn/src/agent-spawn.test.ts"),
  configs = path("../agent-spawn/src/configs/configs.test.ts"),
  types = path("../agent-spawn/src/types.test.ts");
export default defineConfig({
  plugins: [
    {
      name: "rust-spawn-planning-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (
          importer === path("../agent-spawn/src/native-otel.test.ts") &&
          name === "./native-otel.js"
        )
          return path("dist/native-otel.js");
        if (importer === path("../agent-spawn/src/retry.test.ts") && name === "./retry.js")
          return path("dist/retry.js");
        if (importer === path("../agent-spawn/src/parallel.test.ts")) {
          if (name === "./parallel.js") return path("dist/parallel.js");
          if (name === "./spawn.js") return path("tests/parallel-spawn.mjs");
        }
        if (
          [
            path("../agent-spawn/src/run-command.test.ts"),
            path("../agent-spawn/src/run-command.integration.test.ts"),
            path("../agent-spawn/src/adapters/adapters.test.ts"),
            path("../agent-spawn/src/adapters/action-presentation.test.ts"),
            path("../agent-spawn/src/acp/acp.test.ts"),
            path("../agent-spawn/src/acp/session-update-converter.test.ts")
          ].includes(importer) &&
          name === "./run-command.js"
        )
          return path("dist/run-command.js");
        if (
          [
            path("../agent-spawn/src/adapters/adapters.test.ts"),
            path("../agent-spawn/src/adapters/action-presentation.test.ts"),
            path("../agent-spawn/src/acp/acp.test.ts"),
            path("../agent-spawn/src/acp/session-update-converter.test.ts")
          ].includes(importer)
        ) {
          if (
            [
              "./claude.js",
              "./codex.js",
              "./native.js",
              "./cursor.js",
              "./opencode.js",
              "./pi.js",
              "./index.js"
            ].includes(name)
          )
            return path("dist/adapters.js");
          if (name === "./utils.js") return path("dist/adapter-utils.js");
        }
        if (
          importer === path("../agent-spawn/src/acp/acp.test.ts") &&
          ["./line-reader.js", "./middleware.js"].includes(name)
        )
          return path("dist/stream.js");
        if (
          importer === path("../agent-spawn/src/acp/session-update-converter.test.ts") &&
          name === "./session-update-converter.js"
        )
          return path("dist/render.js");
        if (
          importer === path("../agent-spawn/src/configs/mcp-file.test.ts") &&
          name === "./mcp-file.js"
        )
          return path("dist/mcp-file.js");
        if (importer === types && name === "./types.js") return path("dist/types.js");
        if (importer === configs) {
          if (["./index.js", "./mcp.js", "./resolve-config.js", "../types.js"].includes(name))
            return path("dist/index.js");
          if (name.startsWith("./")) return path("dist/configs/" + name.slice(2));
        }
        if (importer === args) {
          if (name === "@poe-code/agent-spawn") return path("dist/index.js");
          if (name === "@poe-code/agent-skill-config") return path("dist/skills/index.js");
          if (name === "@poe-code/agent-hook-config") return path("dist/hooks/index.js");
          if (name === "toolcraft-design") return path("dist/design/index.js");

          if (["./index.js", "./spawn.js", "./types.js"].includes(name))
            return path("dist/index.js");
          if (name === "./mcp-args.js") return path("dist/mcp-args.js");
          if (name === "./model-utils.js") return path("dist/model-utils.js");
          if (name === "./configs/mcp-file.js") return path("dist/mcp-file.js");
          if (name.startsWith("./configs/"))
            return path("dist/configs/" + name.slice("./configs/".length));
        }
      },
      transform(code, id) {
        const acp = path("../agent-spawn/src/acp/acp.test.ts");
        if (id !== args && id !== acp) return;
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const transformed = ts.transform(ast, [
          (context) => (node) => {
            const visit = (current) => {
              if (
                ts.isExpressionStatement(current) &&
                ts.isCallExpression(current.expression) &&
                ts.isIdentifier(current.expression.expression) &&
                current.expression.expression.text === "describe"
              ) {
                const title = current.expression.arguments[0];
                if (
                  ts.isStringLiteral(title) &&
                  !(
                    id === args
                      ? ["buildSpawnArgs", "stripModelNamespace", "spawn"]
                      : ["acp/readLines", "acp/applyMiddlewares"]
                  ).includes(title.text)
                )
                  return undefined;
              }
              if (
                id === args &&
                ts.isReturnStatement(current) &&
                ts.isIdentifier(current.expression) &&
                current.expression.text === "child"
              ) {
                const unref = ts.factory.createExpressionStatement(
                  ts.factory.createBinaryExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("child"),
                      "unref"
                    ),
                    ts.factory.createToken(ts.SyntaxKind.EqualsToken),
                    ts.factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      undefined,
                      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      ts.factory.createBlock([], false)
                    )
                  )
                );
                return [unref, current];
              }
              if (
                id === args &&
                ts.isExpressionStatement(current) &&
                ts.isCallExpression(current.expression)
              ) {
                const call = current.expression;
                if (
                  ts.isIdentifier(call.expression) &&
                  call.expression.text === "it" &&
                  ts.isStringLiteral(call.arguments[0]) &&
                  call.arguments[0].text.startsWith("spawn.retry")
                )
                  return undefined;
                // The production host factory observes cancellation before starting a child.
                // Wait for its async open/upload boundary before exercising active-child kill.
                if (
                  ts.isPropertyAccessExpression(call.expression) &&
                  call.expression.name.text === "abort" &&
                  call.arguments.length === 0
                ) {
                  const wait = ts.factory.createExpressionStatement(
                    ts.factory.createAwaitExpression(
                      ts.factory.createNewExpression(
                        ts.factory.createIdentifier("Promise"),
                        undefined,
                        [
                          ts.factory.createArrowFunction(
                            undefined,
                            undefined,
                            [
                              ts.factory.createParameterDeclaration(undefined, undefined, "resolve")
                            ],
                            undefined,
                            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                            ts.factory.createCallExpression(
                              ts.factory.createIdentifier("setImmediate"),
                              undefined,
                              [ts.factory.createIdentifier("resolve")]
                            )
                          )
                        ]
                      )
                    )
                  );
                  return [wait, current];
                }
              }
              return ts.visitEachChild(current, visit, context);
            };
            return ts.visitNode(node, visit);
          }
        ]);
        const result = ts.createPrinter().printFile(transformed.transformed[0]);
        transformed.dispose();
        return result;
      }
    }
  ],
  test: {
    include: [
      args,
      path("../agent-spawn/src/configs/mcp-file.test.ts"),
      configs,
      types,
      path("../agent-spawn/src/native-otel.test.ts"),
      path("../agent-spawn/src/retry.test.ts"),
      path("../agent-spawn/src/parallel.test.ts"),
      path("../agent-spawn/src/run-command.test.ts"),
      path("../agent-spawn/src/run-command.integration.test.ts"),
      path("../agent-spawn/src/adapters/adapters.test.ts"),
      path("../agent-spawn/src/adapters/action-presentation.test.ts"),
      path("../agent-spawn/src/acp/acp.test.ts"),
      path("../agent-spawn/src/acp/session-update-converter.test.ts")
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
