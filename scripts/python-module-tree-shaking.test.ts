import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.each(["llm-module", "shell-module", "library-adapter"])(
  "removes unused Python source from an effectful %s import",
  async (name) => {
    const contents = await readFile(
      new URL(`../packages/safe-bash/src/commands/python/${name}.ts`, import.meta.url),
      "utf8"
    );
    const result = await build({
      stdin: { contents: 'import "python-module"; console.log("kept");' },
      bundle: true,
      write: false,
      minify: true,
      plugins: [{
        name: "python-source",
        setup(plugin) {
          plugin.onResolve({ filter: /^python-module$/ }, () => ({
            path: name, namespace: "python-source", sideEffects: true
          }));
          plugin.onLoad({ filter: /.*/, namespace: "python-source" }, () => ({
            contents, loader: "ts",
            resolveDir: fileURLToPath(new URL("../packages/safe-bash/src/commands/python/", import.meta.url))
          }));
        }
      }]
    });
    expect(result.outputFiles[0]!.text).toBe('(()=>{console.log("kept");})();\n');
  }
);
