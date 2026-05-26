# Memory `ingest()` ignores documented project cache configuration

## Summary

The memory README documents `memory.cache.enabled` under `.poe-code/config.json`, and the configuration package supports merged global/project memory settings. However, `ingest()` constructs its config reader with `<repo>/poe-code.json` and no project config path. A project setting of `{ "memory": { "cache": { "enabled": false } } }` is ignored, causing ingest to reuse cached results despite the documented opt-out.

## Reproduction

From the repository root, create a disposable project with cache disabled in its documented project config and a matching cached ingest result:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/memory/pages" "$probe/project/docs" "$probe/project/.poe-code"

cat > "$probe/project/.poe-code/config.json" <<'EOF'
{
  "memory": {
    "cache": { "enabled": false }
  }
}
EOF

printf '# Memory index\n' > "$probe/project/.poe-code/memory/INDEX.md"
printf '' > "$probe/project/.poe-code/memory/LOG.md"
printf 'input body\n' > "$probe/project/docs/source.md"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { ingest, INGEST_PROMPT_VERSION } from "file://$PWD/packages/memory/src/ingest.ts";
import { computeIngestKey, writeCacheEntry } from "file://$PWD/packages/memory/src/cache.ts";

const root = "$probe/project/.poe-code/memory";
const sourcePath = "$probe/project/docs/source.md";
const key = computeIngestKey({
  sourceBytes: await readFile(sourcePath),
  indexMdBytes: await readFile(root + "/INDEX.md"),
  promptTemplateVersion: INGEST_PROMPT_VERSION,
  agentId: "claude-code"
});

await writeCacheEntry(root, {
  key,
  ingestedAt: "2026-05-24T00:00:00.000Z",
  sourceLabel: sourcePath,
  diff: { created: ["pages/cached.md"], updated: [], deleted: [] },
  exitCode: 0,
  durationMs: 1,
  memoryTokens: 1,
  sourceTokens: 1,
  promptTemplateVersion: INGEST_PROMPT_VERSION,
  agentId: "claude-code"
});

const result = await ingest(root, {
  source: { kind: "file", absPath: sourcePath },
  dryRun: true
});

console.log(JSON.stringify(result));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/memory/README.md | sed -n '49,62p'
nl -ba packages/memory/src/ingest.ts | sed -n '47,68p'
```

## Observed Behavior

Despite `.poe-code/config.json` explicitly disabling memory cache usage, `ingest()` returns a cache hit:

```json
{"diff":{"created":[],"updated":[],"deleted":[]},"exitCode":0,"durationMs":0,"cacheHit":true,"tokens":{"memoryTokens":0,"sourceTokens":0,"reductionRatio":0,"missingSources":[]}}
```

The cause is visible in `packages/memory/src/ingest.ts`: it reads configuration using `filePath: path.join(inferRepoRoot(root), "poe-code.json")`, rather than the documented project configuration file at `<repo>/.poe-code/config.json` or merged global/project paths used by `resolveConfiguredMemoryRoot()`.

## Expected Behavior

`ingest()` should honor `memory.cache.enabled` configured in the documented `.poe-code/config.json` project file. With caching disabled, an existing cache entry should not be returned as a hit and dry-run should proceed to render the prospective ingest prompt without spawning or mutating state.

## Impact

Projects cannot reliably disable ingest-cache reads through their documented configuration. Stale cached results may silently replace current ingest evaluation, undermining repeatability and making memory refresh behavior differ from the user's configured policy.
