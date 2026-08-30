# S1 binding declaration, before any candidate access

This child owns binding preparation only. The parent freeze at
`722c62f8a8e0795dc2c72509cc012a6017217c0d` and preparation at
`9d29cf908efabb7d8d840c62e969ef7bae14bcdb` remain authoritative and unchanged.
Exactly 12 logical acceptance cases, 5 positives plus 7 controls, with exactly
20 parameterized records. All are UNRUN; source identity is UNBOUND.

## Declared binding deltas (not criteria changes)

- S1 declaration bytes must hash to
  `601adc3e3844aae2b021887e4a096c08c1a1a315baa821a9ce664c19d82c6e14`.
  `createOutputOperation`, `output`, `signal`, `registerCleanup`, `acquire`,
  `child`, and `close` bind only to that declaration. The v1 public index and
  contracts declarations bind inherited types only, never new source readiness.
- S01 keeps `pending-stream | head -n 0; true`, the original pending generator,
  one-start barrier and 1200ms bound. Its NEW plugin binding creates an output
  operation before source acquisition, uses its signal/output, and shares close
  with registered cleanup/finally. Original stage-abort assertions remain in the
  separate unchanged historical replay, not the new operation-only assertion.
- S02/S03 keep `cat /input | head -n 0; true`; S04/S05 keep the original dynamic
  loopback `curl ${url} | head -n 0; true`. Historical S3/HTTP helpers are reused
  from authenticated inert archives. Product cat/curl auto-enrollment is not
  replaced. Middleware records stage state independently; the original transport
  and server-close events witness cooperative transfer closure. HTTP GET count
  is labeled server requests, never client body iterator reads.
- S06 has three distinct parameter records: a real bounded loopback upload with
  EOF opened only after server body bytes, a reused Buffer upload whose mutation
  occurs only on producer advance/finalization, and an explicit-operation plugin
  with an awaited stalled sink. Stalled-write read-ahead is one pending chunk in
  that sequential plugin, not a new global scheduler requirement.
- S07 invokes real curl using `context.invoke` under a live parent command with
  explicit stdin/stdout/stderr. A next-only borrowed-input adapter is NOT added by
  the test: the original iterable with observable return is passed unchanged.
  Closing the owned-output capability is a real destination-close event. Parent
  owner remains alive through all operation assertions; later owner return is
  separately recorded and permitted. No framing/handback assertion.
  Exact nested-public cancellation status/stderr is not declared by S1; those
  two records are BLOCKED for pass classification pending an authoritative
  pre-execution profile, rather than guessing exit 0 or 141.
- S08 uses real nested curl argv, not transport substitutions. File/header and
  writeout variants retain required effects after stdout closes. Parent-command
  independent stderr/file effects are asserted positively and before its normal
  finalization. Header-file variant withholds body until stdout closure, so a
  request cannot silently disappear before required headers are published.
  The frozen stdout-writeout destination is NOT rerouted to stderr to manufacture
  observable bytes. S1 does not specify how required writeout retention is to be
  observed after that destination closes. The two writeout records need a precise
  authoritative observation binding; all three mixed records also need exact
  nested public status/stderr profiles. They remain BLOCKED, not weakened passes.
- S09/S10 use real registry execution of explicit operation trees with synchronous
  cleanup registration, deterministic admission/drain gates and independent
  sibling file/stderr effects. Close calls share completion behavior; promise
  reference identity is not required. Late acquisition must not start.
- S11 reason-zero uses the historical public caller-rejection identity contract.
  The two IO interleavings are BLOCKED for pass classification: S1 says existing
  public error/pipefail behavior is unchanged but supplies no exact diagnostic,
  exit/rejection, or pipefail profile. No author implementation may supply the
  missing expectation retrospectively. Fresh executor needs root-authenticated
  existing contract profiles, frozen in a separate binding supplement before
  execution. These records must not disappear from the denominator.
- S12 uses real nested command invocation and an externally controlled opaque
  next promise. It records settlement phases rather than demanding universal
  preemption. The fixture resolves/rejects only after the pre-release observation;
  teardown release is never a product pass. An independent parent owner is alive
  while return counts are measured.

## Reconstruction and execution boundaries

Preparation uses Node builtins only. Executable new driver and historical TS
copies exist only in a fresh `/tmp/safe-bash-owned-output-streaming-binding-*`.
The repository contains inert code archives. The preparation helper never imports
or runs product or the driver; only `node --check` is used on the reconstructed
driver. Historical fixture bodies remain byte-identical; a future authenticated
public-export facade at their original relative import location binds the same
candidate after root's execution gate. No facade or readiness is made in prep.

Future execution requires root's fresh-executor authorization, actual author
closure evidence (not an author claim), new immutable streaming-ready bytes,
source/patch/test/helper/build/tool identities and candidate export entry. All
are UNBOUND now. Required facade/tsx prerequisites are likewise UNBOUND. The
driver's identity checks are mechanical checks of root-supplied evidence, not
independent proof of a human attestor or readiness. Nothing is polled.

Original-five historical replay retains its exact commands, barrier, stage
assertions, 1200ms inner and 3000ms/1MiB child bounds. Original wrapper is archived
unchanged; the separate runner selects just the original five, not its other 20
scenarios. Same-source 57+9 replay is planned separately, not counted here. Optional
sealed-v2 EOF negative control is separate, not acceptance and never promotion.
Historical baseline 0/5, previous 1/5, new-seven 3/7, native 0/7/141, and old16
initial 15/16 versus corrected 16/16 and every failed profile remain untouched.
D01 is not ordinary curl acceptance; D02/D03/D07 are not top-level-owner bugs.
