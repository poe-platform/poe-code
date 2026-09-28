import { build } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";

const contractsDist = new URL("../../safe-bash-contracts/dist/", import.meta.url);
for (const entry of await readdir(contractsDist)) {
  if (!entry.endsWith(".js")) continue;
  const fileUrl = new URL(entry, contractsDist);
  const source = await readFile(fileUrl, "utf8");
  const updated = source
    .replaceAll('"@poe-code/safe-fs/core"', '"../../safe-fs/dist/core.js"')
    .replaceAll('"safe-bash-contracts/errors"', '"./errors.js"');
  if (updated !== source) await writeFile(fileUrl, updated);
}

await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/index.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  plugins: [{
    name: "workspace-shared-dist",
    setup(builder) {
      builder.onResolve({ filter: /^(@poe-code\/safe-fs|safe-bash-contracts)(\/.*)?$/ }, args => {
        if (args.path === "@poe-code/safe-fs") return { path: "../../safe-fs/dist/index.js", external: true };
        if (args.path.startsWith("@poe-code/safe-fs/")) return { path: `../../safe-fs/dist/${args.path.slice("@poe-code/safe-fs/".length)}.js`, external: true };
        if (args.path === "safe-bash-contracts") return { path: "../../safe-bash-contracts/dist/index.js", external: true };
        if (args.path.startsWith("safe-bash-contracts/")) return { path: `../../safe-bash-contracts/dist/${args.path.slice("safe-bash-contracts/".length)}.js`, external: true };
      });
    }
  }],
  sourcemap: true
});

await build({
  stdin: {
    contents: 'import { snapshotRuntimeFunctions } from "./index.js"; globalThis.snapshot = snapshotRuntimeFunctions({});',
    resolveDir: new URL("../dist/", import.meta.url).pathname,
  },
  outfile: new URL("../dist/testing/worker-runtime-fixture.js", import.meta.url).pathname,
  bundle: true,
  platform: "browser",
  format: "iife",
});
