import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));

test("root import cannot statically evaluate optional spreadsheet, PDF, media or Git engines", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["packages/safe-bash/src/core.ts"],
    tsconfig: "packages/safe-bash/tsconfig.json",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    outdir: "out/lazy-graph",
    write: false,
    metafile: true,
    loader: { ".wasm": "copy" },
    logLevel: "silent"
  });
  const inputs = result.metafile.inputs;
  const eager = new Set();
  const parents = new Map();
  function visit(name) {
    if (eager.has(name)) return;
    eager.add(name);
    for (const edge of inputs[name]?.imports ?? []) {
      if (!edge.external && edge.kind !== "dynamic-import") {
        if (!parents.has(edge.path)) parents.set(edge.path, name);
        visit(edge.path);
      }
    }
  }
  visit("packages/safe-bash/src/core.ts");
  for (const path of eager) {
    assert.ok(
      ![
        "spreadsheet-engine/",
        "pdf-ast/",
        "mp4-ast/",
        "git-rust/",
        "safe-bash-command-git/",
        "safe-bash-command-soffice/",
        "safe-bash-command-ssconvert/",
        "safe-bash-command-ffmpeg/"
      ].some((owner) => path.includes("/" + owner)),
      `Eager optional engine: ${path} via ${parents.get(path)} via ${parents.get(parents.get(path))}`
    );
  }
});

test("base command registration does not link unrelated optional families", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["packages/safe-bash/src/registry-entry.ts"],
    tsconfig: "packages/safe-bash/tsconfig.json",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    outdir: "out/lazy-default-graph",
    write: false,
    metafile: true,
    loader: { ".wasm": "copy" },
    logLevel: "silent"
  });
  for (const path of Object.keys(result.metafile.inputs)) {
    assert.ok(
      !["spreadsheet-engine/", "pdf-ast/", "mp4-ast/", "safe-bash-command-pandoc/", "safe-bash-command-soffice/", "safe-bash-command-ffmpeg/"].some(owner => path.includes("/" + owner)),
      `Default command registration links unrelated optional engine: ${path}`
    );
  }
});
