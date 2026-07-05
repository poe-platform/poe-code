import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

const require = createRequire(import.meta.url);
const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packagesDir = path.dirname(packageDir);
const distDir = path.join(packageDir, "dist");
const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "tiny-mcp-client-build-"));

const declarationAliases = new Map([
  ["mcp-oauth", path.join(packagesDir, "mcp-oauth", "dist", "index.d.ts")],
  ["auth-store", path.join(packagesDir, "auth-store", "dist", "index.d.ts")]
]);

const inlineWorkspaceDeclarations = {
  name: "inline-workspace-declarations",
  resolveId(source) {
    return declarationAliases.get(source) ?? null;
  }
};

try {
  await assertSafeOutputDirectory(packageDir, distDir);
  await rm(distDir, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "--emitDeclarationOnly"],
    { cwd: packageDir, stdio: "inherit" }
  );

  const declarationBundle = await rollup({
    input: path.join(distDir, "index.d.ts"),
    external: (source) => source.startsWith("node:"),
    plugins: [inlineWorkspaceDeclarations, dts()]
  });
  await declarationBundle.write({
    file: path.join(temporaryDir, "index.d.ts"),
    format: "es"
  });
  await declarationBundle.close();

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await build({
    entryPoints: [path.join(packageDir, "src", "index.ts")],
    outfile: path.join(distDir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18"
  });
  await cp(path.join(temporaryDir, "index.d.ts"), path.join(distDir, "index.d.ts"));
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}
