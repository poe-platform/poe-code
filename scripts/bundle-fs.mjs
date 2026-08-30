import path from "node:path";
import {
  canonicalFsProfiles,
  canonicalFsRoutes
} from "../packages/package-lint/dist/bundle-policy.js";

export function resolveCanonicalFsBuilds(rootDir, graph, nodeEntries = {}) {
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
          external: profile === "node" ? graph.external : [],
          sourcemap: true,
          metafile: true,
          write: false
        }
      ];
    })
  );
}
