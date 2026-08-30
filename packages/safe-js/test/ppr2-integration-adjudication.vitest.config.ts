import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../../vitest.config.js";

const phase = process.env.SAFEJS_PPR2_ADJUDICATION_PHASE ?? "candidate";
if (phase !== "ordered" && phase !== "candidate") throw new Error("Invalid validation phase");
const root = "out/safejs-remediation/ppr-002-integrated/provisional-ppr2/";
const bytes = readFileSync(root + "manifest.json");
if (
  createHash("sha256").update(bytes).digest("hex") !==
  "532adf40516da33ba2a66f04298e472e1f6ae42fcd90d04573c0f11fd7f32d22"
)
  throw new Error("Frozen candidate manifest changed");
const manifest = JSON.parse(bytes.toString());
const overriddenPaths = [
  "packages/safe-js/src/run.ts",
  "packages/safe-js/src/restore.ts",
  "packages/safe-js/src/snapshot/dump-format.ts",
  "packages/safe-js/src/snapshot/migration.ts"
];
const overrides = new Map<string, string>();
if (phase === "ordered")
  for (const path of overriddenPaths) {
    const entry = manifest.publishables.find((file: { path: string }) => file.path === path);
    const preimage = readFileSync(root + entry.orderedPreimage.path);
    if (createHash("sha256").update(preimage).digest("hex") !== entry.orderedPreimage.sha256)
      throw new Error("Ordered preimage changed: " + path);
    overrides.set(resolve(path), preimage.toString());
  }

export default mergeConfig(
  rootConfig,
  defineConfig({
    plugins: [
      {
        name: "exact-ordered-ppr2-preimages",
        enforce: "pre",
        load(id) {
          return overrides.get(id.split("?")[0]!);
        }
      }
    ],
    cacheDir: `out/safejs-ppr2-integration-adjudication/cache-${phase}`,
    test: { maxWorkers: 1, testTimeout: 10000 }
  })
);
