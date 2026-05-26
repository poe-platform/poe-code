# Memory `ingest()` reports timeout while its agent continues mutating memory

## Summary

When `ingest()` reaches an explicit timeout, it rejects with a timeout error but does not abort or terminate the spawned agent. The timed-out agent continues executing after the caller receives failure and can still write files beneath the memory root, creating post-timeout side effects that the API no longer observes or reports.

## Reproduction

From the repository root, create an isolated memory fixture and a fake default agent that waits, then writes a page and a marker:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
mkdir -p "$root/pages" "$probe/project/docs" "$probe/bin"
printf '# Memory index\n' > "$root/INDEX.md"
printf '' > "$root/LOG.md"
printf 'source\n' > "$probe/project/docs/source.md"

cat > "$probe/bin/claude" <<EOF
#!/bin/sh
/bin/sleep 0.08
touch "$probe/explicit-timeout-child-finished"
printf 'late page\n' > "$root/pages/late.md"
exit 0
EOF
chmod +x "$probe/bin/claude"

cat > "$probe/repro.mts" <<EOF
import { ingest } from "file://$PWD/packages/memory/src/ingest.ts";
const start = Date.now();
try {
  await ingest("$root", {
    source: { kind: "file", absPath: "$probe/project/docs/source.md" },
    timeoutMs: 1,
    noCacheWrite: true
  });
  console.log(JSON.stringify({ settled: "resolved", elapsed: Date.now() - start }));
} catch (error) {
  console.log(JSON.stringify({ settled: "rejected", elapsed: Date.now() - start, error: error instanceof Error ? error.message : String(error) }));
}
EOF

PATH="$probe/bin:$PATH" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
/bin/sleep 0.12
test -e "$probe/explicit-timeout-child-finished" && echo child-finished-after-rejection
test -e "$root/pages/late.md" && echo page-written-after-rejection

nl -ba packages/memory/src/ingest.ts | sed -n '89,111p'
```

## Observed Behavior

The API promptly reports timeout, but the fake agent subsequently completes its side effects:

```text
{"settled":"rejected","elapsed":9,"error":"ingest timed out after 1ms"}
child-finished-after-rejection
page-written-after-rejection
```

The timeout wrapper only rejects a `Promise.race`-style timer path; it provides no abort signal to `spawn()` and calls no cancellation operation. `ingest()` also reconciles before throwing the timeout error, so writes performed after that reconciliation are left outside its returned failure/reporting path.

## Expected Behavior

Timing out an ingest operation should cancel or terminate the in-flight agent before the API reports completion, or otherwise guarantee that it cannot continue modifying memory after the timeout result is delivered.

## Impact

A caller can receive a failed/timed-out ingest result while memory is modified later by an uncontrolled background agent process. This breaks timeout safety, creates race conditions with subsequent operations, and makes the memory state diverge from the operation result presented to users or automation.
