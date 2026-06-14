import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

const { assertReplayEquivalent } = await import("./replay-equivalence.js");
const api = await import("../index.js");

describe("assertReplayEquivalent", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("is re-exported from the package entrypoint", () => {
    expect(api.assertReplayEquivalent).toBe(assertReplayEquivalent);
  });

  it("gates the coverage-demo harness with deterministic modules", async () => {
    const mdPath = "/repo/templates/coverage-demo/coverage-demo.md";
    vol.fromJSON({
      [mdPath]: readCoverageDemoTemplate("coverage-demo.md"),
      "/repo/templates/coverage-demo/coverage-demo.ajs":
        readCoverageDemoTemplate("coverage-demo.ajs")
    });

    await expect(assertReplayEquivalent(mdPath, deterministicModulesFor)).resolves.toBeUndefined();
  });

  it("fails clearly when a harness uses unseeded Math.random", async () => {
    const mdPath = "/repo/harness/random.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: random\nversion: 1\n---\n",
      "/repo/harness/random.ajs": "export default async (frontmatter) => Math.random();"
    });

    await expect(assertReplayEquivalent(mdPath, deterministicModulesFor)).rejects.toThrow(
      "non-deterministic"
    );
  });

  it("replays a snapshot captured before any await resolves", async () => {
    const mdPath = "/repo/harness/before-await.md";
    const step = vi.fn(async () => "alpha");
    vol.fromJSON({
      [mdPath]: "---\nkind: before-await\nversion: 1\n---\n",
      "/repo/harness/before-await.ajs": [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const value = await step('first');",
        "  return value.concat(':done');",
        "};"
      ].join("\n")
    });

    await expect(
      assertReplayEquivalent(mdPath, () => ({
        host: {
          step
        }
      }))
    ).resolves.toBeUndefined();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("replays the completed snapshot without re-executing host side effects", async () => {
    const mdPath = "/repo/harness/after-last-await.md";
    const value = vi.fn(async () => "cached");
    let modulesForCalls = 0;
    vol.fromJSON({
      [mdPath]: "---\nkind: after-last-await\nversion: 1\n---\n",
      "/repo/harness/after-last-await.ajs": [
        'import { value } from "host";',
        "export default async (frontmatter) => {",
        "  const result = await value();",
        "  return result;",
        "};"
      ].join("\n")
    });

    await expect(
      assertReplayEquivalent(mdPath, () => {
        modulesForCalls += 1;

        return {
          host: {
            value
          }
        };
      })
    ).resolves.toBeUndefined();
    expect(value).toHaveBeenCalledTimes(1);
    expect(modulesForCalls).toBeGreaterThan(1);
  });

  it("surfaces sourceHash mismatches from tampered snapshots", async () => {
    const mdPath = "/repo/harness/tampered.md";
    const ajsPath = "/repo/harness/tampered.ajs";
    vol.fromJSON({
      [mdPath]: "---\nkind: tampered\nversion: 1\n---\n",
      [ajsPath]: [
        'import { tamper } from "host";',
        "export default async (frontmatter) => {",
        "  await tamper();",
        "  return 'original';",
        "};"
      ].join("\n")
    });

    await expect(
      assertReplayEquivalent(mdPath, () => ({
        host: {
          async tamper() {
            vol.writeFileSync(
              ajsPath,
              [
                'import { tamper } from "host";',
                "export default async (frontmatter) => {",
                "  await tamper();",
                "  return 'changed';",
                "};"
              ].join("\n")
            );
          }
        }
      }))
    ).rejects.toThrow("source changed since snapshot was taken");
  });
});

function deterministicModulesFor() {
  return {
    agent: {
      async spawn(_agent: string, options: { prompt: string }) {
        return {
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stdout: "",
          summary: `stub:${options.prompt.split("\n", 1)[0]}`
        };
      }
    },
    log: {
      event() {}
    }
  };
}

function readCoverageDemoTemplate(fileName: "coverage-demo.ajs" | "coverage-demo.md"): string {
  return readFileSync(new URL(`../templates/coverage-demo/${fileName}`, import.meta.url), "utf8");
}
