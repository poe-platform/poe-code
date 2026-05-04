import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
  // Resolve sub-path exports (e.g. "toolcraft/cli" → "packages/toolcraft/src/cli.ts")
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

const mainBuild = await esbuild.build({
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
  metafile: true,
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

// Bundle memory into a single esm file so consumers of poe-code/memory
// don't need @poe-code/* workspace deps at runtime.
await esbuild.build({
  entryPoints: [path.join(rootDir, "packages/memory/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(rootDir, "packages/memory/dist/index.js"),
  external: externalDeps,
  alias: workspaceAliases,
  sourcemap: true,
  plugins: [stripShebangPlugin],
});

// Rewrite workspace specifiers in shipped .d.ts files so the published
// tarball can resolve types without @poe-code/* in node_modules. The
// rewrites target memory itself plus the two sibling dists whose public
// types transitively reference @poe-code/config-mutations.
async function rewriteDts(dir, rewriteMap) {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await rewriteDts(abs, rewriteMap);
        return;
      }
      if (!entry.name.endsWith(".d.ts")) return;
      let content = await readFile(abs, "utf8");
      let changed = false;
      for (const [from, to] of Object.entries(rewriteMap)) {
        if (content.includes(from)) {
          content = content.replaceAll(from, to);
          changed = true;
        }
      }
      if (changed) {
        await writeFile(abs, content);
      }
    })
  );
}

await rewriteDts(path.join(rootDir, "packages/memory/dist"), {
  '"@poe-code/agent-mcp-config"': '"../../agent-mcp-config/dist/index.js"',
  '"@poe-code/agent-skill-config"': '"../../agent-skill-config/dist/index.js"',
  '"@poe-code/config-mutations"': '"../../config-mutations/dist/index.js"',
  '"tiny-stdio-mcp-server"': '"../../tiny-stdio-mcp-server/dist/index.js"',
});
for (const pkg of ["agent-mcp-config", "agent-skill-config"]) {
  await rewriteDts(path.join(rootDir, "packages", pkg, "dist"), {
    '"@poe-code/config-mutations"': '"../../config-mutations/dist/index.js"',
  });
}

// tokenfill is inlined into memory's bundle and resolves its corpus via
// import.meta.url, so the corpus must sit next to packages/memory/dist/index.js.
await cp(
  path.join(rootDir, "packages", "tokenfill", "src", "corpus"),
  path.join(rootDir, "packages", "memory", "dist", "corpus"),
  { recursive: true }
);

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
const binDir = path.join(distDir, "bin");
await Promise.all([
  mkdir(binDir, { recursive: true }),
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
  ),
  // tokenfill resolves its built-in corpus via import.meta.url, so after
  // bundling the directory must sit next to dist/index.js.
  cp(
    path.join(rootDir, "packages", "tokenfill", "src", "corpus"),
    path.join(distDir, "corpus"),
    { recursive: true }
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

// Verify every external static import in dist/index.js is declared in root
// dependencies (or is a Node built-in). Missing deps would only surface
// as ERR_MODULE_NOT_FOUND when the published package is installed.
// Dynamic imports are skipped: those are guarded at the call site (e.g.
// optional peerDependencies surfaced via try/catch with a friendly message).
const externalImports = new Set();
for (const meta of Object.values(mainBuild.metafile.outputs)) {
  for (const imp of meta.imports ?? []) {
    if (imp.external && imp.kind !== "dynamic-import") {
      externalImports.add(imp.path);
    }
  }
}
const rootDepNames = new Set(Object.keys(packageJson.dependencies || {}));
const nodeBuiltins = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http",
  "https", "net", "os", "path", "process", "readline", "stream", "string_decoder",
  "timers", "tls", "tty", "url", "util", "vm", "zlib"
]);
function toPackageName(specifier) {
  if (specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}
const undeclared = [...externalImports]
  .map(toPackageName)
  .filter((dep) => dep && !rootDepNames.has(dep) && !nodeBuiltins.has(dep));
if (undeclared.length > 0) {
  console.error(
    `\nBundle imports packages not declared in root dependencies:\n  ${undeclared.join("\n  ")}\n\nAdd them to package.json "dependencies" so end users get them on install.`
  );
  process.exit(1);
}

console.log("Bundle complete: dist/index.js + dist/bin.cjs");
