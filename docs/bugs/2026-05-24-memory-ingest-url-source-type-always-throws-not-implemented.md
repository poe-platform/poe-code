# Memory `ingest()` accepts URL sources in its public API but always rejects them

## Summary

The memory SDK publicly types `IngestSource` as supporting both local files and URLs, and its README states that ingest can fold a file or URL into memory. However, `ingest()` unconditionally throws `URL ingest not implemented yet.` whenever it receives the documented `{ kind: "url", url: ... }` source form, even in dry-run mode where no external fetch or agent execution is required.

## Reproduction

From the repository root, execute the exported memory implementation with a URL source in a disposable location:

```sh
repo=$PWD
probe=$(mktemp -d)

cat >"$probe/repro.mts" <<EOF
import { ingest } from "file://$PWD/packages/memory/src/ingest.ts";

try {
  await ingest("$probe/memory", {
    source: { kind: "url", url: "https://example.test/notes.md" },
    dryRun: true
  });
  console.log("ingest unexpectedly succeeded");
} catch (error) {
  console.log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/memory/src/types.ts | sed -n '71,83p'
nl -ba packages/memory/README.md | sed -n '34,39p'
nl -ba packages/memory/src/ingest.ts | sed -n '145,158p'
```

## Observed Behavior

The valid public API call exits with failure and prints:

```text
URL ingest not implemented yet.
```

The rejection is unconditional: `packages/memory/src/ingest.ts` handles only `source.kind === "file"` and throws for the remaining declared `"url"` variant before dry-run handling, cache handling, or agent execution can occur.

## Expected Behavior

Because `packages/memory/src/types.ts` exposes `{ kind: "url"; url: string }` as a supported `IngestSource` and the README states that URL ingest is supported, `ingest()` should materialize URL sources according to that contract. If URL ingest is not available, the public type and documentation should not advertise it as a valid supported source.

## Impact

SDK consumers can construct a value that TypeScript accepts as a supported memory ingest request, only to encounter a guaranteed runtime failure. Any documented workflow intended to ingest web-hosted notes or documents is unusable, and callers cannot reliably infer supported inputs from the exported API contract.
