import { describe, expect, it, vi } from "vitest";

import * as api from "./index.js";
import { dump } from "./dump.js";
import { extractBlock } from "./loader/extract-block.js";
import { splitFrontmatter } from "./loader/frontmatter.js";
import { formatInterpreterError } from "./error/format.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./interp/values.js";
import { lint } from "./lint.js";
import { lint as lintFromIndex } from "./lint/index.js";
import {
  AgentSpawnError,
  createSpawnUsageAccumulator,
  makeAgentModule,
  runWithSpawnUsageAccumulator
} from "./modules/agent.js";
import { makeEnvModule } from "./modules/env.js";
import { makeFailModule } from "./modules/fail.js";
import { makeFsModule } from "./modules/fs.js";
import { parseFsConfig, resolveFsConfig } from "./modules/fs-config.js";
import { makeHarnessModule } from "./modules/harness.js";
import { makeLogModule } from "./modules/log.js";
import { makeMetricModule } from "./modules/metric.js";
import { makeMcpModule } from "./modules/mcp.js";
import { makeTimeModule } from "./modules/time.js";
import { parse } from "./parse.js";
import { parseModule } from "./parse/parser.js";
import { findExportedConstInitializer } from "./loader/find-exported.js";
import { hashSource } from "./parse/hash.js";
import { restore } from "./restore.js";
import { run } from "./run.js";
import { runHarness, runHarnessPair } from "./runner/run-harness.js";
import { noopOtelSink } from "./observability/otel.js";
import { FileSnapshotBackend } from "./snapshot/backend.js";
import {
  HostOperationResumePolicyError,
  registerPendingHostCallPolicy
} from "./snapshot/policy.js";

describe("@poe-code/safe-js public exports", () => {
  it("removes Git from the public SDK", () => {
    expect(api).not.toHaveProperty("makeGitModule");
  });

  it("removes Git module implementation without a compatibility shim", async () => {
    await expect(vi.importActual("./modules/git.js")).rejects.toThrow();
  });

  it("re-exports the public entrypoints", () => {
    expect(api.Budget).toBe(Budget);
    expect(api.SandboxError).toBe(SandboxError);
    expect(api.AgentSpawnError).toBe(AgentSpawnError);
    expect(api.parse).toBe(parse);
    expect(api.parseModule).toBe(parseModule);
    expect(api.lint).toBe(lint);
    expect(lint).toBe(lintFromIndex);
    expect(api.run).toBe(run);
    expect(api.runHarness).toBe(runHarness);
    expect(api.runHarnessPair).toBe(runHarnessPair);
    expect(api.noopOtelSink).toBe(noopOtelSink);
    expect(api.dump).toBe(dump);
    expect(api.restore).toBe(restore);
    expect(api.extractBlock).toBe(extractBlock);
    expect(api.findExportedConstInitializer).toBe(findExportedConstInitializer);
    expect(api.splitFrontmatter).toBe(splitFrontmatter);
    expect(api.formatInterpreterError).toBe(formatInterpreterError);
    expect(api.deepCopyToSandbox).toBe(deepCopyToSandbox);
    expect(api.deepCopyFromSandbox).toBe(deepCopyFromSandbox);
    expect(api.createSpawnUsageAccumulator).toBe(createSpawnUsageAccumulator);
    expect(api.makeAgentModule).toBe(makeAgentModule);
    expect(api.runWithSpawnUsageAccumulator).toBe(runWithSpawnUsageAccumulator);
    expect(api.declareHostOperation).toBe(declareHostOperation);
    expect(api.HostOperationResumePolicyError).toBe(HostOperationResumePolicyError);
    expect(api.registerPendingHostCallPolicy).toBe(registerPendingHostCallPolicy);
    expect(api.makeEnvModule).toBe(makeEnvModule);
    expect(api.makeFailModule).toBe(makeFailModule);
    expect(api.makeFsModule).toBe(makeFsModule);
    expect(api.parseFsConfig).toBe(parseFsConfig);
    expect(api.resolveFsConfig).toBe(resolveFsConfig);
    expect(api.makeHarnessModule).toBe(makeHarnessModule);
    expect(api.makeLogModule).toBe(makeLogModule);
    expect(api.makeMetricModule).toBe(makeMetricModule);
    expect(api.makeMcpModule).toBe(makeMcpModule);
    expect(api.makeTimeModule).toBe(makeTimeModule);
    expect(api.FileSnapshotBackend).toBe(FileSnapshotBackend);
    expect(Object.keys(api).sort()).toEqual([
      "AgentSpawnError",
      "Budget",
      "EnvAccessError",
      "FileSnapshotBackend",
      "HostCallResumabilityError",
      "HostOperationResumePolicyError",
      "SandboxError",
      "SnapshotValidationError",
      "createRealm",
      "createReplayableRandom",
      "createSpawnUsageAccumulator",
      "declareHostOperation",
      "deepCopyFromSandbox",
      "deepCopyToSandbox",
      "defineExtension",
      "dump",
      "extractBlock",
      "findExportedConstInitializer",
      "formatInterpreterError",
      "inspectSnapshotMigration",
      "lint",
      "makeAgentModule",
      "makeEnvModule",
      "makeFailModule",
      "makeFsModule",
      "makeHarnessModule",
      "makeLogModule",
      "makeMcpModule",
      "makeMetricModule",
      "makeTimeModule",
      "migrateSnapshot",
      "migrateSnapshotFile",
      "noopOtelSink",
      "parse",
      "parseEnvConfig",
      "parseFsConfig",
      "parseMcpConfig",
      "parseModule",
      "registerPendingHostCallPolicy",
      "resolveFsConfig",
      "restore",
      "run",
      "runHarness",
      "runHarnessPair",
      "runWithSpawnUsageAccumulator",
      "splitFrontmatter"
    ]);
  });

  it("keeps restore hashes explicit while exporting runnable entrypoints", async () => {
    expect(api.parse("1")).toEqual({
      type: "NumericLiteral",
      raw: "1",
      value: 1,
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 2, offset: 1 }
      }
    });
    expect(
      api.lint('import { missing } from "htp";', {
        filename: "rule.js",
        modules: {
          api: ["request"],
          fs: ["readFile"]
        }
      })
    ).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'missing' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: 9 },
          end: { line: 1, column: 17, offset: 16 }
        }
      },
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api, fs.",
        filename: "rule.js",
        line: 1,
        column: 25,
        span: {
          start: { line: 1, column: 25, offset: 24 },
          end: { line: 1, column: 30, offset: 29 }
        }
      }
    ]);
    await expect(api.run("return Math.PI")).resolves.toMatchObject({
      ok: true,
      returnValue: Math.PI
    });
    await expect(
      api.dump({
        ok: true,
        snapshot: {
          sourceHash: hashSource("1")
        },
        stats: {
          nodeVisits: 1
        }
      })
    ).resolves.toBe(
      JSON.stringify(
        {
          version: 1,
          sourceHash: hashSource("1")
        },
        null,
        2
      )
    );
    expect(
      api.restore(
        {
          version: 1,
          sourceHash: hashSource("1")
        },
        { source: "1" }
      )
    ).toEqual({
      version: 1,
      sourceHash: hashSource("1")
    });
  });

  it("includes import module and export diagnostics in lint results", () => {
    const source = ['import { missing } from "api";', 'import { request } from "htp";'].join("\n");

    expect(
      lint(source, {
        modules: {
          api: ["request"]
        }
      })
    ).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'missing' is never referenced.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("missing") },
          end: { line: 1, column: 17, offset: source.indexOf("missing") + "missing".length }
        }
      },
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: request.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("missing") },
          end: { line: 1, column: 17, offset: source.indexOf("missing") + "missing".length }
        }
      },
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'request' is never referenced.",
        filename: "<input>",
        line: 2,
        column: 10,
        span: {
          start: { line: 2, column: 10, offset: source.lastIndexOf("request") },
          end: { line: 2, column: 17, offset: source.lastIndexOf("request") + "request".length }
        }
      },
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api.",
        filename: "<input>",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.lastIndexOf('"htp"') },
          end: { line: 2, column: 30, offset: source.lastIndexOf('"htp"') + '"htp"'.length }
        }
      }
    ]);
  });

  it("accepts ordinary function method callbacks through the public API", async () => {
    const source = [
      "const value = 'abba';",
      "const values = [2, 1];",
      "function compare(left, right) { return left - right; }",
      "value.replace('a', () => 'b');",
      "return values.sort(compare);"
    ].join("\n");

    expect(
      lint(source, { filename: "rule.js" }).filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
    await expect(api.run(source)).resolves.toMatchObject({ ok: true, returnValue: [1, 2] });
  });

  it("includes top-level module shadowing diagnostics in lint results", () => {
    const source = ["const agent = createAgent();", "const { git } = repo;"].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          agent: ["run"],
          git: ["status"]
        }
      }).filter((diagnostic) => diagnostic.code === "AS013")
    ).toMatchObject([
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'agent' shadows registered module 'agent'.",
        filename: "rule.js",
        line: 1,
        column: 7,
        span: {
          start: { line: 1, column: 7, offset: source.indexOf("agent") },
          end: { line: 1, column: 12, offset: source.indexOf("agent") + "agent".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'git' shadows registered module 'git'.",
        filename: "rule.js",
        line: 2,
        column: 9,
        span: {
          start: { line: 2, column: 9, offset: source.lastIndexOf("git") },
          end: { line: 2, column: 12, offset: source.lastIndexOf("git") + "git".length }
        }
      }
    ]);
  });

  it("includes single-element Promise.race diagnostics in lint results", () => {
    const source = "const result = Promise.race([runTask()]);";

    expect(
      lint(source, { filename: "rule.js" }).filter((diagnostic) => diagnostic.code === "AS015")
    ).toEqual([
      {
        code: "AS015",
        severity: "warning",
        message:
          "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf("Promise.race") },
          end: {
            line: 1,
            column: 41,
            offset: source.indexOf("Promise.race([runTask()])") + "Promise.race([runTask()])".length
          }
        }
      }
    ]);
  });

  it("includes single-element Promise['race'] diagnostics in lint results", () => {
    const source = 'const result = Promise["race"]([runTask()]);';

    expect(
      lint(source, { filename: "rule.js" }).filter((diagnostic) => diagnostic.code === "AS015")
    ).toEqual([
      {
        code: "AS015",
        severity: "warning",
        message:
          "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf('Promise["race"]') },
          end: {
            line: 1,
            column: 44,
            offset:
              source.indexOf('Promise["race"]([runTask()])') + 'Promise["race"]([runTask()])'.length
          }
        }
      }
    ]);
  });

  it("includes cyclic import diagnostics for source-backed modules", () => {
    const alphaSource = ['import { run } from "beta";', "const start = () => run();"].join("\n");
    const betaSource = ['import { start } from "alpha";', "const run = () => start();"].join("\n");

    expect(
      lint(alphaSource, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: {
            exports: ["start"],
            filename: "/agents/alpha.ajs",
            source: alphaSource
          },
          beta: {
            exports: ["run"],
            filename: "/agents/beta.ajs",
            source: betaSource
          }
        }
      }).filter((diagnostic) => diagnostic.code === "AS-IMPORT-CYCLE")
    ).toMatchObject([
      {
        code: "AS-IMPORT-CYCLE",
        severity: "error",
        message: "Import from 'beta' participates in a cyclic dependency: alpha -> beta -> alpha.",
        filename: "/agents/alpha.ajs",
        line: 1,
        column: 21,
        span: {
          start: { line: 1, column: 21, offset: alphaSource.indexOf('"beta"') },
          end: { line: 1, column: 27, offset: alphaSource.indexOf('"beta"') + '"beta"'.length }
        }
      },
      {
        code: "AS-IMPORT-CYCLE",
        severity: "error",
        message: "Import from 'alpha' participates in a cyclic dependency: beta -> alpha -> beta.",
        filename: "/agents/beta.ajs",
        line: 1,
        column: 23,
        span: {
          start: { line: 1, column: 23, offset: betaSource.indexOf('"alpha"') },
          end: { line: 1, column: 30, offset: betaSource.indexOf('"alpha"') + '"alpha"'.length }
        }
      }
    ]);
  });

  it("does not throw when an unrelated source-backed module has invalid source", () => {
    const source = "const current = () => 1;";

    expect(() =>
      lint(source, {
        filename: "/agents/current.ajs",
        modules: {
          current: {
            exports: ["current"],
            filename: "/agents/current.ajs",
            source
          },
          broken: {
            exports: ["broken"],
            filename: "/agents/broken.ajs",
            source: "import { x } from ;"
          }
        }
      })
    ).not.toThrow();
  });

  it("allows supported regex method calls", () => {
    const source = [
      "const value = 'abba';",
      "const parts = value.split(/b+/);",
      "const fixed = value.replace(/a/g, () => 'b');"
    ].join("\n");

    expect(
      lint(source, { filename: "rule.js" }).filter(
        (diagnostic) => diagnostic.code === "AS001" || diagnostic.code === "AS012"
      )
    ).toEqual([]);
  });

  it("accepts the lint modules Map API and sorts diagnostics by source position", () => {
    const source = [
      'import value from "api";',
      'import { request } from "htp";',
      'import { missing } from "api";'
    ].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: new Map([
          ["zeta", ["last"]],
          ["api", ["request", "request"]]
        ])
      })
    ).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'value' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("value") },
          end: { line: 1, column: 13, offset: source.indexOf("value") + "value".length }
        }
      },
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'default'. Available exports: request.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("value") },
          end: { line: 1, column: 13, offset: source.indexOf("value") + "value".length }
        }
      },
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'request' is never referenced.",
        filename: "rule.js",
        line: 2,
        column: 10,
        span: {
          start: { line: 2, column: 10, offset: source.indexOf("request") },
          end: { line: 2, column: 17, offset: source.indexOf("request") + "request".length }
        }
      },
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api, zeta.",
        filename: "rule.js",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.indexOf('"htp"') },
          end: { line: 2, column: 30, offset: source.indexOf('"htp"') + '"htp"'.length }
        }
      },
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'missing' is never referenced.",
        filename: "rule.js",
        line: 3,
        column: 10,
        span: {
          start: { line: 3, column: 10, offset: source.lastIndexOf("missing") },
          end: { line: 3, column: 17, offset: source.lastIndexOf("missing") + "missing".length }
        }
      },
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: request.",
        filename: "rule.js",
        line: 3,
        column: 10,
        span: {
          start: { line: 3, column: 10, offset: source.lastIndexOf("missing") },
          end: { line: 3, column: 17, offset: source.lastIndexOf("missing") + "missing".length }
        }
      }
    ]);
  });

  it("includes unused import and binding warnings in lint results", () => {
    const source = [
      'import { used, unused } from "api";',
      "const value = used(1);",
      "let stale = 0;"
    ].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          api: ["used", "unused"]
        }
      })
    ).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'unused' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf("unused") },
          end: { line: 1, column: 22, offset: source.indexOf("unused") + "unused".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'value' is declared but never read.",
        filename: "rule.js",
        line: 2,
        column: 7,
        span: {
          start: { line: 2, column: 7, offset: source.indexOf("value") },
          end: { line: 2, column: 12, offset: source.indexOf("value") + "value".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'stale' is declared but never read.",
        filename: "rule.js",
        line: 3,
        column: 5,
        span: {
          start: { line: 3, column: 5, offset: source.indexOf("stale") },
          end: { line: 3, column: 10, offset: source.indexOf("stale") + "stale".length }
        }
      }
    ]);
  });

  it("includes async host promise return diagnostics in lint results", () => {
    const source = [
      'import { spawn } from "agent";',
      "const run = async () => spawn();",
      "run;"
    ].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          agent: ["spawn"]
        }
      })
    ).toMatchObject([
      {
        code: "AS-ASYNC-NOT-NEEDED",
        severity: "info",
        message: "Async functions without await should remove the async keyword.",
        filename: "rule.js",
        line: 2,
        column: 13,
        span: {
          start: { line: 2, column: 13, offset: source.indexOf("async") },
          end: { line: 2, column: 18, offset: source.indexOf("async") + "async".length }
        }
      },
      {
        code: "AS009",
        severity: "error",
        message:
          "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.",
        filename: "rule.js",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.indexOf("spawn()") },
          end: { line: 2, column: 32, offset: source.indexOf("spawn()") + "spawn()".length }
        }
      }
    ]);
  });

  it("prefers AS010 over the generic unread-binding warning for unread top-level host results", () => {
    const source = ['import { spawn } from "agent";', "let handle = spawn();"].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          agent: ["spawn"]
        }
      })
    ).toEqual([
      {
        code: "AS010",
        severity: "warning",
        message: "Top-level let 'handle' stores a host call result but is never read again.",
        filename: "rule.js",
        line: 2,
        column: 5,
        span: {
          start: { line: 2, column: 5, offset: source.indexOf("handle") },
          end: { line: 2, column: 11, offset: source.indexOf("handle") + "handle".length }
        }
      }
    ]);
  });

  it("permits ordinary guest constructor property access in lint results", () => {
    const source = ["({ safe: 1 }).safe;", '({ safe: 1 })["constructor"];'].join("\n");

    expect(lint(source, { filename: "rule.js" })).toEqual([]);
  });
});
