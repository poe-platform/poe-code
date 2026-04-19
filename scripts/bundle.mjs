import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { versionGateSnippet } from "./node-version-gate.mjs";
import { resolveGithubWorkflowAssetCopies } from "./bundle-assets.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");

// Read workspace package names and create source aliases
const packagesDir = path.join(rootDir, "packages");
const workspaceDirs = await readdir(packagesDir, { withFileTypes: true });
const workspaceAliases = {};
const workspacePackageNames = new Set();

const workspaceDeps = new Set();

for (const dir of workspaceDirs.filter((d) => d.isDirectory())) {
  const pkgPath = path.join(packagesDir, dir.name, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  workspacePackageNames.add(pkg.name);
  // Resolve workspace packages to source (Just-in-Time compilation)
  workspaceAliases[pkg.name] = path.join(packagesDir, dir.name, "src/index.ts");
  // Resolve sub-path exports (e.g. "@poe-code/cmdkit/cli" → "packages/cmdkit/src/cli.ts")
  if (pkg.exports && typeof pkg.exports === "object") {
    for (const subpath of Object.keys(pkg.exports)) {
      if (subpath === ".") continue;
      const clean = subpath.replace(/^\.\//, "");
      const srcFile = path.join(packagesDir, dir.name, "src", `${clean}.ts`);
      workspaceAliases[`${pkg.name}/${clean}`] = srcFile;
    }
  }
  // Collect workspace package dependencies for externalization
  for (const dep of Object.keys(pkg.dependencies || {})) {
    workspaceDeps.add(dep);
  }
}

// External deps = root package.json dependencies (what users install via npm)
const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8")
);
const runtimeDeps = Object.keys(packageJson.dependencies || {}).filter(
  (dep) => !workspacePackageNames.has(dep)
);
// Externalize root deps + workspace package deps (excluding workspace packages themselves)
const allExternalDeps = new Set([...runtimeDeps, ...workspaceDeps]);
for (const pkg of workspacePackageNames) {
  allExternalDeps.delete(pkg);
}
const externalDeps = [...allExternalDeps, "node:*"];

// Plugin to strip shebangs from source files
const stripShebangPlugin = {
  name: "strip-shebang",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      let contents = await readFile(args.path, "utf8");
      if (contents.startsWith("#!")) {
        contents = contents.replace(/^#!.*\n/, "");
      }
      return { contents, loader: "ts" };
    });
  },
};

function isProviderSourceFile(filename) {
  if (!filename.endsWith(".ts")) {
    return false;
  }
  if (filename.endsWith(".d.ts")) {
    return false;
  }
  if (filename.endsWith(".test.ts")) {
    return false;
  }
  if (
    filename === "index.ts" ||
    filename === "create-provider.ts" ||
    filename === "spawn-options.ts"
  ) {
    return false;
  }
  return true;
}

async function getProviderEntryPoints(root) {
  const providersDir = path.join(root, "src", "providers");
  const entries = await readdir(providersDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isProviderSourceFile(entry.name)) continue;
    files.push(path.join(providersDir, entry.name));
  }
  return files;
}

await esbuild.build({
  entryPoints: [path.join(rootDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(rootDir, "dist/index.js"),
  external: externalDeps,
  alias: workspaceAliases,
  banner: undefined,
  sourcemap: true,
  plugins: [stripShebangPlugin],
  loader: { ".md": "text", ".mustache": "text", ".log": "text" },
});

const providerEntryPoints = await getProviderEntryPoints(rootDir);
if (providerEntryPoints.length > 0) {
  await esbuild.build({
    entryPoints: providerEntryPoints,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outdir: path.join(rootDir, "dist", "providers"),
    entryNames: "[name]",
    external: externalDeps,
    alias: workspaceAliases,
    banner: undefined,
    sourcemap: true,
    plugins: [stripShebangPlugin],
    loader: { ".md": "text", ".mustache": "text", ".log": "text" },
  });
}

// Bundle cmdkit entry points — inlines workspace packages so consumers
// don't need @poe-code/* workspace deps at runtime.
const cmdkitEntries = ["index", "cli", "mcp", "sdk", "renderer"].map((name) =>
  path.join(rootDir, "packages/cmdkit/src", `${name}.ts`)
);

await esbuild.build({
  entryPoints: cmdkitEntries,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outdir: path.join(rootDir, "packages/cmdkit/dist"),
  entryNames: "[name]",
  external: externalDeps,
  alias: workspaceAliases,
  sourcemap: true,
  plugins: [stripShebangPlugin],
});

// Rewrite @poe-code/* bare-specifier imports in cmdkit .d.ts files
// to relative paths so types resolve from the shipped tarball.
const cmdkitDtsDir = path.join(rootDir, "packages/cmdkit/dist");
const dtsFiles = (await readdir(cmdkitDtsDir)).filter((f) => f.endsWith(".d.ts"));
const dtsRewriteMap = {
  '"@poe-code/cmdkit-schema"': '"../../cmdkit-schema/dist/index.js"',
  '"@poe-code/design-system"': '"../../design-system/dist/index.js"',
  '"tiny-stdio-mcp-server"': '"../../tiny-stdio-mcp-server/dist/index.js"',
};
for (const f of dtsFiles) {
  const fp = path.join(cmdkitDtsDir, f);
  let content = await readFile(fp, "utf8");
  let changed = false;
  for (const [from, to] of Object.entries(dtsRewriteMap)) {
    if (content.includes(from)) {
      content = content.replaceAll(from, to);
      changed = true;
    }
  }
  if (changed) {
    await writeFile(fp, content);
  }
}

// Generate a CJS entry point with a Node.js version gate.
// Written in ES5 syntax so even ancient Node versions parse it and
// print a friendly error instead of crashing on modern syntax.
const wrapperPath = path.join(rootDir, "dist/bin.cjs");
const wrapper = [
  "#!/usr/bin/env node",
  versionGateSnippet("poe-code"),
  'import("./index.js").then(function (m) { m.main(); }).catch(function (err) { console.error(err); process.exit(1); });',
  "",
].join("\n");
await writeFile(wrapperPath, wrapper, { encoding: "utf8" });

const pipelineTemplateDir = path.join(rootDir, "dist", "templates", "pipeline");
const skillTemplateDir = path.join(rootDir, "dist", "templates", "skill");
const distDir = path.join(rootDir, "dist");
await Promise.all([
  mkdir(pipelineTemplateDir, { recursive: true }),
  mkdir(skillTemplateDir, { recursive: true })
]);
await Promise.all([
  copyFile(
    path.join(rootDir, "src", "templates", "pipeline", "SKILL_plan.md"),
    path.join(pipelineTemplateDir, "SKILL_plan.md")
  ),
  copyFile(
    path.join(rootDir, "src", "templates", "pipeline", "steps.yaml.mustache"),
    path.join(pipelineTemplateDir, "steps.yaml.mustache")
  ),
  copyFile(
    path.join(rootDir, "packages", "poe-agent", "src", "SYSTEM_PROMPT.md"),
    path.join(distDir, "SYSTEM_PROMPT.md")
  ),
  copyFile(
    path.join(rootDir, "packages", "agent-skill-config", "src", "templates", "poe-generate.md"),
    path.join(skillTemplateDir, "poe-generate.md")
  ),
  copyFile(
    path.join(rootDir, "packages", "agent-skill-config", "src", "templates", "terminal-pilot.md"),
    path.join(skillTemplateDir, "terminal-pilot.md")
  )
]);

await Promise.all(
  resolveGithubWorkflowAssetCopies(rootDir).map(async ({ sourceDir, targetDir, extension }) => {
    await mkdir(targetDir, { recursive: true });
    const files = (await readdir(sourceDir)).filter((file) => file.endsWith(extension));
    await Promise.all(
      files.map((file) => copyFile(path.join(sourceDir, file), path.join(targetDir, file)))
    );
  })
);

console.log("Bundle complete: dist/index.js + dist/bin.cjs");
