import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { resolveBrowserShellBuild } from "../../../../scripts/bundle-safe-bash.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(
  resolve(
    process.env.SAFE_BASH_CF_RUNTIME_ROOT ?? resolve(root, "out/cloudflare-runtime"),
    "package.json"
  )
);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const consumer = process.env.SAFE_BASH_LAZY_CONSUMER_ROOT;

test(`lazy optional loading in actual workerd (${consumer ? "installed" : "source"})`, async (t) => {
  const recipe = resolveBrowserShellBuild(root);
  const alias = consumer ? {} : { ...recipe.alias };
  if (consumer) {
    for (const name of ["safe-bash", "safe-fs"]) {
      const directory = resolve(consumer, "node_modules/@poe-platform", name);
      const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      for (const [subpath, entry] of Object.entries(manifest.exports)) {
        const target = entry.workerd ?? entry.browser ?? entry.import;
        if (typeof target === "string")
          alias["@poe-platform/" + name + subpath.slice(1)] = resolve(directory, target);
      }
    }
    alias["lazy-shell"] = alias["@poe-platform/safe-bash"];
    alias["lazy-python"] = alias["@poe-platform/safe-bash/commands/python"];
    alias["lazy-llm"] = alias["@poe-platform/safe-bash/commands/llm"];
    alias["poe-code/safe-fs/core"] = alias["@poe-platform/safe-fs/core"];
    delete alias["@poe-code/safe-fs"];
    alias["@poe-code/safe-fs"] = alias["@poe-platform/safe-fs/core"];
  } else {
    alias["lazy-shell"] = resolve(root, "packages/safe-bash/src/core.ts");
    alias["lazy-python"] = resolve(root, "packages/safe-bash/src/commands/python/index.ts");
    alias["lazy-llm"] = resolve(root, "packages/safe-bash/src/commands/llm/index.ts");
    alias["@poe-code/safe-fs"] = resolve(root, "packages/safe-fs/src/core.ts");
    alias["poe-code/safe-fs/core"] = resolve(root, "packages/safe-fs/src/core.ts");
  }
  if (!consumer) delete alias["@poe-code/xml-ast"];
  alias["@poe-code/safe-fs/core"] = alias["poe-code/safe-fs/core"];
  const output = resolve(root, "out/lazy-workerd");
  const bundle = await build({
    ...recipe,
    entryPoints: { main: fileURLToPath(new URL("lazy-loading.worker.mjs", import.meta.url)) },
    alias,
    external: [],
    tsconfig: resolve(root, "packages/safe-bash/tsconfig.json"),
    outdir: output,
    inject: consumer ? [] : recipe.inject,
    sourcemap: false,
    plugins: [
      ...(consumer ? [] : recipe.plugins),
      {
        name: "observe-heavy-evaluation",
        setup(builder) {
          builder.onLoad({ filter: /\.(?:ts|js)$/ }, async (args) => {
            const families = [
              "csvkit",
              "soffice",
              "ssconvert",
              "ffmpeg",
              "git",
              "pdfinfo",
              "pdftotext",
              "pdftk",
              "qpdf",
              "wkhtmltopdf",
              "pandoc"
            ];
            let labels = [];
            let contents;
            if (
              consumer &&
              args.path.startsWith(resolve(consumer, "node_modules/@poe-platform/safe-bash") + "/")
            ) {
              contents = await readFile(args.path, "utf8");
              labels = families.filter(
                (family) =>
                  contents.includes(`// packages/safe-bash/src/commands/${family}/index.ts`) ||
                  (family === "pandoc"
                    ? ["src/implementation.ts", "src/command.ts", "dist/index.js", "dist/command.js"]
                        .some(entry => contents.includes(`// packages/safe-bash-command-pandoc/${entry}`))
                    : contents.includes(`// packages/safe-bash-command-${family}/`))
              );
              for (const [owner, label] of [
                ["spreadsheet-engine", "spreadsheet-engine"],
                ["pdf-ast", "pdf-engine"],
                ["mp4-ast", "media-engine"]
              ]) {
                if (contents.includes(`// packages/${owner}/`)) labels.push(label);
              }
            } else if (!consumer && args.path.includes("/safe-bash/src/commands/")) {
              const family = args.path.split("/").at(-2);
              if (families.includes(family) && (args.path.endsWith("/index.ts") || args.path.endsWith("/implementation.ts"))) labels = [family];
            }
            if (labels.length === 0) return;
            contents ??= await readFile(args.path, "utf8");
            return {
              contents:
                `(globalThis.__lazyEngineEvaluations ??= []).push(...${JSON.stringify(labels)});\n` +
                contents,
              loader: args.path.endsWith(".ts") ? "ts" : "js",
              resolveDir: dirname(args.path)
            };
          });
        }
      }
    ]
  });
  const files = [...bundle.outputFiles].sort(
    (a, b) =>
      Number(b.path === resolve(output, "main.js")) - Number(a.path === resolve(output, "main.js"))
  );
  if (consumer)
    for (const input of Object.keys(bundle.metafile.inputs)) {
      if (
        resolve(root, input) === fileURLToPath(new URL("lazy-loading.worker.mjs", import.meta.url))
      )
        continue;
      assert.ok(
        !resolve(root, input).startsWith(resolve(root, "packages") + "/"),
        `Installed qualification leaked workspace source: ${input}`
      );
    }
  const modules = files.map((file) => ({
    type: file.path.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
    path: file.path,
    contents: file.path.endsWith(".wasm") ? file.contents : file.text
  }));
  const runtimeAt = performance.now();
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules,
      compatibilityDate: "2026-09-26",
      cf: false,
      handleUncaughtError(error) {
        t.diagnostic(String(error.stack));
      },
      handleStructuredLogs(entry) {
        t.diagnostic(JSON.stringify(entry));
      }
    })
  );
  try {
    await runtime.ready;
    const coldRuntimeMs = performance.now() - runtimeAt;
    const setupAt = performance.now();
    const setupResponse = await runtime.dispatchFetch("http://fixture/setup");
    assert.equal(setupResponse.status, 200, await setupResponse.clone().text());
    const coldSetup = await setupResponse.json();
    const coldSetupRequestMs = performance.now() - setupAt;
    assert.deepEqual(coldSetup.before, []);
    assert.equal(coldSetup.ordinary.exitCode, 0, coldSetup.ordinary.stderr);
    const response = await runtime.dispatchFetch("http://fixture/lazy");
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    t.diagnostic(
      JSON.stringify({
        profile: consumer ? "installed" : "source",
        coldRuntimeMs,
        coldSetupRequestMs,
        setupMs: result.setupMs,
        firstMs: result.firstMs,
        secondMs: result.secondMs,
        cleanupMs: result.cleanupMs,
        before: result.before,
        afterCsv: result.afterCsv,
        after: result.after,
        bundleBytes: bundle.outputFiles.reduce((total, file) => total + file.contents.length, 0)
      })
    );
    assert.deepEqual(
      result.before,
      [],
      "shell/discovery/Python/LLM must not evaluate heavy command adapters"
    );
    assert.equal(result.discovery, 43);
    for (const name of [
      "ordinary",
      "first",
      "second",
      "pdf",
      "spreadsheet",
      "pandoc",
      "media",
      "git"
    ])
      assert.equal(result[name].exitCode, 0, result[name].stderr);
    assert.equal(result.first.stdout, "name\nb\na\n");
    assert.match(result.pdf.stdout, /Lazy PDF/);
    assert.match(result.spreadsheet.stdout, /Ada,2/);
    assert.match(result.pandoc.stdout, /Worker document/);
    assert.ok(
      !result.afterCsv.some((name) =>
        [
          "soffice",
          "ssconvert",
          "ffmpeg",
          "git",
          "pdfinfo",
          "pdftotext",
          "pdftk",
          "qpdf",
          "wkhtmltopdf"
        ].includes(name)
      )
    );
    assert.ok(result.after.includes("ffmpeg") && result.after.includes("git"));
  } finally {
    await runtime.dispose();
  }
});
