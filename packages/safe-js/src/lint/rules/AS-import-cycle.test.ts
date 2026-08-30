import { describe, expect, it } from "vitest";

import { AS_IMPORT_CYCLE } from "./AS-import-cycle.js";
import type { Modules } from "./module-registry.js";

function sourceModule(source: string, filename: string, exports: readonly string[] = ["default"]) {
  return {
    exports,
    filename,
    source
  };
}

describe("AS_IMPORT_CYCLE", () => {
  it("reports both import statements in a two-module cycle", () => {
    const alphaSource = 'import { run } from "beta";';
    const betaSource = 'import { start } from "alpha";';

    expect(
      AS_IMPORT_CYCLE(alphaSource, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: sourceModule(alphaSource, "/agents/alpha.ajs", ["start"]),
          beta: sourceModule(betaSource, "/agents/beta.ajs", ["run"])
        }
      })
    ).toEqual([
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

  it("allows a linear import chain", () => {
    const alphaSource = 'import { run } from "beta";';
    const betaSource = 'import { finish } from "gamma";';
    const gammaSource = "const finish = () => 1;";

    expect(
      AS_IMPORT_CYCLE(alphaSource, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: sourceModule(alphaSource, "/agents/alpha.ajs", ["start"]),
          beta: sourceModule(betaSource, "/agents/beta.ajs", ["run"]),
          gamma: sourceModule(gammaSource, "/agents/gamma.ajs", ["finish"])
        }
      })
    ).toEqual([]);
  });

  it("reports self-imports", () => {
    const alphaSource = 'import { start } from "alpha";';

    expect(
      AS_IMPORT_CYCLE(alphaSource, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: sourceModule(alphaSource, "/agents/alpha.ajs", ["start"])
        }
      })
    ).toEqual([
      {
        code: "AS-IMPORT-CYCLE",
        severity: "error",
        message: "Import from 'alpha' participates in a cyclic dependency: alpha -> alpha.",
        filename: "/agents/alpha.ajs",
        line: 1,
        column: 23,
        span: {
          start: { line: 1, column: 23, offset: alphaSource.indexOf('"alpha"') },
          end: { line: 1, column: 30, offset: alphaSource.indexOf('"alpha"') + '"alpha"'.length }
        }
      }
    ]);
  });

  it("allows diamond imports without back edges", () => {
    const alphaSource = ['import { run } from "beta";', 'import { finish } from "gamma";'].join(
      "\n"
    );
    const betaSource = 'import { finish } from "gamma";';
    const gammaSource = "const finish = () => 1;";

    expect(
      AS_IMPORT_CYCLE(alphaSource, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: sourceModule(alphaSource, "/agents/alpha.ajs", ["start"]),
          beta: sourceModule(betaSource, "/agents/beta.ajs", ["run"]),
          gamma: sourceModule(gammaSource, "/agents/gamma.ajs", ["finish"])
        }
      })
    ).toEqual([]);
  });

  it("is a no-op for export-list-only module registries", () => {
    const source = 'import { run } from "beta";';
    const modules: Modules = {
      alpha: ["start"],
      beta: ["run"]
    };

    expect(AS_IMPORT_CYCLE(source, { filename: "/agents/alpha.ajs", modules })).toEqual([]);
  });

  it("reports every import statement in a three-module cycle", () => {
    const alphaSource = 'import { run } from "beta";';
    const betaSource = 'import { finish } from "gamma";';
    const gammaSource = 'import { start } from "alpha";';

    expect(
      AS_IMPORT_CYCLE(alphaSource, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: sourceModule(alphaSource, "/agents/alpha.ajs", ["start"]),
          beta: sourceModule(betaSource, "/agents/beta.ajs", ["run"]),
          gamma: sourceModule(gammaSource, "/agents/gamma.ajs", ["finish"])
        }
      })
    ).toEqual([
      expect.objectContaining({
        code: "AS-IMPORT-CYCLE",
        filename: "/agents/alpha.ajs",
        message:
          "Import from 'beta' participates in a cyclic dependency: alpha -> beta -> gamma -> alpha."
      }),
      expect.objectContaining({
        code: "AS-IMPORT-CYCLE",
        filename: "/agents/beta.ajs",
        message:
          "Import from 'gamma' participates in a cyclic dependency: beta -> gamma -> alpha -> beta."
      }),
      expect.objectContaining({
        code: "AS-IMPORT-CYCLE",
        filename: "/agents/gamma.ajs",
        message:
          "Import from 'alpha' participates in a cyclic dependency: gamma -> alpha -> beta -> gamma."
      })
    ]);
  });
});
