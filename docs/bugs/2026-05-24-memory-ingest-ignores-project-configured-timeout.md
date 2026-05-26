# Memory `ingest()` ignores the documented project-configured timeout

## Summary

The memory README documents `memory.ingestTimeoutMs` under `.poe-code/config.json` as the timeout for ingest operations, but `ingest()` reads configuration from `<repo>/poe-code.json` instead of the documented project config location. An ingest operation configured with a `1` millisecond project timeout therefore continues until the spawned agent finishes rather than timing out.

## Reproduction

From the repository root, create a disposable memory project with a one-millisecond timeout and a fake default agent that sleeps before exiting:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
mkdir -p "$root/pages" "$probe/project/.poe-code" "$probe/project/docs" "$probe/bin"

cat > "$probe/project/.poe-code/config.json" <<'EOF'
{"memory":{"ingestTimeoutMs":1,"cache":{"enabled":false}}}
EOF
printf '# Memory index\n' > "$root/INDEX.md"
printf '' > "$root/LOG.md"
printf 'source\n' > "$probe/project/docs/source.md"

cat > "$probe/bin/claude" <<EOF
#!/bin/sh
/bin/sleep 0.08
touch "$probe/configured-timeout-child-finished"
exit 0
EOF
chmod +x "$probe/bin/claude"

cat > "$probe/repro.mts" <<EOF
import { ingest } from "file://$PWD/packages/memory/src/ingest.ts";
const start = Date.now();
try {
  const result = await ingest("$root", {
    source: { kind: "file", absPath: "$probe/project/docs/source.md" },
    noCacheWrite: true
  });
  console.log(JSON.stringify({ settled: "resolved", elapsed: Date.now() - start, exitCode: result.exitCode }));
} catch (error) {
  console.log(JSON.stringify({ settled: "rejected", elapsed: Date.now() - start, error: error instanceof Error ? error.message : String(error) }));
}
EOF

PATH="$probe/bin:$PATH" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
test -e "$probe/configured-timeout-child-finished" && echo child-finished

nl -ba packages/memory/README.md | sed -n '51,59p'
nl -ba packages/memory/src/ingest.ts | sed -n '51,54p;95,100p'
```

## Observed Behavior

The operation resolves only after the sleeping agent completes, and the completion marker exists:

```text
{"settled":"resolved","elapsed":395,"exitCode":0}
child-finished
```

The elapsed value varies by process startup overhead, but it is far greater than the configured `1` millisecond limit. `ingest()` passes `configuredTimeout(configOptions)` to its timeout wrapper, while `configOptions.filePath` points to `<repo>/poe-code.json`, not `<repo>/.poe-code/config.json` where the README directs users to configure `memory.ingestTimeoutMs`.

## Expected Behavior

An ingest operation without an explicit `timeoutMs` override should honor `memory.ingestTimeoutMs` from the documented project configuration file. With the one-millisecond setting above, it should reject promptly with a timeout rather than waiting for the fake agent to finish normally.

## Impact

Projects cannot enforce documented ingest execution limits through their configuration. Long-running or stuck agent operations can continue far beyond configured budgets, consuming time and resources while appearing to be governed by settings that are silently ignored.
