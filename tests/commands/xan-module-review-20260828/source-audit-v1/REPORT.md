# Pinned XAN source audit v1

**Bounded static review; no runtime acceptance.** Three source-demonstrated
accounting/scheduling defects are recorded below. All 18 frozen cap recipes have
individual entries in `AUDIT.json`; none is an executed pass. Frozen 88 references,
12 families, 18 recipes, seven ratifications and 36 selectors remain unchanged.

## Authority and chronology

- Freeze `55810d4aea70fadf151c2fbf746a17f96bfeb599`; accepted policy
  `1168432e12568e63ff307e92ed83d64d78a03a3c`, selector sections 2–4 at
  `5b27c32b941315247bf5dca7b20faf2a9aca6d48`.
- Candidate `0ec84fc38c3fafd75776d80148d4f3c2d77e6247`, **only its ten XAN
  TypeScript modules** over base `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
  The complete candidate tree contains other changes and is not the composition.
- `4ec398bc4ae2bbbc15eb0a63b796192619087e9d0e25b8c87524ac7dff9f7df0`
  is the composed **inventory** SHA256, not an archive hash. Its 225 entries are
  checked against pinned Git bytes, without materializing or running a product.
- Author handoff/MANIFEST at `01f8826628b6ba070498e6b833f9a1597d2db375`
  are provenance, not independent acceptance or an authenticated archive replay.
- Rules/pinned-contract inspection observed `2026-08-28T06:10:20Z`; first
  candidate implementation-content inspection `2026-08-28T06:11:03Z`.
  This is after candidate/author release and preparation seal, and after another
  reviewer inspected source. No pre-candidate/blind/first-review claim.

`PINNED-INPUTS.json` binds exact paths, revisions, blobs, SHA256s and byte lengths.
`AUDIT.json` line references resolve through those IDs. No mutable HEAD source,
installed build, private checkout or native engine supplies the findings.

## Findings — reproductions UNEXECUTED

### SA-01: missing repeated-scan/output work charges

`src/commands/xan/selector.ts:8` runs numeric regex, leading-zero replacement and
BigInt parsing without receiving a Budget. Earlier argument/token inspection does
not pay for repeated inspections required by DESIGN:461–466. At selector:34–36,
one work unit precedes a doubled-quote lookahead and two-character advance. The
diagnostic path at index:48–61 charges sizing, encoding and copying but omits the
separate output-byte charge used for ordinary output at io:155–156.

Small proposed probes: a 4096-zero numeric selector, then a short quoted-pair
selector, with independently enumerated lowered work limits. Do not invent a
debug/trace hook or treat the synthetic work events as real operations. The
ordinary `count` over `a\n` has an implemented explicit-call ledger of 15 units
(5 argv + 2 input + 2 text-size + 2 encode-size + 2 encode + 2 output); limits
14/15 offer a small counter-path calibration only, not an all-path proof.

### SA-02: output line string omitted from simultaneous retention

`src/commands/xan/commands.ts:204` constructs the display line before calling
Writer.text. That string remains live across text sizing/encoding; writer:74–78
and budget:47–64 admit the encoded bytes but never the new UTF-16 string.
DESIGN:468–477 explicitly requires pre-admission of live strings at two bytes per
UTF-16 unit, regardless of a JavaScript engine's rope representation.

**UNEXECUTED witness:** module factory with `maxRetainedBytes: 33000`, argv
`['headers', '-j']`, one borrowed input header of 4096 ASCII `a` bytes and LF,
ordinary awaited sink, no output file. The source-derived ledger is:

| Stage | Logical bytes |
|---|---:|
| Scanner + row + cell + header + name-entry metadata | 160 |
| Raw and decoded capacities | 8192 |
| Name and display strings | 16384 |
| Persistent subtotal before line creation | 24736 |
| Largest earlier explicit hold (sanitize join) | 32960 |
| Explicit subtotal with 4097-byte encoded line | 28833 |
| Missing 4097-unit line string | 8194 |
| Required simultaneous lower bound during encoding | **37027** |

Thus the source path admits all explicit holds below 33000 but omits a live
string that takes the required lower bound above it. This is static arithmetic,
not an allocation trace, observed stdout or an RSS claim. A single 4 KiB probe
can confirm the external behavior; no large benchmark is needed.

### SA-03: cooperative yield gap

`budget.work` checks existing cancellation but does not yield; only checkpoint
uses setImmediate. At selector:36, doubled-quote `continue` bypasses checkpoint.
A selector with 65537 doubled pairs (131076 bytes including exterior quotes),
under permitted selector/argument overrides, therefore performs 65537 charged
iterations without a checkpoint. Header whitespace trim at commands:107–108 has
the same omission; a 65537-space header reaches it within default size caps.
Wildcard mismatches at selector:99 return before the inner checkpoint while
selector:144–147 has none. Already-aborted signal checks are not the cooperative
yield needed to let a host timer deliver cancellation.

These paths contradict the 65536-work-unit yield requirement. They do not prove
a measured deadline or authorize interruption of opaque host work. Suggested
runtime follow-up is one bounded timer/caller-abort control; do not fabricate
per-phase timer attribution without an existing observation point.

## Reachability, not synthetic acceptance

- Synthetic node targets 5/7 are generator-specific: against header `0`, selectors
  `0[0],0` and `0[0],0,0` cost respectively 3+2 and 3+2+2 nodes. The frozen recipe
  explicitly permits numeric/occurrence structures. No original capture is changed.
- Synthetic output targets 11/13 are generator-specific: `select 0,0,1` over
  `h,z\na,\n` yields 6+5 bytes; over `h,z\na,bb\n` yields 6+7. These are static
  proposed input/output arithmetic, not fabricated raw captures.
- Complete selector maxima 1/3 are genuinely unattainable in the bounded grammar.
  Configured depth 1 is legal but a depth-2 selector refuses; config 3 is invalid.
- Prescribed hard recipes have real dependencies: headers `-j` file recipes cap
  at 258 args; one-selector argv-byte recipes cap at 262150 bytes; repeated numeric
  selected-column lists cap at 32768 positions under the 65536-node ceiling.
  Other legal forms do not silently replace those frozen recipes.
- Default/hard input, chunk, record, cell, column, row and ring targets have source
  paths with the explicit overrides in AUDIT. No 60-second/default-scale run,
  hard-scale run or exact full-work/live-capacity boundary is certified.

## Resource/security qualifications

Static support: one invocation Budget, safe-integer validation, checked bigint
numeric conversions, full delivery charging including empty chunks/read-ahead,
owned CSV copies before producer advancement, per-file BOM state, zero-tail versus
ordinary-zero separation, guarded metadata before content/publication, distinct
file/stdout/stderr scopes, actual `wx` versus `w` with no fallback downgrade,
old+new Bytes growth and fallback segments+assembly admission.

All require actual effects/settlement controls before acceptance. Input cleanup is
registered before acquisition and drains registered cooperative returns; an
uncooperative return can delay it. Opaque pending next/stat/write work is observed,
not universally drained or preempted. Caller reasons, escaping sink errors and
cleanup failure precedence need actual Shell checks, not only a stub host.

Identity relies on complete truthful scoped stats or compareObservedEntries;
wrappers/copy-up hosts must bind authority to the content target. Unknown identity,
borrowed stdin with existing output, dangling output links and raced conditional
creation remain distinct cases. No lease, transaction, ABA defense, rollback,
ambient permission workaround or deployed-provider guarantee follows.

Local output reservations include file/stdout/stderr. Baseline Shell parent caps
are on sinks, not an exposed universal VFS quota. A reading that demands parent
sink-budget pre-admission for every direct `-o` write has no such baseline hook;
root must reconcile that interpretation, not invent instrumentation. Parent
diagnostic rejection can escape instead of a status-1/no-stderr result. Preserve
inherited failure rules and have the executor capture the actual outcome.

Capacity accounting also over-reserves dropped prefix endpoints and shifted argv
selector slots; some temporary string/collection storage is not explicitly held.
These qualifications are not a replacement for SA-02 or a complete omission list.

## Validation and stop

Only Git reads, static text inspection, JSON/hash/arithmetic/inventory checks and
owned-artifact whitespace checks occur. `verify.mjs` is a read-only artifact
verifier: it never imports product code or runs builds, compilers, tests, native
oracles, network or dependency installers. Hash-only composition verification is
not semantic inspection of all 211 baseline source files. It re-enumerates the
owned audit directory, detecting added files as well as changes/removals; it is
not a concurrent mutation sandbox or a whole-worktree integrity gate.

`SEAL.json` hashes the report, audit, input manifest and verifier. Its own Git blob
and the final commit seal it without circular self-hashing. All paths are within
the assigned `source-audit-v1` directory; other review/runtime/config/product files
are read-only. Stop here: runtime execution and any future repair belong to their
separately assigned owners.
