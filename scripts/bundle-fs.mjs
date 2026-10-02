import path from "node:path";
import {
  canonicalFsProfiles,
  canonicalFsRoutes,
  canonicalFsBundledDependencies
} from "../packages/package-lint/dist/bundle-policy.js";

export function mergeRuntimeBundleOutputs(node, workerd) {
  return {
    outputFiles: [...node.outputFiles, ...workerd.outputFiles],
    metafile: {
      inputs: { ...node.metafile.inputs, ...workerd.metafile.inputs },
      outputs: { ...node.metafile.outputs, ...workerd.metafile.outputs }
    }
  };
}

export function resolveWorkerdRuntimeBuild(rootDir, graph) {
  return {
    absWorkingDir: rootDir,
    entryPoints: { workerd: path.join(rootDir, "packages/safe-js/src/workerd.ts") },
    alias: {
      ...graph.alias,
      "safe-bash-command-mcp": path.join(rootDir, "packages/safe-bash-command-mcp/src/index.browser.ts"),
      "auth-store": path.join(rootDir, "packages/auth-store/src/index.browser.ts"),
      "mcp-oauth": path.join(rootDir, "packages/mcp-oauth/src/index.browser.ts"),
      "tiny-mcp-client": path.join(rootDir, "packages/tiny-mcp-client/src/index.browser.ts"),
      "terminal-name": path.join(rootDir, "packages/terminal-name/src/index.workerd.ts")
    },
    external: graph.external,
    bundle: true,
    splitting: false,
    platform: "node",
    conditions: ["workerd"],
    target: "es2022",
    format: "esm",
    outdir: path.join(rootDir, "packages/safe-js/dist"),
    sourcemap: true,
    metafile: true,
    write: false
  };
}

export function resolveCanonicalFsBuilds(rootDir, graph, nodeEntries = {}, nativeAssets) {
  return Object.fromEntries(
    Object.entries(canonicalFsProfiles).map(([profile, settings]) => {
      const entryPoints = profile === "node" ? { ...nodeEntries } : {};
      const alias = { ...graph.alias };
      for (const route of canonicalFsRoutes) {
        const source = route.source[profile];
        const runtime = route.runtime[profile];
        if (source === null || runtime === null) continue;
        entryPoints[path.basename(runtime, ".js")] = path.join(rootDir, source);
        alias[route.workspace] = path.join(rootDir, source);
      }
      return [
        profile,
        {
          absWorkingDir: rootDir,
          entryPoints,
          alias,
          bundle: true,
          splitting: true,
          platform: profile,
          conditions: [profile],
          target: profile === "node" ? "node18.18" : "es2022",
          format: "esm",
          outdir: path.join(rootDir, settings.outdir),
          chunkNames: "chunks/[name]-[hash]",
          external: profile === "node" ? [...new Set([
            ...graph.external.filter(specifier => !canonicalFsBundledDependencies.some(dependency =>
              specifier === dependency || specifier.startsWith(`${dependency}/`))),
            ...(nativeAssets ? [nativeAssets.specifier] : [])
          ])] : [],
          sourcemap: true,
          metafile: true,
          write: false
        }
      ];
    })
  );
}
