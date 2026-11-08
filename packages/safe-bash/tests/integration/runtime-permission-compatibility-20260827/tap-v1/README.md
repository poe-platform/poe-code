# Explicit TAP reporter: author handoff

August 27, 2026. Source `c800c899114c6c83b3d3eb67231176d124abaf49`.
External verifier revision only: product/config/consumer inventory remain
separately bound to8670 for any subsequent package overlay replay.

## Minimal source change

The existing `usesNodeTest` classification is moved before execution. Those
consumers gain `--test-reporter=tap` before the program pathname. No `--test`
discovery flag is added, so invocation remains the same single explicit file.
Plain runtime consumers receive their original argument vector. All permission,
worker and strict-unhandled arguments remain intact.

The complete parser/count-validation/result-recording block is byte-identical
to `774644f9`. Mandatory23 and loopback13 checks, nonzero tests, pass equality,
zero failures/cancellations/skips/TODOs remain. Empty, missing, spec or malformed
output is not converted to a pass. The original independent `8bd5baa7` 29/30
result remains historical evidence, not rewritten as a green result.

Official version-specific CLI documents describe explicit reporter selection:

```text
https://nodejs.org/download/release/v22.22.2/docs/api/cli.html#--test-reporter
https://nodejs.org/download/release/v24.11.1/docs/api/cli.html#--test-reporter
```

## Author evidence

**24/24 new executable controls**, using the exact extracted launch/count block
from the current source, not a parallel reimplementation of its parser. The
count-block SHA is preserved with the baseline comparison in the raw results.
Both actual pinned executables are checked before/after:

- Node22.22.2 SHA256
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- Node24.11.1 SHA256
  `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.

Each profile executes fixed-count23/13, constructor-classified and `.test.mjs`
programs with actual source-read and host-write denials. These are generated
fenced test bodies, not the real provider groups or23 provider successes. Plain
consumers retain no reporter option. Negative controls retain rejection for an
actual spec reporter, missing summary, synthetic zero-count transport,22 instead
of required23,12 instead of required13, an actual skipped test and an actual TODO.

**Original author26/26 also replayed unchanged**, separately captured, including
actual moved8670 public package workflows and the permission fences on22/24.
No whole suite or complete16 runtime consumer groups were executed. The prior
failed package attempt `2b26defd` remains unchanged. Independent Plato replay of
the unchanged30-case cohort is pending; this report is not acceptance.

`RECEIPT.json` authenticates source and raw outputs. All owned scratch is removed;
no private source, product, root package/config or consumer inventory is edited.
These versioned drivers are explicit opt-in, outside canonical discovery.

```sh
node tests/integration/runtime-permission-compatibility-20260827/tap-v1/controls.mjs /tmp/UNIQUE-tap-results.json
node tests/integration/runtime-permission-compatibility-20260827/controls.mjs /tmp/UNIQUE-original26-results.json
```

The approved external overlay must identify this verifier revision independently
of frozen8670 product/package/config hashes. Do not overwrite any archive script
or import a moving current consumer mapping to claim a frozen replay.
