import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createToolcraftBundleOptions } from "./toolcraft-standalone-bundle.mjs";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), "toolcraft-entrypoint-bundles-"));
const packDirectory = path.join(fixtureDirectory, "pack");
const buildDirectory = path.join(fixtureDirectory, "build");

function runtimeNodeBinaries() {
  const configured = process.env.TOOLCRAFT_NODE_BINARIES;
  return configured === undefined ? [process.execPath] : configured.split(path.delimiter);
}

async function bundleEntrypoint(name, source) {
  const sourcePath = path.join(buildDirectory, `${name}.mjs`);
  const outputPath = path.join(buildDirectory, "dist", `${name}.mjs`);
  writeFileSync(sourcePath, source);
  await build({
    ...createToolcraftBundleOptions(sourcePath, outputPath),
    legalComments: "none"
  });
  return outputPath;
}

function installBundleFixture(name, bundlePath) {
  const packageName = `toolcraft-${name}-bundle-smoke`;
  const packageDirectory = path.join(fixtureDirectory, `${name}-package`);
  const consumerDirectory = path.join(fixtureDirectory, `${name}-consumer`);
  mkdirSync(path.join(packageDirectory, "dist"), { recursive: true });
  mkdirSync(consumerDirectory, { recursive: true });
  cpSync(bundlePath, path.join(packageDirectory, "dist", "index.mjs"));
  writeFileSync(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify({
      name: packageName,
      version: "1.0.0",
      private: false,
      type: "module",
      main: "dist/index.mjs",
      files: ["dist"]
    })}\n`
  );
  const packResult = JSON.parse(
    execFileSync("npm", ["pack", packageDirectory, "--json", "--pack-destination", packDirectory], {
      encoding: "utf8"
    })
  );
  writeFileSync(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" })}\n`
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(packDirectory, packResult[0].filename)
    ],
    { cwd: consumerDirectory, stdio: "inherit" }
  );
  assert.equal(existsSync(path.join(consumerDirectory, "node_modules", "toolcraft")), false);
  assert.equal(existsSync(path.join(consumerDirectory, "node_modules", "ignore")), false);
  return { consumerDirectory, packageName };
}

try {
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(buildDirectory, { recursive: true });
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "./packages/toolcraft", "--json", "--pack-destination", packDirectory],
      { cwd: rootDirectory, encoding: "utf8" }
    )
  );
  const tarballPath = path.join(packDirectory, packResult[0].filename);
  writeFileSync(
    path.join(buildDirectory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" })}\n`
  );
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: buildDirectory,
    stdio: "inherit"
  });

  const sdkBundle = await bundleEntrypoint(
    "sdk",
    [
      'import { defineGroup } from "toolcraft";',
      'import { createSDK } from "toolcraft/sdk";',
      'createSDK(defineGroup({ name: "root", children: [] }));',
      'console.log("sdk-ok");'
    ].join("\n")
  );
  const mcpBundle = await bundleEntrypoint(
    "mcp",
    [
      'import { defineGroup } from "toolcraft";',
      'import { runMCP } from "toolcraft/mcp";',
      'await runMCP(defineGroup({ name: "root", children: [] }), {',
      '  name: "bundle-smoke",',
      '  version: "1.0.0"',
      "});"
    ].join("\n")
  );

  const sdkFixture = installBundleFixture("sdk", sdkBundle);
  const mcpFixture = installBundleFixture("mcp", mcpBundle);

  const initializeRequest = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "bundle-smoke", version: "1.0.0" }
    }
  })}\n`;
  for (const nodeBinary of runtimeNodeBinaries()) {
    assert.equal(
      execFileSync(
        nodeBinary,
        ["--input-type=module", "--eval", `await import("${sdkFixture.packageName}")`],
        { cwd: sdkFixture.consumerDirectory, encoding: "utf8" }
      ),
      "sdk-ok\n"
    );
    const response = JSON.parse(
      execFileSync(
        nodeBinary,
        ["--input-type=module", "--eval", `await import("${mcpFixture.packageName}")`],
        {
          cwd: mcpFixture.consumerDirectory,
          encoding: "utf8",
          input: initializeRequest
        }
      )
    );
    assert.equal(response.result.serverInfo.name, "bundle-smoke");
  }

  console.log("Toolcraft SDK and MCP standalone bundles passed in clean runtimes.");
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
