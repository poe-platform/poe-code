import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { versionGateSnippet } from "./node-version-gate.mjs";
import { resolveGithubWorkflowAssetCopies } from "./bundle-assets.mjs";
import { assertSafeBundleOutputs, assertSafeOutputDirectory } from "./guard-package-dist.mjs";
import { resolveBundleGraph, resolveConsumerGraph } from "./bundle-graph.mjs";
import { resolveCanonicalFsBuilds } from "./bundle-fs.mjs";
import {
  canonicalFs,
  collectCanonicalDeclarations,
  collectPackageFiles,
  findBundleIssues
} from "../packages/package-lint/dist/bundle-policy.js";
import { publishBundleOutputs } from "./publish-bundle.mjs";
import { setBinExecutable } from "./set-bin-executable.mjs";
import { rewriteWorkspaceDts } from "./rewrite-workspace-dts.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");

await assertSafeBundleOutputs(rootDir);

// Read every workspace package.json once, then compute the shared esbuild
// graph (source aliases + externals) from the bundle-graph helper.
const packagesDir = path.join(rootDir, "packages");
const workspaceDirs = await readdir(packagesDir, { withFileTypes: true });
const packageJsons = [];
for (const dir of workspaceDirs.filter((d) => d.isDirectory())) {
  let pkgContents;
  try {
    pkgContents = await readFile(path.join(packagesDir, dir.name, "package.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  const pkg = JSON.parse(pkgContents);
  packageJsons.push({ dir: dir.name, pkg });
}

const {
  alias: workspaceAliases,
  external: externalDeps,
  workspacePackageNames
} = await resolveBundleGraph(rootDir, packageJsons);
const consumerBuildOptions = {
  ...resolveConsumerGraph({ alias: workspaceAliases, external: externalDeps }, canonicalFs),
  absWorkingDir: rootDir,
  metafile: true
};
const consumerBuilds = [];

// Root package.json is reused below to verify external imports are declared.
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));

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
  }
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
  ...consumerBuildOptions,
  banner: undefined,
  sourcemap: true,
  plugins: [stripShebangPlugin],
  loader: { ".md": "text", ".mustache": "text", ".log": "text" },
  metafile: true
});

consumerBuilds.push(mainBuild);

consumerBuilds.push(
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/agent.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: path.join(rootDir, "dist/agent.js"),
    ...consumerBuildOptions,
    sourcemap: true,
    plugins: [stripShebangPlugin],
    loader: { ".md": "text", ".mustache": "text", ".log": "text" }
  })
);

consumerBuilds.push(
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/credentials.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: path.join(rootDir, "dist/credentials.js"),
    ...consumerBuildOptions,
    sourcemap: true,
    plugins: [stripShebangPlugin]
  })
);

for (const entryPoint of ["config", "config-testing"]) {
  consumerBuilds.push(
    await esbuild.build({
      entryPoints: [path.join(rootDir, `src/${entryPoint}.ts`)],
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      outfile: path.join(rootDir, `dist/${entryPoint}.js`),
      ...consumerBuildOptions,
      sourcemap: true,
      plugins: [stripShebangPlugin]
    })
  );
}

consumerBuilds.push(
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/skills.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: path.join(rootDir, "dist/skills.js"),
    ...consumerBuildOptions,
    sourcemap: true,
    plugins: [stripShebangPlugin],
    loader: { ".md": "text", ".mustache": "text", ".log": "text" }
  })
);

const providerEntryPoints = await getProviderEntryPoints(rootDir);
if (providerEntryPoints.length > 0) {
  consumerBuilds.push(
    await esbuild.build({
      entryPoints: providerEntryPoints,
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      outdir: path.join(rootDir, "dist", "providers"),
      entryNames: "[name]",
      ...consumerBuildOptions,
      banner: undefined,
      sourcemap: true,
      plugins: [stripShebangPlugin],
      loader: { ".md": "text", ".mustache": "text", ".log": "text" }
    })
  );
}

await assertSafeOutputDirectory(path.join(rootDir, "packages/safe-js"));
const safejsEntryPoints = {
  index: path.join(rootDir, "packages/safe-js/src/index.ts"),
  core: path.join(rootDir, "packages/safe-js/src/core.ts"),
  cli: path.join(rootDir, "packages/safe-js/src/cli.ts")
};
const fsBuildOptions = resolveCanonicalFsBuilds(
  rootDir,
  { alias: workspaceAliases, external: externalDeps },
  safejsEntryPoints
);
const fsBuilds = {};
for (const [profile, options] of Object.entries(fsBuildOptions)) {
  const result = await esbuild.build(options);
  await publishBundleOutputs(result, {
    outdir: options.outdir,
    entryPoints: Object.values(options.entryPoints),
    workingDirectory: rootDir
  });
  fsBuilds[profile] = result;
}
await setBinExecutable(path.join(rootDir, "packages/safe-js"));

// Bundle memory into a single esm file so consumers of poe-code/memory
// don't need @poe-code/* workspace deps at runtime.
consumerBuilds.push(
  await esbuild.build({
    entryPoints: [path.join(rootDir, "packages/memory/src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: path.join(rootDir, "packages/memory/dist/index.js"),
    ...consumerBuildOptions,
    sourcemap: true,
    plugins: [stripShebangPlugin]
  })
);

// The superintendent MCP entry is shipped as a root bin, so inline its
// private workspace dependencies instead of requiring them from the install.
consumerBuilds.push(
  await esbuild.build({
    entryPoints: [path.join(rootDir, "packages/superintendent/src/mcp.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: path.join(rootDir, "packages/superintendent/dist/mcp.js"),
    ...consumerBuildOptions,
    sourcemap: true,
    plugins: [stripShebangPlugin],
    loader: { ".md": "text", ".mustache": "text", ".log": "text" },
    banner: { js: "#!/usr/bin/env node" }
  })
);

for (const { entryPoint, outfile } of [
  {
    entryPoint: "packages/tiny-oauth-test-server/src/cli.ts",
    outfile: "packages/tiny-oauth-test-server/dist/cli.js"
  },
  {
    entryPoint: "packages/tiny-stdio-mcp-test-server/src/cli.ts",
    outfile: "packages/tiny-stdio-mcp-test-server/dist/cli.js"
  }
]) {
  consumerBuilds.push(
    await esbuild.build({
      entryPoints: [path.join(rootDir, entryPoint)],
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      outfile: path.join(rootDir, outfile),
      ...consumerBuildOptions,
      sourcemap: false,
      plugins: [stripShebangPlugin],
      loader: { ".json": "json" },
      banner: { js: "#!/usr/bin/env node" }
    })
  );
}

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
  '"tiny-stdio-mcp-server"': '"../../tiny-stdio-mcp-server/dist/index.js"'
});
for (const pkg of ["agent-mcp-config", "agent-skill-config"]) {
  await rewriteDts(path.join(rootDir, "packages", pkg, "dist"), {
    '"@poe-code/config-mutations"': '"../../config-mutations/dist/index.js"'
  });
}

await rewriteWorkspaceDts(path.join(rootDir, "dist"), packageJsons, { rootDir, profile: "node" });
for (const { dir } of packageJsons) {
  await rewriteWorkspaceDts(path.join(rootDir, "packages", dir, "dist"), packageJsons, {
    rootDir,
    profile: "node"
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
  ""
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
  copyFile(
    path.join(rootDir, "packages", "experiment-loop", "src", "config", "default-instructions.md"),
    path.join(distDir, "default-instructions.md")
  ),
  copyFile(
    path.join(rootDir, "packages", "experiment-loop", "src", "config", "default-run.yaml"),
    path.join(distDir, "default-run.yaml")
  ),
  // tokenfill resolves its built-in corpus via import.meta.url, so after
  // bundling the directory must sit next to dist/index.js.
  cp(path.join(rootDir, "packages", "tokenfill", "src", "corpus"), path.join(distDir, "corpus"), {
    recursive: true
  })
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

const metafile = {
  inputs: Object.assign({}, ...consumerBuilds.map((result) => result.metafile.inputs)),
  outputs: Object.assign(
    {},
    ...consumerBuilds.map((result) => result.metafile.outputs),
    ...Object.values(fsBuilds).map((result) => result.metafile.outputs)
  ),
  canonicalBundle: {
    entryPoints: Object.values(fsBuildOptions.node.entryPoints).map((entry) =>
      path.relative(rootDir, entry).split(path.sep).join("/")
    ),
    metafile: fsBuilds.node.metafile
  },
  browserCanonicalBundle: {
    entryPoints: Object.values(fsBuildOptions.browser.entryPoints).map((entry) =>
      path.relative(rootDir, entry).split(path.sep).join("/")
    ),
    metafile: fsBuilds.browser.metafile
  },
  ...(await collectCanonicalDeclarations(rootDir, {
    readdir: (directory) => readdir(directory, { withFileTypes: true }),
    readFile: (filename) => readFile(filename, "utf8")
  }))
};
const packedFiles = await collectPackageFiles(rootDir, packageJson.files, {
  readdir: (directory) => readdir(directory, { withFileTypes: true }),
  stat
});
const issues = findBundleIssues(packageJson, workspacePackageNames, metafile, packedFiles);
if (issues.length)
  throw new Error(
    `Bundle publication policy failed:\n${issues.map((issue) => `${issue.external}: ${issue.reason}`).join("\n")}`
  );
await writeFile(path.join(rootDir, "dist/metafile.json"), JSON.stringify(metafile));

console.log("Bundle complete: dist/index.js + dist/bin.cjs");
