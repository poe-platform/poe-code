# Independent bounded acceptance of helper456

## Decision and frozen inputs

Accept the helper correction for the measured serialized Memory-backed consumer
profile. No additional in-profile helper defect was found. This is not acceptance
of a full XML/WebDAV server, all providers, a whole release, superiority, or a
72-hour duration claim. This leaf performed the investigation and verification
without delegating it to the helper author or another worker.

- Exact helper candidate: `456a0738b0d2dc130ebbd9b7ccf5e299bcf177da`.
- Exact original failed source: `02a78bf64c29dedcd69071551ed5848b0765c107`.
- Exact before-fix comparison: `96e051e81312c7d33d8f4f5078efa09a4dd87947`.
- Independently frozen HEAD at replay: `8e1298b02966a1a2344d81c04f3eddd906828682`.
- Read CURRENT AGENTS, author HANDOFF/README/runner, helper diff, original tests,
  production readback and the separate real-service report before evaluating.

The last commit is HEAD only at the recorded invocation, not a claim about future
HEAD. Candidate source/configuration/consumer inputs come from git archive, not
working overlays. The newly authored verifier was working-tree code during the
replays; its exact hashes are sealed and committed with this report. Existing
unrelated working changes and staging are outside this patch.

## Executed results

All counts below have zero cancelled, skipped or TODO tests.

| Evidence directory | Original consumer | Author regression | Independent | Unchanged postcondition |
| --- | --- | --- | --- | --- |
| `exact-failed` (`02a78bf…`) | 12 pass / 1 fail | not run | not run | not run |
| `current-before` (`96e051e…`) | 12 pass / 1 fail | 3 pass / 16 fail | not run | not run |
| `candidate-final` (`456a073…`) | 13 / 13 | 19 / 19 | 23 / 23 | 5 / 5 |
| `current-head` (`8e1298b…`) | 13 / 13 | 19 / 19 | 23 / 23 | 5 / 5 |

The 23 consist of 20 controls and 3 mutant-kill tests; the mutants are not three
additional provider-success cases. Historical consumer failures remain the same
existing-target `mv` to remote; the production timestamp readback is unchanged.
Historical commands exit 1; candidate commands exit 0. Builds, strict extracted
consumer types, declaration-resolution checks and candidate strict postcondition
types exit 0. Full command argv/stdout/stderr/status are retained in `commands.json`.
No entire historical release gate or real-provider download was run.

Actual recorded replay interval: August 27, 2026, 09:33:54–09:35:46 UTC, including
verifier-development runs. This is an execution interval, not continuous runtime
or total project work. Detailed timestamps and cleanup live in each summary.

## Independent controls and mutants

The new tests make raw HTTP requests to the unchanged committed helper and use
the packed public `WebDavFileSystem`, not its private implementation:

- Persist/read exact `{urn:virtual-bash:metadata}timestamps`, including fractional
  and negative atime/mtime; compare raw JSON, actual backing stats and public stat.
  Bytes remain exact; successful timestamp-only changes keep this helper's ETag.
- Default DAV namespace, alternate metadata prefix and numeric XML entities are
  accepted. Directory trailing-slash views and depth-one parent readback agree.
- Wrong outer namespace, wrong property name, shadowed namespace, unknown sibling
  property, duplicate property, unsupported remove, illegal numeric XML character,
  malformed JSON and nonfinite timestamps reject without changing retained metadata,
  observed backing times, bytes or identity.
- Same-size backing content replacement with a changed mtime invalidates the old
  property/ETag. PUT invalidates even equal bytes; DELETE/recreation does not revive
  old metadata. Both body ETag and HTTP If-Match failures preserve state.
- Absent backing utimes reaches public ENOTSUP; ignored backing utimes reaches
  public EINVAL (HTTP 409), with no false successful timestamp/property publication.
- Controlled transport negatives verify missing readback and changed validators
  produce EAGAIN, and an actual backing mtime change immediately before PROPPATCH
  produces HTTP 412/public EAGAIN without applying requested times.

Three small test-only transport/call mutants do not edit any product/helper source:

1. Remove timestamps from PROPFIND: the same raw-persistence probe fails on the
   missing correctly namespaced stored value; ordinary public readback rejects.
2. Return a plausible PROPPATCH 207 without persisting or applying the update:
   the same raw-persistence probe rejects the absent property.
3. Swallow only public EAGAIN after omitted readback: the unchanged error probe
   rejects the resulting false success (missing expected rejection).

Each kill requires the specific assertion message, not any arbitrary exception.
Wire witnesses record requests, statuses, bodies and backing state. These are
deliberately labelled fault injections, not modifications to real provider results
or expected-failure waivers for original tests. The passing baseline probe runs
against the unmodified helper before interpreting its mutant failures.

## Defect versus profile

The original helper defect is genuine: it acknowledged timestamp metadata without
retaining/exposing that property, while changing the representation validator due
to the metadata-only mtime effect. The unchanged consumer could not truthfully
report move success. Production `4143efd` correctly rejects the missing/mismatched
postcondition and remains byte-identical throughout these comparisons.

The correction is a legitimate, narrowly documented helper model: for a verified
metadata-only backing update it preserves the content representation ETag and
exposes the stored timestamp property bound to it. This is not a requirement that
all WebDAV providers preserve ETags on metadata writes. The changed-validator
negative explicitly proves no automatic success is inferred for another model.

The small one-property parser is intentionally not a general XML server. Unsupported
property transactions, XML constructs outside its accepted grammar, LOCK/COPY/MOVE,
durability, provider authentication and general concurrent mutation are outside this
consumer fixture. Its dev/inode/size/mtime stamp cannot detect same-stamp content
replacement or ABA; the tested invalidation is for PUT/DELETE and observed stamp
changes, not arbitrary hidden content changes. No same-stamp/ABA protection is
asserted. Host backing operations are trusted/cooperative; post-effect failure is
not rollback. This limitation existed in the explicit author profile and is not
silently promoted to a stronger server/validator guarantee.

## Verifier defects retained

`candidate-first` failed strict compilation before runtime: the new verifier passed
an explicit undefined RequestInit body under exactOptionalPropertyTypes. It now
omits the body property instead. This is a verifier typing correction.

`candidate-second` recorded original13=13/13, author19=19/19, postcondition5=5/5,
but independent21=9 pass/12 fail. Its observation helper read backing bytes before
stat; Memory.readFile legitimately changes atime (`src/fs/memory/index.ts:294`).
The verifier was perturbing what it measured. The corrected observation is stat-only,
with byte reads/assertions after time/property checks; no production or original
expectation changed. Two public negative neighbors were then added, yielding 23.
The initial inputs and raw failures remain beside the corrected run. They are not
called product regressions, ignored tests or unchanged all-input proof.
The final witness stat can show an access time advanced by a last byte assertion;
exact requested times are asserted before that read, not inferred from final atime.

## Hashes and protected history

SHA-256 values (complete source manifests and all input/tool hashes are in baseline):

| Input | SHA-256 |
| --- | --- |
| Original helper, both red sources | `288d17dca5b6950fababb945cf21c15594dfbf37897d1cdcaab2aba1088a6b9b` |
| helper456, both green sources | `af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6` |
| Unchanged original consumer13 | `b69e78c54d5afb844cef7f59c4d530e1ddad6634394a32e56e455b7a7bce752a` |
| Unchanged production webdav.ts | `e66a66e2745852c6bd12be12a18c855df069152cf6b8089d2ecee8880c62de94` |
| Unchanged postcondition5 | `4aa5f6f6b79b4952e282cdbc68d00c43869ff5536ebcd35ba23dba8fbbd6a263` |
| Both green packed archives | `886abaa12224883a4c6efe728347e06fa1b17965b756b37f1dba1bea2f1d245f` |
| Final independent test | `9df9eb1914e8a8a7cf98e40e29dac567488f16aba7e0fdabe42793eff5f2f358` |

Every original consumer/example/type byte matches `02a78bf…`; no assertion was edited.
All three production WebDAV module sources and postcondition5 also match it.
The actual module load hook records 157 loaded packed modules per old cohort and
164 per candidate cohort, independently for original13, author19 and independent23.
The consumer package has a distinct name and resolves emitted public declarations
and runtime only inside its extracted product. No shared dist or self-reference.

Each replay seals 1,900 read-only files before/after, including original provider
matrices, consumers, contracts, configuration/runner and 31 raw historical author
evidence files from exact-failed/current-before/regression-before. Every seal matches.
The author's still-evolving handoff/candidate evidence is not sealed as immutable;
the stable committed helper/tests and specified historical raw cohorts are.
`SEAL.json` hashes every owned evidence file, including failed verifier inputs.

## Real-service limits remain separate

The unchanged `../real-service/REPORT.md` records WsgiDAV's unquoted DAV:getetag
(file utimes stops with ENOTSUP), absent directory getetag, and Apache's first
directory property write changing its validator (EAGAIN). The first Apache attempt
remains a failed positive; a warm second update is a separate case, not automatic
recovery. Those provider XML/native observations and original matrices are protected
by the seals, not rerun, relabelled or turned green by this loopback-helper fix.

Stock WebDAV and configured atomic-extension evidence remain separate, particularly
`../atomic-extension-independent/phase2/evidence/real-provider/independent-qualified/summary.json`.
This timestamp verification neither executes nor extends that atomic-extension
proof, grants stock servers the extension, nor changes its locks/authority contract.

Faraday owns the qualified-release decision, runner/configuration and consumer
inventory. The new canonical `.mts` verifier is explicitly compiled by this scoped
runner; no claim is made that the existing root inventory automatically includes it.
For a newer actual candidate, run the documented explicit commit or HEAD command;
do not use the historical failing source as a hardcoded current candidate.
