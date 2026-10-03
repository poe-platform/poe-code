import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdirSync } from "node:fs";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));
const suites = ["stack-trim", "suggest", "runtime-logging", "redaction", "package-metadata", "source-snippet"];
// The original bundle suite invokes esbuild against source paths independently
// of Vitest resolution. Native packaging is qualified separately.
const cliSuites = readdirSync(path("../toolcraft/src")).filter(name => name.startsWith("cli") && name.endsWith(".test.ts") && name !== "cli-bundle.test.ts");
const mcpSuites = ["mcp-default-descriptors", "mcp-default-metadata", "mcp-default-requiredness", "mcp-discriminator-metadata", "mcp-modern-output-roots", "mcp-notification-lifecycle", "mcp-output-validation", "mcp-request-cancellation", "mcp-runtime-options", "mcp-scope", "mcp-stream-errors", "mcp-proxy-native-transport", "entrypoints-mcp-proxy"];

export default defineConfig({
  plugins: [
    {
      name: "toolcraft-rust-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (mcpSuites.some(suite => importer === path(`../toolcraft/src/${suite}.test.ts`))) {
          if (name === "./mcp.js") return path("dist/mcp.js");
          if (name === "./index.js") return path("tests/definition-entry.mjs");
          if (name === "tiny-stdio-mcp-server") return path("../tiny-stdio-mcp-server-rust/dist/index.js");
          if (name === "tiny-mcp-client") return path("../tiny-mcp-client-rust/dist/index.js");
          if (name === "./cli.js") return path("dist/cli.js");
          if (name === "toolcraft-design") return path("../toolcraft-design-rust/dist/index.js");
        }
        if (importer === path("../toolcraft/src/human-in-loop/mcp-runtime.integration.test.ts")) {
          if (name === "../mcp.js") return path("dist/mcp.js");
          if (name === "../index.js") return path("tests/definition-entry.mjs");
          if (name === "tiny-mcp-client") return path("../tiny-mcp-client-rust/dist/index.js");
        }
        if (importer === path("../toolcraft/src/human-in-loop/cli-runtime.integration.test.ts")) {
          if (name === "../cli.js") return path("dist/cli.js");
          if (name === "../index.js") return path("tests/definition-entry.mjs");
          if (name === "toolcraft-design") return path("../toolcraft-design-rust/dist/index.js");
        }
        if (cliSuites.some(suite => importer === path(`../toolcraft/src/${suite}`))) {
          if (name === "./cli.js") return path("dist/cli.js");
          if (name === "./index.js") return path("tests/definition-entry.mjs");
          if (name === "toolcraft-design") return path("../toolcraft-design-rust/dist/index.js");
        }
        if (importer === path("../toolcraft/src/design-subpath-exports.test.ts") && name === "./design.js") return path("dist/design.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && name.startsWith(".")) {
          const resolved = resolve(dirname(importer), name);
          if (resolved === path("../toolcraft/src/file-change-renderer.js")) return path("dist/file-changes.js");
          if (resolved === path("../toolcraft/src/runtime/io.js")) return path("dist/runtime-io.js");
          if (resolved === path("../toolcraft/src/human-in-loop/wiring.js")) return path("dist/approval-wiring.js");
          if (resolved === path("../toolcraft/src/api-error-summary.js")) return path("dist/api-error-summary.js");
          if (resolved === path("../toolcraft/src/error-report.js")) return path("dist/error-report.js");
          if (resolved === path("../toolcraft/src/project-root.js")) return path("dist/project-root.js");
          if (resolved === path("../toolcraft/src/json-schema-converter.js")) return path("dist/json-schema-converter.js");
          if (resolved === path("../toolcraft/src/mcp-proxy.js")) return path("dist/mcp-proxy.js");
          if (resolved === path("../toolcraft/src/sdk.js")) return path("dist/sdk.js");
          if (resolved === path("../toolcraft/src/renderer.js")) return path("dist/renderer.js");
          if (resolved === path("../toolcraft/src/human-in-loop/plan-hash.js")) return path("dist/approval-plan.js");
          if (resolved === path("../toolcraft/src/human-in-loop/approval-tasks.js")) return path("dist/approval-tasks.js");
          if (resolved === path("../toolcraft/src/human-in-loop/state-machine.js")) return path("dist/approval-state-machine.js");
          if (resolved === path("../toolcraft/src/human-in-loop/gate.js")) return path("dist/approval-gate.js");
          if (resolved === path("../toolcraft/src/human-in-loop/runner.js")) return path("dist/approval-runner.js");
          if (resolved === path("../toolcraft/src/human-in-loop/approvals-commands.js")) return path("dist/approval-commands.js");
          if (resolved === path("../toolcraft/src/human-in-loop/runtime.js")) return path("dist/approval-runtime.js");
          if (resolved === path("../toolcraft/src/human-in-loop/index.js")) return path("dist/human-in-loop.js");
          if (resolved === path("../toolcraft/src/human-in-loop/default-provider.js")) return path("dist/approval-default-provider.js");
          if (resolved === path("../toolcraft/src/human-in-loop/spawn.js")) return path("dist/approval-spawn.js");
          if (resolved === path("../toolcraft/src/human-in-loop/types.js")) return path("dist/approval-error.js");
        }
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "toolcraft-schema")
          return path("../toolcraft-schema-rust/dist/index.js");
        if (importer?.startsWith(path("../toolcraft/src/human-in-loop/")) && name === "@poe-code/task-list")
          return path("../task-list-rust/dist/index.js");
        if (importer?.startsWith(path("../toolcraft/src/human-in-loop/")) && name === "@poe-code/agent-human-in-loop")
          return path("../agent-human-in-loop-rust/dist/index.js");
        if (importer === path("../toolcraft/src/mcp-proxy.test.ts")) {
          if (name === "tiny-mcp-client") return path("../tiny-mcp-client-rust/dist/index.js");
          if (name === "toolcraft-design") return path("../toolcraft-design-rust/dist/index.js");
        }
        if (
          ["renderer", "clone-command-node", "toolcraft", "mcp-result", "stream", "stream-lifecycle", "schema-scope-exhausted", "schema-member-collisions", "discriminator-validation", "union-validation", "applied-default-validation", "error-report", "sdk-validation", "sdk-runtime-options"].some(
            (suite) => importer === path(`../toolcraft/src/${suite}.test.ts`)
          ) &&
          name === "./index.js"
        )
          return path("tests/definition-entry.mjs");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./stream.js")
          return path("dist/stream.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./schema-scope.js")
          return path("dist/schema-scope.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./schema-member-names.js")
          return path("dist/schema-member-names.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && ["./discriminator.js", "./union-validation.js", "./applied-default.js"].includes(name))
          return path(`dist/${name.slice(2)}`);
        if (
          suites.some(
            (suite) =>
              importer === path(`../toolcraft/src/${suite}.test.ts`) && name === `./${suite}.js`
          )
        )
          return ["./stack-trim.js", "./package-metadata.js", "./source-snippet.js"].includes(name)
            ? path(`dist/${name.slice(2)}`)
            : path("dist/index.js");
      }
    }
  ],
  test: {
    include: [
      ...cliSuites.map(suite => path(`../toolcraft/src/${suite}`)),
      path("../toolcraft/src/renderer.test.ts"),
      path("../toolcraft/src/design-subpath-exports.test.ts"),
      path("../toolcraft/src/file-change-renderer.test.ts"),
      path("tests/package-metadata-parity.test.ts"),
      path("tests/mcp-result-parity.test.ts"),
      path("tests/mcp-metadata-parity.test.ts"),
      path("tests/mcp-validation-parity.test.ts"),
      path("tests/mcp-output-parity.test.ts"),
      path("tests/mcp-schema-parity.test.ts"),
      path("tests/mcp-tools-parity.test.ts"),
      path("tests/mcp-errors-parity.test.ts"),
      path("tests/mcp-handler-parity.test.ts"),
      path("tests/mcp-public-parity.test.ts"),
      path("tests/mcp-deferred-parity.test.ts"),
      path("tests/hosted-oauth-config-parity.test.ts"),
      path("tests/hosted-oauth-storage-parity.test.ts"),
      ...mcpSuites.map(suite => path(`../toolcraft/src/${suite}.test.ts`)),
      path("tests/source-snippet-parity.test.ts"),
      path("tests/runtime-io-parity.test.ts"),
      path("tests/error-report-parity.test.ts"),
      path("tests/json-schema-converter-parity.test.ts"),
      path("tests/mcp-proxy-parity.test.ts"),
      path("tests/sdk-parity.test.ts"),
      path("tests/approval-tasks-parity.test.ts"),
      path("tests/cli-prompts-parity.test.ts"),
      path("tests/cli-variants-parity.test.ts"),
      path("tests/cli-presets-parity.test.ts"),
      path("tests/cli-params-parity.test.ts"),
      path("tests/cli-fixtures-parity.test.ts"),
      path("tests/cli-execution-parity.test.ts"),
      path("tests/cli-generated-help-parity.test.ts"),
      path("tests/cli-public-parity.test.ts"),
      path("tests/cli-proxy-parity.test.ts"),
      path("tests/cli-errors-parity.test.ts"),
      path("../toolcraft/src/human-in-loop/sdk-runtime.integration.test.ts"),
      path("../toolcraft/src/human-in-loop/cli-runtime.integration.test.ts"),
      path("../toolcraft/src/human-in-loop/mcp-runtime.integration.test.ts"),
      path("../toolcraft/src/human-in-loop/plan-hash.test.ts"),
      path("../toolcraft/src/human-in-loop/approval-tasks.test.ts"),
      path("../toolcraft/src/human-in-loop/state-machine.test.ts"),
      path("../toolcraft/src/human-in-loop/gate.test.ts"),
      path("../toolcraft/src/human-in-loop/runner.test.ts"),
      path("../toolcraft/src/human-in-loop/approvals-commands.test.ts"),
      path("../toolcraft/src/human-in-loop/default-provider.test.ts"),
      path("../toolcraft/src/human-in-loop/spawn.test.ts"),
      path("../toolcraft/src/runtime/io.test.ts"),
      path("../toolcraft/src/api-error-summary.test.ts"),
      path("../toolcraft/src/error-report.test.ts"),
      path("../toolcraft/src/json-schema-converter.test.ts"),
      path("../toolcraft/src/mcp-proxy.test.ts"),
      ...[...suites, "clone-command-node", "toolcraft", "mcp-result", "stream", "stream-lifecycle", "schema-scope", "schema-scope-exhausted", "schema-member-collisions", "discriminator-validation", "union-validation", "applied-default-validation", "sdk-validation", "sdk-runtime-options"].map((suite) =>
        path(`../toolcraft/src/${suite}.test.ts`)
      )
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
