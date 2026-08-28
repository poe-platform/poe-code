# PROVISIONAL PREP v2 — NOT FROZEN / NOT EXECUTED

Additive root-decision mapping only. Preserve PREPARATION.md, FAMILIES.json and
EVIDENCE.json at `76d19835b2e576cdae4a78e1f1e68f2f5a7afca3` as prior provisional
history; this note supersedes conflicting pending/proposed statements for future
preparation, not their bytes. Same 12 families, no breadth/count expansion or
new denominator. The earlier 184-invocation ceiling is not authorization to run.
No author implementation, final fixture/oracle freeze or gate76 review here.

## Read identity and authority

Resume checkpoint **2026-08-28T02:57:15Z** (August 27 Chicago): re-read applicable
`../AGENTS.md` and root `AGENTS.md`; no intervening AGENTS file existed. Git root
was `/Users/kjopek/Workspace/safe-bash`; index empty, foreign edits/artifacts present.
User assigns only this new file in the independent subtree. Read via immutable
Git objects, in order: PROFILE-V2, BYTE-TABLE-V2, then relevant HANDOFF-V2. Hash
checkpoint **2026-08-28T02:57:38Z**; HEAD was the prior preparation commit. Listed
live files matched their pins. Uncommitted DESIGN/PROFILE-V3 and 76 work were not
adopted or edited. No external cache/private checkout or raw capture was reopened.

All three author documents below are pinned to
`b9ce9e61115c7d99dfa6a76591b3dcfdaee9ce21`, under
`src/commands/xan/design-evidence/`:

| File | SHA256 |
|---|---|
| PROFILE-V2.md | `e9084f0074cd4e13ac3f9406bb6ea3d9f1764903004716a1e94840d626a8595d` |
| BYTE-TABLE-V2.md | `bb098e841cd62791066432ae74f6b8368f99fbb1d9083d63583bc201cbeb2172` |
| HANDOFF-V2.md | `36457c0a546af45c3fb05a6ee64283d54f7b16ad8002481ca21bde79e218fa75` |

Prior independent files at `76d19835b2e576cdae4a78e1f1e68f2f5a7afca3`:

| File | SHA256 |
|---|---|
| PREPARATION.md | `6f46773f02394f3c5a238eb8af2f7b83480a9097fd36583cbf6c426386c588af` |
| FAMILIES.json | `1b4eb2a1175a974d62ff1b9e7cb60a07abdb2b18413066100b08730484729948` |
| EVIDENCE.json | `5dd9f3521fab8e3d32788b35672676014312e6bf81d19f287847bf8091b3ff5f` |

Authority order: **this routed user/root decision > conflicting pinned proposals**.
Approval changes project policy, not evidence provenance. All inferred table rows
are **PROJECT profile**, never native proof. Original 28 observations remain
**23 status 0 / 5 status 1**, not passes. Profile references to additional native
observations are author-attributed readings here, not independently rerun/rechecked
raw evidence. Native source/binary/archive identities remain in prior EVIDENCE.json;
none were newly authenticated. No pinned author document is rewritten.

## Resolved mapping onto existing provisional families

| Existing families / former question | Routed decision for their provisional next version |
|---|---|
| F01, F02, F04, F05, F12 / Q1–Q3 | Use approved per-command PROFILE-V2/BYTE-TABLE-V2 project dialects, not a uniform CSV parser or native certification. Table-backed header/empty/duplicate/selector preparation no longer treats every byte-policy cell as awaiting initial approval. Source-only/inferred detail remains project expectation, not a captured golden. The CR exception below remains blocked. |
| F02, F04, F07, F12 / Q1 | Select/Slice **M** refusals apply to the pinned embedded-unquoted/postquote forms: status 1, `xan <subcommand>: unsupported malformed CSV quoting\n`. The table distinguishes malformed header (no emitted header) from malformed body (valid emitted header remains). Do not impose these refusals on Headers/Count or invent extra malformed cases. |
| F02, F03, F12 / Q1 | Approve the pinned supported unterminated quoted-EOF repair: table family 9 input `a,b\n1,"x\ny` yields project Select/Slice `a,b\n1,"x\ny"\n`. This closes the quoted field; it does not legalize M forms or promise recovery for arbitrary malformed input. Original Select row 21 remains a native byte deviation. This transcription is project policy, not a finalized oracle. |
| F02, F03, F05, F12 / Q1 | Strip a true initial BOM marker chunk-invariantly; preserve BOM data elsewhere. When reordered BOM data begins the first output cell at absolute byte zero, quote that cell, including decoded headers/Slice. Cross-delimiter canonical serialization must preserve logical cells; same-comma raw is allowed only if data-faithful/reversible with owned spans. No unconditional raw copy, global BOM stripping or fresh marker insertion. |
| F06, F07 / Q2 | **Uppercase `-L 0`: uniform no data rows for stdin and files, header if enabled.** This newer root override rejects the pinned operand-kind proposal. The native stdin last-row behavior is an explicit gap; do not emulate it. This output decision alone does not invent a finalized iterator/read-ahead schedule. |
| F06, F07 / Q2 | **Lowercase `-l 0` is different.** Retain captured ordinary-range semantics: default-start emits all; `-s 1 -l 0` and `-s 1 -e 1` emit remainder; `-e 0` emits all, on the profile's stated input. Do not transfer uppercase no-data behavior to these ranges. Source-inferred combinations remain project profile, not additional native observations. |
| F08, F09, F10 / Q5 | Bounded whole-result `writeFile` fallback is approved when `writeStream` is absent, within retained/output/parent budgets. Use the same actual `wx` for missing or guarded `w` for proven-distinct existing output; unknown aliases still refuse. **No empty-create/append fallback.** Existing contracts only; no identity-conditioned atomic-open, transaction or rollback claim. |
| F03, F08, F09, F11 / Q4–Q5 | Charge simultaneous owned buffers, including fallback segments, old/new allocation during assembly, other retained state and final payload; pre-admit before allocation/publication. Parent budget wins. Seven main logical defaults remain unchanged; no RSS/provider-allocation promise. Destination-specific cleanup and opaque-host limits from the first preparation remain intact. |

F05's remaining selector/argument bindings must reference the declared supported
inventory; this update neither expands grammar nor silently approves every older
proposal. Unsupported advanced/expression features still fail explicitly. Exact
diagnostics previously labeled unmeasured are not newly native-qualified.

## F09–F11 fallback recipe refinement, not extra cases

Replace the old append-path possibility inside existing slots with a capable
no-writeStream host and bounded whole-result controls. Future validation must
account for simultaneous segments + assembled buffer + still-live header/ring/
scratch, not merely final result length. Exercise admission just below/at/above
the applicable retained/output/parent bound only after accounting is bound; do
not publish if complete fallback storage cannot be admitted. No per-phase reset
or omitted transient capacity, and no large payload generation now.

Observe writeFile call/flag, actual file and stdout/stderr effects: successful
fresh `wx`, proven-distinct existing `w`, unknown-alias refusal, missing exclusive
write support, raced existing destination, pre-publication failure and failure
after write admission. A pre-publication fallback rejection leaves destination
untouched; an admitted provider write may leave partial/truncated effects. Record
actual effects, do not delete/restore them or assert atomic failure/rollback.
No empty create followed by append; no fake capability inferred from method
presence. Provider `wx` support must be real (the profile notes S3 conditional-put
requirements); mocked controls alone do not qualify a deployed provider.

## Remaining hold and candidate prerequisites

**One routed byte-policy clarification remains: CR.** Exact logical `x\ry`, EOF
`v\r`, and valid Select serialization instead of ambiguous raw CR are forthcoming.
Do not choose retention/removal/quoting bytes here or elevate BYTE-TABLE-V2 family
2's old raw Select output/decoded EOF behavior into a new project golden. Preserve
its native observations. Valid/reversible output is required; the exact CR table
and root routing must resolve how that requirement applies before final freeze.

Await the final Faraday delta and root routing, then bind the approved consolidated
profile, implementation/public-consumer commit and independent finalized fixtures.
No author code exists in the routed packet. The pinned profile still labels other
defaults/hard ceilings as proposals; do not silently elevate those while binding
future accounting/validation. That binding work and still-unqualified diagnostics
are not permission to invent another byte-policy decision or run preparations.
The first preparation's optional holdouts are **not authorized** by this update;
known captured range behavior is not a reason to replay it. No final freeze until
exact CR bytes/root routing. Gate76/A10 priority remains root's separate routing
when Curie returns; this leaf neither owns nor starts it.

Only document whitespace and listed source/history hash checks are performed;
these are **not tests** and original-path equality is not append-proof integrity.
Zero native/product/test/process-cohort executions, installations or background
processes. One additive preparation commit only; preserve foreign staging/artifacts.
