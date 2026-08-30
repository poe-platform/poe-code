import { describe, expect, it } from "vitest";

import { AS014 } from "./AS014.js";

describe("AS014", () => {
  const messages = (source: string, modules: NonNullable<Parameters<typeof AS014>[1]>["modules"]) =>
    AS014(source, { filename: "/agents/alpha.ajs", modules }).map(
      (diagnostic) => diagnostic.message
    );

  it("is a no-op in single-file mode", () => {
    const source = 'import { run } from "beta";';

    expect(
      AS014(source, {
        filename: "alpha.ajs",
        modules: {
          beta: ["run"]
        }
      })
    ).toEqual([]);
  });

  it("is a no-op when only the current module is source-backed", () => {
    const source = 'import { run } from "beta";';

    expect(
      AS014(source, {
        filename: "/agents/alpha.ajs",
        modules: {
          alpha: {
            exports: ["start"],
            filename: "/agents/alpha.ajs",
            source
          },
          beta: ["run"]
        }
      })
    ).toEqual([]);
  });

  it("reports source-backed module imports that participate in a cycle", () => {
    const alphaSource = ['import { run } from "beta";', "const start = () => run();"].join("\n");
    const betaSource = ['import { start } from "alpha";', "const run = () => start();"].join("\n");

    expect(
      AS014(alphaSource, {
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
      })
    ).toEqual([
      {
        code: "AS014",
        severity: "error",
        message: "Import from 'beta' participates in a cyclic dependency: alpha -> beta -> alpha.",
        filename: "/agents/alpha.ajs",
        line: 1,
        column: 21,
        span: {
          start: { line: 1, column: 21, offset: alphaSource.indexOf('"beta"') },
          end: { line: 1, column: 27, offset: alphaSource.indexOf('"beta"') + '"beta"'.length }
        }
      }
    ]);
  });

  it("reports multi-hop cycles across source-backed modules", () => {
    const alphaSource = ['import { run } from "beta";', "const start = () => run();"].join("\n");
    const betaSource = ['import { finish } from "gamma";', "const run = () => finish();"].join(
      "\n"
    );
    const gammaSource = ['import { start } from "alpha";', "const finish = () => start();"].join(
      "\n"
    );

    expect(
      AS014(alphaSource, {
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
          },
          gamma: {
            exports: ["finish"],
            filename: "/agents/gamma.ajs",
            source: gammaSource
          }
        }
      })
    ).toEqual([
      {
        code: "AS014",
        severity: "error",
        message:
          "Import from 'beta' participates in a cyclic dependency: alpha -> beta -> gamma -> alpha.",
        filename: "/agents/alpha.ajs",
        line: 1,
        column: 21,
        span: {
          start: { line: 1, column: 21, offset: alphaSource.indexOf('"beta"') },
          end: { line: 1, column: 27, offset: alphaSource.indexOf('"beta"') + '"beta"'.length }
        }
      }
    ]);
  });

  it("ignores cycles that do not include the current module", () => {
    const alphaSource = ['import { run } from "beta";', "const start = () => run();"].join("\n");
    const betaSource = ['import { finish } from "gamma";', "const run = () => finish();"].join(
      "\n"
    );
    const gammaSource = ['import { run } from "beta";', "const finish = () => run();"].join("\n");

    expect(
      AS014(alphaSource, {
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
          },
          gamma: {
            exports: ["finish"],
            filename: "/agents/gamma.ajs",
            source: gammaSource
          }
        }
      })
    ).toEqual([]);
  });

  it("reports cyclic imports at the end of the current file", () => {
    const alphaSource = ["const start = () => run();", 'import { run } from "beta";'].join("\n");
    const betaSource = 'import { start } from "alpha";';

    expect(
      messages(alphaSource, {
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
      })
    ).toEqual(["Import from 'beta' participates in a cyclic dependency: alpha -> beta -> alpha."]);
  });

  it("ignores import-like text inside source-backed modules", () => {
    const alphaSource = [
      'const note = `import { run } from "beta"`;',
      'import { run } from "safe";'
    ].join("\n");
    const betaSource = 'import { start } from "alpha";';

    expect(
      messages(alphaSource, {
        alpha: {
          exports: ["start"],
          filename: "/agents/alpha.ajs",
          source: alphaSource
        },
        beta: {
          exports: ["run"],
          filename: "/agents/beta.ajs",
          source: betaSource
        },
        safe: {
          exports: ["run"],
          filename: "/agents/safe.ajs",
          source: "const run = () => 1;"
        }
      })
    ).toEqual([]);
  });

  it("reports each direct source-backed import that can reach the current module", () => {
    const alphaSource = ['import { run } from "beta";', 'import { finish } from "gamma";'].join(
      "\n"
    );
    const betaSource = 'import { start } from "alpha";';
    const gammaSource = 'import { start } from "alpha";';

    expect(
      messages(alphaSource, {
        alpha: {
          exports: ["start"],
          filename: "/agents/alpha.ajs",
          source: alphaSource
        },
        beta: {
          exports: ["run"],
          filename: "/agents/beta.ajs",
          source: betaSource
        },
        gamma: {
          exports: ["finish"],
          filename: "/agents/gamma.ajs",
          source: gammaSource
        }
      })
    ).toEqual([
      "Import from 'beta' participates in a cyclic dependency: alpha -> beta -> alpha.",
      "Import from 'gamma' participates in a cyclic dependency: alpha -> gamma -> alpha."
    ]);
  });

  it("reports self-import cycles", () => {
    const alphaSource = 'import { start } from "alpha";';

    expect(
      messages(alphaSource, {
        alpha: {
          exports: ["start"],
          filename: "/agents/alpha.ajs",
          source: alphaSource
        }
      })
    ).toEqual(["Import from 'alpha' participates in a cyclic dependency: alpha -> alpha."]);
  });

  it("ignores non-source-backed modules in an otherwise cyclic graph", () => {
    const alphaSource = 'import { run } from "beta";';

    expect(
      messages(alphaSource, {
        alpha: {
          exports: ["start"],
          filename: "/agents/alpha.ajs",
          source: alphaSource
        },
        beta: ["run"]
      })
    ).toEqual([]);
  });

  it("reports cycles through typed source-backed module registrations", () => {
    const alphaSource = 'import { run } from "beta";';
    const betaSource = 'import { start } from "alpha";';

    expect(
      messages(alphaSource, {
        alpha: {
          exports: {
            start: "() => void"
          },
          filename: "/agents/alpha.ajs",
          source: alphaSource
        },
        beta: {
          exports: {
            run: {
              async: true,
              type: "() => Promise<void>"
            }
          },
          filename: "/agents/beta.ajs",
          source: betaSource
        }
      })
    ).toEqual(["Import from 'beta' participates in a cyclic dependency: alpha -> beta -> alpha."]);
  });
});
