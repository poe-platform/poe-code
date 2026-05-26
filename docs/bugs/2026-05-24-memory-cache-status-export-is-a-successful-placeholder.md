# Exported memory cache-status operation succeeds without inspecting cache entries

## Summary

The memory package documents `memory cache status` as inspecting ingest-cache entries and publicly exports `runMemoryCacheStatus()`, but that operation accepts no memory root, reads no cache data, prints `cache status not implemented yet`, and resolves successfully. Consumers receive a successful no-op placeholder instead of the advertised cache status operation.

## Reproduction

From the repository root, create a disposable cache entry and invoke the exported status helper:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/memory/.cache/ingest"

printf '%s\n' '{"key":"one","ingestedAt":"2026-05-24T00:00:00.000Z","sourceLabel":"doc","diff":{"created":[],"updated":[],"deleted":[]},"exitCode":0,"durationMs":1,"memoryTokens":2,"sourceTokens":3,"promptTemplateVersion":"v1","agentId":"claude-code"}' \
  > "$probe/memory/.cache/ingest/one.json"

cat >"$probe/repro.mts" <<EOF
import { runMemoryCacheStatus } from "file://$PWD/packages/memory/src/cache.cli.ts";
await runMemoryCacheStatus();
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/memory/README.md | sed -n '39,42p'
nl -ba packages/memory/src/index.ts | sed -n '43,45p'
nl -ba packages/memory/src/cache.cli.ts | sed -n '1,22p'
```

## Observed Behavior

The exported operation exits with status `0` and prints only:

```text
cache status not implemented yet
```

It produces the same output regardless of whether ingest-cache entries exist. The implementation has no `root` input and performs no read of `.cache/ingest/`; it is an unconditional successful placeholder.

## Expected Behavior

An exported operation documented as inspecting ingest-cache entries should accept or resolve the memory root and report actual cache status. If cache status is not implemented, the package should not expose it as a working operation or resolve successfully as though it completed the requested inspection.

## Impact

SDK integrations cannot determine cache contents through the documented/exported cache-status surface. The successful exit status can also mislead automation or agents into treating a missing implementation as a completed status check, hiding stale or unexpectedly large ingest cache state.
