# V3 resolved fixture seal — FULL FREEZE BLOCKED B01

**Root/Faraday: resolved requirements are bound here; this packet does not clear
implementation or claim a complete normative freeze.** The latest routed message
and seal `1168432e12568e63ff307e92ed83d64d78a03a3c` fix CR, uppercase zero-tail,
fallback and all 18 limits. However, that exact seal explicitly requires another
root decision for strict grammar. Nothing in the latest message explicitly adopts
those remaining proposals. Treating them as approved would silently invent policy.

Only new files in this directory are owned. The prior preparation commits
`76d19835b2e576cdae4a78e1f1e68f2f5a7afca3` and
`dc5084b34ea2737552d05307262b40530329ed15` remain unchanged provisional history.
This additive packet fixes the resolved expectations, not earlier evidence or
their counts. No author/production/root/76 files change. No delegation or hidden
holdout claim: root/Faraday will see the fixtures and controls.

## Binding and reconciliation

Actual sealed paths are `src/commands/xan/DESIGN.md` and
`src/commands/xan/design-evidence/{PROFILE-V3,BYTE-TABLE-V3,HANDOFF-V3}.md`, plus
`FINAL-BINDING-V3.json` in that evidence directory, not HANDOFF/BYTE files directly
under xan. MANIFEST.json binds complete SHA256/blob/path/revision identities,
inherited PROFILE-V2, selected actual contracts/capability sources and prior prep.
Authority: latest root message > explicit V3 disposition > nonconflicting current
DESIGN/inherited V2 details; shared lifecycle/FS contracts remain authoritative.
The author seal's recorded hashes are checked against Git bytes, not merely copied.

| Issue | Precise reconciliation at 1168432e |
|---|---|
| Select/Slice CR | PROFILE-V3:21–37 and BYTE-TABLE-V3 family 2 override raw-copy language: Select `a,b\n"x\ry",z\nu,"v\r"\n`; Slice `a,b\n"x\ry",z\nu,v\n`. Both status 0, empty stderr. T02S/T02L are exact project bytes, not native Select passes. |
| BOM/M/EOF | PROFILE-V3:13–37 and table families 3–10 approve initial marker removal, moved-data quoting, command-specific M and quoted EOF repair. Old “proposed” labels do not reopen these explicit approvals. Inferred table cells are PROJECT, never observed-native facts. |
| `-l0` versus `-L0` | PROFILE-V3:41–60 overrides the V2 operand-kind proposal. Uppercase zero tail reads a header only, or acquires/reads no input with `-n`; it still validates and publishes required empty `-o`. Lowercase/start=end/end-zero post-write semantics remain. Mixed-mode grammar is separately B01. |
| Caps | PROFILE-V3:76–80 and DESIGN:416–443 approve exactly 18 unchanged default/hard rows. V2 “19” is a bookkeeping error, not an extra cap. All simultaneous-capacity and parent/output rules apply. |
| File publication | PROFILE-V3:64–74, DESIGN:496–531 and inherited PROFILE-V2 I/O replace v1 append speculation with bounded whole-result writeFile when writeStream is absent, same actual wx/w guards. DESIGN:521's “proposed” stdin-existing refusal is expressly retained by V3:71–72. No atomic identity-conditioned open or new capability. |
| Version/proposed exports | DESIGN:82–97 lists proposed files/exports and a version choice; inherited V2 narrows its candidate version behavior. No root-version fixture or uninspected public xan import is introduced here. Existing Shell/contracts surface is inspected, not built/accepted; integration remains root-owned. |
| Unqualified diagnostics | Only named NONEXACT rows/control errors permit semantic matching. Exact approved M/literal bytes remain exact. NONEXACT is not an arbitrary stderr waiver, native diagnostic certification or permission to hide a failure as help. |

## B01 — genuine unresolved grammar, not historical wording

All locators below refer to **1168432e12568e63ff307e92ed83d64d78a03a3c**:

- PROFILE-V3:84–85: `Strict numeric/selector/mixed-mode boundaries remain declared proposals requiring` / `explicit resolution; this delta adds no grammar or feature breadth.`
- HANDOFF-V3:44–45: `Strict numeric/selector/mixed-mode grammar boundaries remain declared proposals,` / `not new approvals. Root must resolve them explicitly; Dirac must not invent`.
- DESIGN:570–571 repeats that these boundaries are not newly approved. Their
  proposal sites are DESIGN:104–106 (repeated singleton flags), 131–151
  (pathological delimiters/strict numeric parsing), 217–225 (selector quirks and
  malformed clauses), and 250–257 (mixed slice modes).

Concrete unresolved argv bytes: `slice -l " "` has value hex `20` (native
docopt whitespace-to-zero versus proposed rejection); `select "0,,1"` selector
hex `302c2c31`; `slice -L 0 -l 0` has competing proposed-reject/native-precedence
routes; `count -n -n` repeats a singleton; `count -d <CR>` delimiter hex `0d`
is a proposed restriction. No output/status is invented for these inputs.

**Safest minimal proposal for root, NOT adopted here:** explicitly ratify the
named pre-I/O bounded strict refusals in those locations, while preserving the
already declared valid inventory (including empty overall selection and clarifying
trailing comma versus interior empty clause). Alternatively specify each native
compatibility boundary to retain. This is one grammar disposition request, not a
request to reopen CR/caps/fallback. Once root chooses, an additive resolution must
bind the affected exact cases/diagnostics and flag combinations before this packet
can become a complete normative, implementation-clearing freeze. Do not silently
edit this blocked receipt or the author's seal to imply that choice occurred.

## What is sealed now

- CASES.json: **88 concrete command cases**, 44 exact transcriptions from the
  approved eleven-row/four-command table plus 44 bounded concrete controls/literals.
  Six cases are compact original OBSERVED_LITERAL references; all other exact
  outputs are declared PROJECT expectations, not independent executions. Exact
  invalid-byte inputs use hex/base64. Cases do not count as passes.
  O18's redundant native quotes are a comparison baseline, not an invented
  mandatory raw-copy branch: its project assertion is writer-valid reversibility
  against the independently listed logical records. Other literal references
  also match separately declared project rules; no observation becomes a pass.
- CONTROLS.json: the **same 12 existing families**, with finite byte partitions,
  legal producer-reuse schedules, lifetime/event relations, required file effects,
  truthful identity/capability controls and independent roundtrip vectors. No new
  command family or executable framework; no exhaustive grammar expansion.
- LIMITS.json: **18 cap rows**, exact defaults/ceilings and boundary ±1 recipes.
  These are not 54 executed tests. Unreachable depth/grammar/cross-cap targets and
  not-yet-bound work/capacity ledgers are explicitly non-passes. Limits are logical,
  not RSS or provider-allocation bounds. B01-dependent selectors remain blocked.

Current FS binding is deliberately limited: complete scoped identities or
compareObservedEntries before eager input/destructive output; unknown refuses;
real wx uses O_EXCL; S3 actual conditional-put support is required; WebDAV uses
conditional headers and rejects explicit mode. These inspected implementations
do not establish service compliance or new authority. Memory/VFS storage and
opaque provider work are not secretly included in module retained occupancy.
Missing readStream refuses when needed, no whole-input fallback. Zero-read
`-n -L0` does not waive metadata/alias/permission/publication checks. Failure effects
must distinguish preflight/no publication, streaming partial publication and
whole-result fallback refusal versus an already-admitted provider write.

## Read chronology and pre-source limitation

At **2026-08-28T03:11:06Z** (August 27 Chicago), root/status/index and applicable
AGENTS were checked, and the sealed/current xan directory inventories contained
only Markdown/JSON. Initial HEAD was `be0222a375613cf37e6e3eb5e5a7da0886905a20`.
Read V3 handoff/table/profile, current sealed DESIGN and FINAL-BINDING, inherited
I/O/accounting, then actual readBytes/output/cleanup/identity contracts and selected
FS capability/public surface source. At **03:16:30Z**, the exact grammar blocker
locations and error/API surface were rechecked. No native cache/source checkout
was accessed; original oracle JSON was read only for six compact literal cases.

MANIFEST records the later metadata-only source-absence checkpoint and complete
xan path inventory. Absence at observation is not a future guarantee or a proof
against alternate implementations elsewhere. A later source arrival must be
disclosed, not deleted or used to obstruct the author. Recheck inventory around
the owned commit; later execution must bind the actual candidate separately.

## Reproduction prerequisites — NOT AUTHORIZATION TO EXECUTE

1. Root resolves B01 and routes the final author delta/candidate. Record exact
   implementation/public registration and contract bindings. No published xan
   API or compiled consumer evidence exists in this packet; no proposed export
   is substituted for inspection. No source implementation is added here.
2. Verify MANIFEST hashes and selected Git objects; preserve this commit and old
   author cohorts. Exact parsed JSON strings encode UTF-8, with hex/base64 for
   arbitrary bytes. A future executor uses an actual Shell/registry entry and
   public byte sink, with independently bound lifecycle helpers where needed;
   not a production parser to calculate its own expected output.
3. Expand the declarative case/schedule/control IDs into a pre-execution run
   manifest, including unreachable/blocked/default-scale classifications. Each
   actual invocation and pipeline stage is separately counted. Keep the earlier
   **184-invocation ceiling per routed batch**, not a test denominator or silent
   coverage reduction. Additional batches require routing. No full gate claim
   until all required reachable variants have receipts; unrun variants persist.
4. Ordinary fixtures <=4 KiB, <=64 KiB aggregate admitted input per ordinary
   invocation, <=1 MiB stdout+stderr and <=1 MiB captured files. Serial execution,
   <=5 seconds per ordinary attempt / <=300 seconds per routed batch; default-cap
   attempts <=60 seconds each within that aggregate. Stream recipes rather than
   store huge payloads; large-output counters/digests must themselves be bounded.
   Costs or unreachable simultaneous caps never turn into implicit passes.
5. Use fresh owned VFS/work directories and bind FS capabilities, env, signals,
   dispositions and allowed effects. No native oracle, install, provider network
   or process cohort is authorized. Any later outer process observer requires a
   separately routed fixed protocol: bounded capture, child close plus stdio close,
   owned-group retirement and no further admission after failure. No kernel-time
   hard guarantee or arbitrary-escape proof. Normal/abort/dispose are distinct.
6. Public settlement drains registered cooperative cleanup and tracked owned work;
   uncooperative host promises receive late-rejection observation, not a universal
   await/kill guarantee. Teardown releases own gates/listeners/timers and preserves
   foreign processes/artifacts. Diagnostics retain exact/nonexact classification,
   source/status/namespace effects, cancellation origin and reason identity.
7. Freeze new evidence in unique outputs; never rewrite original 28 calls (23
   status 0 / 5 status 1, NOT passes), later author observations or prior prep.
   Hash/re-enumerate the selected tree for added-entry detection; original-path
   equality alone is not append-proof. No full-native-parity/security certificate.

Only JSON/fixture consistency, document whitespace, source/history hash and path
inventory checks are performed now: **not product tests**. No compiler/native/
product/test/process-cohort execution. Root receives exact commit/status after
artifact checks; there are no owned background processes. Stop for root B01/source
routing. Repaired gate76 work remains root's separate priority, never this scope.
