# csvcut command task review

Reviewed the supplied working-tree CLI/SDK command, byte projection and record
engine, shared CSV engine, safe-bash export and qualified publication path on
2026-09-20. The package-pattern document is currently at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its deleted original
was not restored. Other contributors' files were preserved.

## Confirmed defect and repair

`parseCsvcutArguments` charged raw tokens encountered by its outer loop but
skipped separately supplied option values consumed with `args[++i]`. For
example, `['-c', 'x'.repeat(1024)]` succeeded with a retained allowance of 500
bytes or a work allowance of 20. The original memory-only regression failed
with “Missing expected exception.” Separately consumed values now receive the
same work and retained-allocation charges as other tokens before inspection.

The final control covers short and long column, encoding and delimiter flags,
both separate and attached/equals forms, under independently constrained work
and retention budgets. No parser abstraction or forwarding helper was added.
The command and SDK still share projection; safe-bash only re-exports the
private command package. No registration, runtime dependency or version changed.

## Review conclusions

The command is TypeScript ESM, private and has no external runtime dependencies.
Canonical argument/value/error contracts remain shared. Input acquisition uses
explicit stdin/VFS capabilities; the reviewed command adds no ambient file,
executable, network, download, native/WASM or held XAN access. Sink writes are
awaited. Cleanup registration precedes resource acquisition; cooperative pending
reads receive cancellation and input retirement is idempotent. Existing controls
exercise falsey reasons, primary failure precedence, producer storage reuse,
byte-kind admission, captured producer methods, bounded fallback reads, output
admission and option snapshots. Lifecycle helpers preserve failure precedence;
no unsupported simplification was made.

The selected compatibility release remains csvkit 2.2.0, with the documented
`utf8-sig-permissive-v1` and `csvkit-2.2.0-ascii-v1` candidate profiles.
csvcut does not call Sniffer; shared agate Sniffer requirements do not imply
automatic delimiter detection here. csvcut line numbers count emitted records;
the physical parser line-number requirement in the prompt concerns csvgrep.
No snapshot or profile migration was performed.

## Verification

- Final command workspace unit route: 94 passed, none skipped or failed.
- Final command workspace lint and source/test typechecks: passed.
- Memory-VFS shell integration: both csvcut wiring controls passed.
- Maintained root Vitest publication/private-bundle routes: 158 passed,
  including isolated canonical byte argv and strict installed declarations.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed.
- `scripts/package-safe.mjs` staged all three public artifacts successfully at
  temporary version `0.0.0-csvcut-task-review`; no private package was published.
  Task-owned staging output was removed after verification.

No CLI layout, help, normal output or diagnostic wording changed in this
accounting repair. No screenshot or native executable qualification is claimed
for this review. Historical full-suite receipts in other documents were not
rerun or represented as fresh verification.

## Unresolved blockers

1. The current maintained `npm run typecheck
   --workspace=@poe-platform/safe-bash` exits 2 before current-consumer checks.
   Its concrete diagnostic is “Public SafeFS must preserve shared SafeJS runtime
   identity”: actual root export `undefined`, expected
   `./packages/safe-js/dist/safe-fs.js`. The same issue was recorded in the
   existing engine review and was reproduced against the current manifest.
   Successful selected build and isolated declarations do not close this gate.
   The unrelated root manifest and shared check were left intact.
2. Full native compatibility remains unqualified: the implementation explicitly
   rejects quoting modes 1/2, non-UTF-8-sig codecs and native `-z` field limits;
   complete Python 3.9 malformed-input/NUL/error semantics and native argparse
   diagnostics remain open. Existing explicit profile deviations and capability
   failures cannot be described as complete csvkit compatibility.

These findings block an unconditional task-completion claim. Actual
browser/workerd/Bun qualification is also not established by Node/memfs controls.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or publication occurred.
