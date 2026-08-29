# N14 author handoff — 2026-08-29

**Author scoped pass; different Dirac review and ROOT acceptance still required.**
No coherent Node composition execution or acceptance. No native/GNU parity claim.

## Immutable source and package

- Source: `7196bace8ea2c141d5ed1020fef5bf721c321ace`, production change only
  `src/shell/runtime.ts`. No source correction after that commit.
- Base: frozen9bb91c37/derived37e793ce, not live HEAD or Node integration.
- Derived selected tree: `bf079ada185a79aec864b068f3738ddc5520822e`.
- Full selected source: **293 inputs**, SOURCE.json SHA256
  `12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4`.
- Runtime blob `df6b2c0dfad8d7412f93f434d07a20b2b9375a86`,203623 bytes, SHA256
  `4e67e4e5d1d4a0c6b9b479d4381edbab5948a7b2b292f219a46067aeee7ce058`.
- Actual full **954-member** package SHA256
  `3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49`.
  Both versioned builds produced that exact package; **two builds**, not one.
  Source, installed and physically moved package layouts were actually exercised.
- Compiled runtime SHA256
  `309c181e03e093b31a5629e441f062ee7d0cea459123d9aebd6427fd44c9f9fb`.
  The package load guard authenticated executed modules and explicit mutation
  bindings; this is not complete transitive/global execution attestation.

Derived tree reconstruction uses authenticated tree bytes and stored input blobs;
the derived hash is not asserted to be an existing Git object. Complete shipping
inputs are bound, not a full arbitrary repository checkout/archive.

## Exact behavior being fixed

Keep the private diagnostic wrapper through cancellation outcome selection.
Only a selected diagnostic is recorded privately against its exact public
invocation Promise immediately before exposing the raw rejection. Runtime's
existing return observer consumes that exact-Promise record and restores the
private fatal path. No reason equality/truthiness/public-class inference or
sticky reason map; root state closure clears the weak records.

Public invoke still rejects raw0/false/undefined. Direct catch-to-success consumes
the failure. An independent plugin throw0 stays ordinary. Catch-rethrow and
async-wrapper Promises are different identities and are **outside** this narrow
forwarding guarantee. N07/N08 observe ordinary status1/two diagnostics for those
specimens; that is not a promise of arbitrary transformed-Promise behavior.

N10 is the separately frozen author counterpart of Dirac's N14: non-async guard
registers gated cleanup throwing false, then returns EXACT invoke('f',[]) for
`f(){ printf "%s" "${absent:?required}"; }; guard`, with stderr rejecting0.
All three layouts now assert raw public reason0 and **one** diagnostic, with
registered→diagnostic→cleanup-enter→release→cleanup-finished→settled observations.
Raw identity follows the source-bound assertion, not a reconstructed serialized
error. Callerfalse still wins in N09; N11 preserves genuine ShellLimitError.
The reference novel.mjs is readonly/hash-bound in PRESEAL; the original Dirac
16-novel cohort was **not rerun here** and should be replayed independently.

## Actual results, not historical rescore

V5: **672/672 main** = **636 unchanged current author** + **36 focused**:

| Per layout | Identities | Pass |
| --- | ---: | ---: |
| Redirection v3 | 48 | 48 |
| Resolved strict mode | 50 | 50 |
| Conditional v4 | 67 | 67 |
| Resolved extension v2 | 35 | 35 |
| Arrays | 12 | 12 |
| Exact-Promise N14 protocols | 12 | 12 |

Each row ran source-built, installed and physically moved. Six strict type
groups pass, including24 expected negative diagnostics; declarations bind each
actual package. **7 loaded mutants detected +7 restored positives**, including
N14 provenance removal, and **2 package-binding refusals** pass. These are separate
roles, not added into672. Fresh publication rechecked293 source and954 moved
package hashes/modes; runner additionally guarded/restored its mutable mutant
package and source/dist artifacts.

Preserved preceding v4 attempt:212 source-layout cases and two type groups pass,
then ordinary ENOENT before N14 launch because consumer staging omitted n14.mjs.
Status remains FAILED_OR_INCOMPLETE. V5 changed only that copy list and versioned
dispatch/binding/accounting, not production or assertions. The old root was not
modified. Original6901 tool-only syntax failure,0db 4MiB DATA refusal,9bb681/684,
Dirac45/48 and original N14 failures all remain unchanged.

## Admission, execution and resource observations

Single authorized inherited DATA input:5916905 encoded bytes, Git blob
`e584cc41d956da910a5686deb979e84c2b6df796`, SHA256
`a49b8a7055ac2902d1368ddb638d62c5a1896dc9ed25c18b025816a710077509`.
Authority/mode/length were recorded before stream opening; SHA256 and Git blob
hash checked before decoding. Only its encoded ceiling is6MiB; generic4MiB input,
64MiB decompression and aggregate bounds stayed unchanged. No JSON payload dump.
Bootstrap inherited three qualified controls and freshly syntax-checked the
file-based entry; those three were bound, not rerun in v5 admission.

Executable preseal93a902b0; corrected dispatch
`fd945376d5a7d64f27155179a6ba8817b11e454e`. Actual command:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/compatibility/bash-strict-extension-author-20260829/n14-v4/launch-v5.mjs --run
```

Node22.22.2/TS5.9.3/offline scripts-disabled npm10.9.7 and exact dependency
inventories were authenticated. No product native fallback, private engine,
network, comparator, Node guest, XAN/P2 or fullgate.

- V4:10 direct children,5 loader reservations,27.520s coordinator, all closed.
- V5:44 direct children,34 loader reservations,54.749s coordinator, all closed.
- Four outer/coordinator PIDs plus54 direct children =58 observed runtime PIDs;
  loader reservations are not OS births. Zero observed RegexWorkers, signals[].
  No full descendant/PGID/kernel-drain or hard-RSS claim.
- Cumulative enforced child capture6,066,507 bytes and retained work129,708,425
  bytes before evidence publication. V5 carries V4 usage rather than resetting
  the45min clock/40-loader budget; total loader admissions39. Publication has
  separate owned data/metadata commands and retains all original roots.
- Administrative command launches are visible in tool records; their full PID
  census is not captured. Do not equate runtime58 with every OS process or count
  a reserved slot as a birth. The publication helper separately records its PID.

## Durable evidence and review entry

`results-v5/SUMMARY.json` contains actual cases/events, controls and bindings.
`results-v5/INDEX.json` binds217 retained raw entries; `RAW.json.gz` is a base64
map compressed to4,816,235 bytes, SHA256
`0538f9ebacae7b102279fc0c8c387506a8db232221cbb07073fc9859e8530234`.
Decoded JSON length17,824,436; original retained bytes13,362,435. Original raw
roots remain intact; no lossless-deletion or fresh archive roundtrip claim.

V5 work `/tmp/strict-n14-v5-author-w43M6U`, outer
`/tmp/strict-n14-v5-launch-wdOxjF`; V4 roots are in DISPATCH-v5.md. Bootstrap raw
captures and publication captures are retained separately. No AGENTS plaintext
or loose TS source snapshot was added to runtime/test discovery.

Dirac should independently replay unchanged N14 and adjacent exact/consumed/
transformed Promise cases against this precise source/package, review outcome
selection before raw unwrapping, cleanup/caller precedence and record lifetime.
Five open extension design IDs/native invocation questions remain open. This
author result does not accept a coherent Node+Unit3+Unit4 composition.
