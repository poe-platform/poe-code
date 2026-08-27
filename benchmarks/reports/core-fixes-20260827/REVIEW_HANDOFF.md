# Bounded independent core/bytes/sort review handoff

Prepared August27,2026. Curie's author evidence is not independent review.
No new production feature or broad benchmark expansion is included here.

## Exact production revisions

| Commit | Production paths | Scope |
|---|---|---|
| b5ec52a0d3ff16da47e814729f72153f9b09b926 | src/commands/filesystem.ts; src/commands/streams.ts | realpath relative flags; GNU wc widths and explicit C counts |
| f3eb0feb320f5eaabe2524377bc49925a6bee096 | src/commands/text.ts | plain-byte sort comparator; bounded owned output chunks |
| 8bf6f43712692f54a1c8ab109853e57f95468190 | src/commands/bytes/checksums/index.ts | cksum algorithm selection and tagged hash output |

`afcea6c9a41400828c4efa538d2bc44b29481974` is a sort test typing correction,
not a production change. The four listed production files at committed
`d49d9e523b99b3464b71b06ffbdfe297e0a3cf0f` match their author commit blobs
exactly. Other owners' source changes in that snapshot are not certified here.

## Exact six-row replay, not inferred closure

`six-d49d9e5.json` records **4 pass,2 fail, zero omitted rows** on that archived
production revision using the historical harness
`0294afb6e690433aed994868e5ed437ecf58ae48`, historical environment and immutable
native-corrected expectations. All source hashes, recipes, expected/actual
bytes/status/FS assertions remain available. No dirty source is copied in.

| Frozen row | Current exact replay | Interpretation |
|---|---|---|
| command/realpath/relative | pass | relative rendering fixed |
| command/wc/words-lines | pass | GNU column width fixed |
| command/wc/unicode | pass | explicit C byte count fixed |
| command/env/clean | fail | native B then A; ours A then B; ordering profile difference remains |
| command/env/unset | fail | real inherited-variable resurrection; requires shell-integrated fix |
| command/cksum/algorithm | pass | SHA256 tagged output fixed |

The direct env order row remains a measured mismatch; no reversal, sorting,
test waiver or new expectation is proposed. The nested env row is a correctness
gap regardless of that ordering distinction. See `SAGAN_ENV_HANDOFF.md`.

Reproduce into a new filename:

```sh
node benchmarks/reports/core-fixes-20260827/replay-six.mjs \
  d49d9e523b99b3464b71b06ffbdfe297e0a3cf0f /tmp/core-six-review.json
```

The script uses native git/tar only to create disposable test snapshots; product
code does not spawn processes. It refuses to overwrite the output file.

## Bounded independent checks requested

1. Reproduce the unchanged six rows before new adversarial cases. Keep the two
   env failures distinct. Run actual Shell+agentCommands, not only injected
   execution-command unit callbacks. Do not edit frozen benchmark expectations.
2. Inspect realpath relative-to/base containment, symlink and missing targets,
   literal `--` paths, cancellation and error propagation. Review wc widths
   across stdin/multiple files/empty files, explicit C versus UTF8 and chunked
   BOM/invalid bytes. Opaque stdin lacks native descriptor metadata: document
   that limitation, not a false full GNU match.
3. Independently check cksum each supported algorithm, binary/empty/chunked input,
   filename escaping/NUL output, cancellation and bounded input consumption.
   Unsupported algorithms/check-format options must not silently succeed.
4. Verify sort byte/numeric/key/reverse/stable/unique behavior, NUL/non-UTF8 input,
   chunk ownership, awaited backpressure/cancellation and in-place VFS output.
   No change to online uniq emission. Sort still buffers bounded input and uses
   synchronous Array.sort; no external-sort or mid-comparison preemption claim.
5. Re-run the matched sort performance protocol with all order permutations and
   exact output/status/FS equality; retain before/after source hashes, repeats
   and host load. Author medians37.873→9.241ms versus baseline5.725ms mean the
   baseline is still faster. Never include mismatching workloads in a speed win.

Author native/regression evidence is in `tests/commands/core-expanded/`,
`tests/commands/core-sort/`, `tests/commands/bytes/checksums/` and CHECKPOINT.md.
The combined193/193 was a dirty-worktree run, not this frozen six-row gate.
Performance `sort/report.json` uses the intentionally isolated b5ec52a tree plus
only f3eb0fe text.ts for after; do not describe it as an entire later HEAD.
Root runtime dependencies remain zero. Different-agent source/fairness review
is pending. Fifty baseline-only names remain unmeasured; this bounded task adds
no recipes or claims for them.

## Provider documentation status

Committed `cd8b5c8025e9d40ba71594f7b709a42f5249988d`:
`src/contracts/filesystem.md`, section “Faithful forwarding of provider-owned
observations”; matching AGENTS rule and docs/PROVIDER_NAMESPACE_REVIEW.md.
Fresh query provenance and FS/path/stat-to-content binding are retained;
method-reference eligibility is not required for faithful forwarding. Remappers
and cache gateways omit/replace assertions for actual backing resources. No
fabricated disjoint scope, trust flag or race guarantee. Generic SDK/copied
metadata integration remains open. Poincare owns backend implementation and
Dirac independent acceptance; original31/38 is not relabeled qualified38/38.
