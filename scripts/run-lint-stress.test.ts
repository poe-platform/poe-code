import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { computeLintStressCacheKey, runLintStress } from "./run-lint-stress.mjs";

function createFixture() {
  const volume = Volume.fromJSON({
    "/repo/package.json": JSON.stringify({
      name: "poe-code",
      scripts: {
        "lint:eslint": "node --max-old-space-size=1024 scripts/lint-eslint.mjs"
      }
    }),
    "/repo/eslint.config.js": "export default [];\n",
    "/repo/vitest.lint-stress.config.ts": "export default {};\n",
    "/repo/scripts/lint-eslint.mjs": "export const v = 1;\n",
    "/repo/scripts/lint-eslint.stress.ts": "export const stress = 1;\n",
    "/repo/scripts/lint-eslint.fixtures.js": "export const fix = 1;\n",
    "/repo/scripts/lint-input-guard.mjs": "export const guard = 1;\n"
  });
  return createFsFromVolume(volume);
}

describe("run-lint-stress cache wrapper", () => {
  it("computes a content-addressed key that changes only when lint stress inputs change", () => {
    const fileSystem = createFixture();
    const key1 = computeLintStressCacheKey("/repo", { fileSystem });
    const key2 = computeLintStressCacheKey("/repo", { fileSystem });
    expect(key1).toBe(key2);

    fileSystem.writeFileSync("/repo/scripts/lint-eslint.stress.ts", "export const stress = 2;\n");
    const key3 = computeLintStressCacheKey("/repo", { fileSystem });
    expect(key3).not.toBe(key1);
  });

  it("caches passing lint stress runs and skips re-running vitest on cache hit", () => {
    const fileSystem = createFixture();
    const calls: string[][] = [];
    const status1 = runLintStress({
      root: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin" },
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status1).toBe(0);
    expect(calls).toHaveLength(1);

    const status2 = runLintStress({
      root: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin" },
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status2).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
