import path from "node:path";
import { build } from "esbuild";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { resolvePrivateCommandBuild } from "./bundle-safe-bash.mjs";

it("keeps copied private command assets inside a package dist directory", async () => {
  const name = "safe-bash-command-fixture";
  const volume = Volume.fromJSON({
    [`/repo/packages/${name}/dist/index.js`]: 'import module from "./runtime.wasm"; export { module };',
    [`/repo/packages/${name}/dist/runtime.wasm`]: "wasm fixture"
  });
  const profile = { version: "1.0.0", dependencies: {}, devDependencies: {}, portable: true };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg: {
    ...profile, name, private: true, type: "module", exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } }
  } }], { alias: {}, external: [], portable: true });
  const result = await build({ ...recipe, inject: [], plugins: [{ name: "memory", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => ({ path: path.resolve(args.resolveDir || "/repo", args.path), namespace: "memory" }));
    builder.onLoad({ filter: /.*/, namespace: "memory" }, args => ({
      contents: new Uint8Array(volume.readFileSync(args.path) as Buffer),
      resolveDir: path.dirname(args.path), loader: args.path.endsWith(".wasm") ? "copy" : "js"
    }));
  } }] });
  const assets = result.outputFiles!.filter(output => output.path.endsWith(".wasm"));
  expect(assets).toHaveLength(1);
  for (const asset of assets) {
    const parts = path.relative("/repo", asset.path).split(path.sep);
    expect(parts[0]).toBe("packages");
    expect(parts[2]).toBe("dist");
    expect(asset.text).toBe("wasm fixture");
  }
});
