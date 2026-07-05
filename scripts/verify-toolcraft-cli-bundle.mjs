import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  canonicalizeToolcraftBundle,
  createToolcraftBundleOptions
} from "./toolcraft-standalone-bundle.mjs";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const packDirectory = mkdtempSync(path.join(os.tmpdir(), "toolcraft-bundle-pack-"));
const consumerDirectory = mkdtempSync(path.join(os.tmpdir(), "toolcraft-bundle-consumer-"));

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "./packages/toolcraft", "--json", "--pack-destination", packDirectory],
      { cwd: rootDirectory, encoding: "utf8" }
    )
  );
  const tarballPath = path.join(packDirectory, packResult[0].filename);
  const sourceDirectory = path.join(consumerDirectory, "src");
  const outputDirectory = path.join(consumerDirectory, "dist");
  const entryPoint = path.join(sourceDirectory, "cli.ts");
  const outputFile = path.join(outputDirectory, "cli.js");

  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    path.join(consumerDirectory, "package.json"),
    JSON.stringify({ name: "toolcraft-standalone-smoke", private: true, type: "module" }) + "\n"
  );
  writeFileSync(
    entryPoint,
    [
      'import { defineCommand, defineGroup, S } from "toolcraft";',
      'import { runCLI } from "toolcraft/cli";',
      "const hello = defineCommand({",
      '  name: "hello",',
      '  description: "Verify the standalone Toolcraft bundle.",',
      '  scope: ["cli"],',
      '  params: S.Object({ name: S.String({ description: "Name to greet." }) }),',
      "  handler: async ({ params }) => ({ greeting: `Hello, ${params.name}!` })",
      "});",
      'await runCLI(defineGroup({ name: "bundle-smoke", children: [hello] }));'
    ].join("\n") + "\n"
  );

  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: consumerDirectory,
    stdio: "inherit"
  });

  const result = await build({
    ...createToolcraftBundleOptions(entryPoint, outputFile),
    legalComments: "none",
    metafile: true,
    write: false
  });
  const bundledInputs = Object.keys(result.metafile.inputs);
  for (const optionalPackage of [
    "@poe-code/process-runner",
    "tiny-mcp-client",
    "@poe-code/agent-human-in-loop",
    "mcp-oauth"
  ]) {
    assert(
      !bundledInputs.some((input) => input.includes(optionalPackage)),
      `Expected the basic CLI bundle to omit ${optionalPackage}.`
    );
  }

  const bundleOutput = result.outputFiles.find((output) => output.path === outputFile);
  const sourceMapOutput = result.outputFiles.find((output) => output.path === `${outputFile}.map`);
  assert(bundleOutput, "Expected esbuild to produce the CLI bundle.");
  assert(sourceMapOutput, "Expected esbuild to produce an external source map.");

  const canonical = canonicalizeToolcraftBundle({
    bundle: bundleOutput.text,
    sourceMap: sourceMapOutput.text
  });
  writeFileSync(outputFile, canonical.bundle);
  writeFileSync(`${outputFile}.map`, canonical.sourceMap);

  const helpOutput = execFileSync(process.execPath, [outputFile, "--help"], {
    cwd: consumerDirectory,
    encoding: "utf8"
  });
  assert(helpOutput.includes("bundle-smoke"), "Expected the bundled CLI help to start.");
  assert(readFileSync(`${outputFile}.map`, "utf8").includes('"sources"'), "Expected a source map.");

  console.log(`Toolcraft standalone CLI bundle passed on ${process.version}.`);
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
  rmSync(consumerDirectory, { recursive: true, force: true });
}
