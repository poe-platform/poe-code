# Four-file Shell ERE integration: independent SOURCE review

Date: August 29, 2026.

**SOURCE-ACCEPT, limited to the inspected four-file delta's alignment with the
ratified design. Composed-candidate activation remains HOLD.** No new production
defect is established by this source review. This is not complete305-input
composition admission, a runtime result, or transport acceptance. The incomplete
admission attempt below is preserved and is not treated as a successful closure
proof.

## Frozen inputs and admission qualification

Resolved source: `e013f817fd7700c59a144c395c80dc25856e4157`.
Author evidence: `3b1a412af3bfa7c38a8f2796e815c4fdb26bfe27`.
The declared composition is CORE293
`bf079ada185a79aec864b068f3738ddc5520822e`, accepted engine
`72187e5abc1179883f85a63e1ef558f2e141c542`, and transport
`02782056c436c9f2a8319f73a9eb8e2b4b5aebd5`, with these four overrides.
Neither the derived CORE identity nor the proposed305 composition is assumed
to be a stored Git tree. No live HEAD or newer transport was substituted.

| Source | Accepted CORE blob | Candidate blob | Candidate bytes |
| --- | --- | --- | ---: |
| parser.ts | 27bcacc6c9a731ff02c6ef3700e96a7a1f8e4ebe | c9065ec21a934b5ab4197e80c620b432f7b060cb | 44045 |
| conditional.ts | caab6172df5b8e5bad2d1db007b156f067e295ad | 45aa9dda1fb3eaa22fadbd45dda53db38fa6faa2 | 9130 |
| runtime.ts | df6b2c0dfad8d7412f93f434d07a20b2b9375a86 | 4e5c0747a564efa2fb19f8bbe72fa256b9a0ed5c | 210813 |
| shell.ts | 220d6c28a6e50f459a48ee2030f24a841f4ab7 | 08e332c471d01fe5eabfb3403f885e6090a43e9a | 15121 |

The shell baseline identifier in the table is clarified here in full: its exact
stored blob is `220d6c28a6e50f459a48aaee2030f24a841f4ab7`, as recorded in the
raw metadata and diff. That exact identity, not an abbreviated transcription,
is authoritative.

`raw/metadata.stdout` records stored blob/type/size admission. Four source diffs
use those exact old/new objects. Candidate source copies, baseline array binding
and ownership implementations, and CASEMAP were separately materialized and
checked with Git's content hash before their full-file text inspection. The
final seven-member content census is `raw/final-source-census.stdout`; no source
copy was edited. The canonical author CASEMAP blob is
`e911b6311bac252b33e9ed84231efbe1cee15c17` (21146bytes), retained unchanged as
`raw/casemap.source`.

The attempted broader admission helper used an **incorrect assumed** transport
filename `transport/worker.ts`. Git reported it unavailable, and the helper
refused before its payload batch or JSON decoding. `raw/admit.stderr` preserves
this reviewer locator error. No missing row was filled from HEAD, no newer
transport body was substituted, and no helper was retried. Remaining inspection
used explicit Git blob reads/diffs for the already identified four-file scope.
Consequently this packet does not claim to have authenticated all305 inputs or
the complete seven-file transport/Worker closure. That remains a fresh-rebind
admission prerequisite, not a production bug or an accepted missing input.

## Source alignment, with exact seams

1. **Contextual RHS lexing.** `parser.ts:290–323` tracks bracket state, initial
   `]`, negation and class material only in regex RHS mode; parentheses inside
   bracket material do not change regex group depth. Existing quote parsing
   retains literal versus unquoted fragments. `383` rejects an unclosed literal
   regex group structurally, distinct from `$bad` containing a runtime-invalid
   regex. Ordinary token handling outside conditional RHS mode is unchanged by
   this delta. Full delimiter/escaping behavior still needs R11–R16/R21 and
   boundary controls; source inspection is not a blanket grammar proof.
2. **Same-node inversion versus grouping.** `parser.ts:635,643–644` uses a
   parse-local grouped set when cancelling adjacent `not` nodes. `! ! E`
   collapses on the same node; `! ( ! E )` retains two inversions. The distinction
   is encoded into the AST during parsing, not dependent on keeping that set
   alive during execution. This matches the source-derived e158a938 distinction;
   it is not new native observation credit.
3. **Numeric status2 and laziness.** `conditional.ts:138` expands the left operand
   once, then delegates reached regex RHS expansion without the former second
   generic right expansion. `165–181` keeps numeric results, visits OR on
   nonzero and AND on zero, and inverts zero versus nonzero. Runtime semantic
   refusals return2 at the leaf after diagnostic output, permitting inner OR
   recovery. Skipped leaves do not acquire a regex session.
4. **Fragment origin.** `runtime.ts:932–935` uses the existing word expansion
   once with splitting/globbing disabled. `3932–3950` adds a fragment callback at
   the append seam; literalness is derived from quote-origin rather than old
   glob escaping. `3967` and `4000` gate multi-field splitting on `split`, which
   is false here; `4006–4008` appends the resulting field without IFS splitting.
   Alternate-fragment handling remains in the existing expansion path. No
   expanded text is reparsed as a shell operator. This needs mixed-fragment and
   exactly-once runtime tests; it does not certify every parameter-expansion
   quoting edge or byte-oriented native locale.
5. **Private root ownership.** `runtime.ts:877–886` records a Budget-keyed root
   entry and installs cleanup before root acquisition. `shell.ts:175` enrolls
   this alongside the existing root cancellation owner. `runtime.ts:944–967`
   lazily obtains the root, registers a session with the current invocation scope,
   passes the request signal, and closes that session in finally. Root retirement
   is distinct from per-request/session closure. Existing shared Budget paths
   are not changed. Actual parallel jobs, nested invocation, disposal and Worker
   retirement remain H01/H02/H07/H08 obligations; this is not a transport review.
6. **Typed publication.** `runtime.ts:944` obtains the target watch after RHS
   expansion. `972–1000` checks caller/scope, readonly, exported and stale state;
   pre-admits typed publication/name/tickets and a staged indexed binding; creates
   indexes0..N from validated spans; rechecks before a synchronous publication.
   Nonmatch publishes an empty binding; invalid ERE returns before publication;
   readonly emits a diagnostic but retains the match/nonmatch status. Old capture
   state is not released to make staging fit. Dense empty slots represent the
   project reporting profile, not observable native hidden participation.
7. **Watch/array cleanup is present.** A watch is explicitly closed on successful
   publication, but other exits are not thereby proven leaks: accepted
   `arrays/bindings.ts:190–209` installs `observer.cleanup = () => result.close()`.
   Accepted `arrays/ledger.ts:227–249` drains owned admissions. The new finally
   path releases staged state, closes the operation and releases its hold.
   These source mechanisms do not replace actual allocation/cancellation races.
8. **Failure channels.** `runtime.ts:905–911` preserves caller checks, true
   `ShellLimitError`, and raw diagnostic failure via the existing provenance
   wrapper. `956–967` distinguishes semantic refusals from escaping failure and
   cooperative-close failure. `1684–1688` maps only private ERE/transport profile
   limits to command status3 outside inner boolean evaluation. Existing global
   Budget, flow/control and N14 exact-Promise mechanisms are not replaced with
   error-message or truthiness tests. Actual raw falsy/caller/sink/cleanup
   ordering must still be demonstrated by H06/EH03–EH05.

No statement above certifies actual atomicity, cleanup completion, branch output,
or priority across a Worker boundary. No source patch is requested merely to
make an unexecuted oracle pass.

## Seventy obligations, not seventy passes

`OBLIGATIONS.tsv` maps all32 reference IDs,8 host protocols,25 EC source-control
forms and5 EH private-policy groups to the inspected seams. All70 remain UNRUN.
Author CASEMAP retains their literal programs/procedures and authority bindings;
the TSV does not replace those inputs. EC predictions are GNU5.3 source-derived
control-flow requirements, not native stderr goldens. EC19 remains a structural
parse question, not a runtime-regcomp result. EH policy is explicitly project
policy, not a claimed native status3 counterpart.

## Profile decisions and actual-grant prerequisites

- R01 reporting is settled by ROOT and accepted engine72187e5; do not reopen it
  or infer native spans/full I23/GNU5.3 coverage from local3.2 visible values.
- R24 must remain the declared modern source-profile local-shadow rule until a
  separately qualified native observation exists. Existing native12 does not
  settle local-variable publication behavior.
- R26's exported-scalar refusal follows the existing indexed-array profile.
  If native exported-scalar conversion is required instead, ROOT must explicitly
  change that profile; do not silently widen the four-file patch. R08/R29/R30/R31
  similarly remain explicit supported-profile/refusal distinctions.
- Lexer edge cases not established by the frozen references—particularly shell
  metacharacters within regex grouping/brackets and compound quote/parameter
  fragments—need primary-source or separately authorized native qualification
  before broader surface claims. They are unresolved coverage, not invented
  confirmed bugs or permission to reinterpret frozen programs.
- Transport02782056 still carries the separately reported SC01 work-accounting
  defect. New transport46611a5b67ad7af276154421ac7f50dd536ec570 is awaiting Arch's
  review. This review neither imports it nor certifies its correction. Require
  explicit accepted rebind, complete exact source/Worker asset closure admission,
  fresh strict build and installed/moved qualification before runtime activation.
- ROOT reports the positive-consumer test-only correction
  `dca71ab8aa6cd552c07e99aaf271b750fc35837c`, evidence
  `29857ec7ce21e20e51b4bef4e0beb57dd0c87166`, compiled once with exit0 and no
  diagnostics using actual root `parseShell`. This is routed author evidence,
  not an independent compiler run here. Original TS2724 and uncertified64-start
  historical administration remain unchanged. The earlier strict build and
  three negative diagnostics are not runtime proof.
- A fresh executable protocol must bind the corrected composition, all70 inputs,
  source/installed/moved roles, exact Worker loader/environment, caps, listeners,
  captures and retirement criteria. Require ROOT actual GO. No execution grant,
  public API change or Shell activation is implied by this SOURCE acceptance.

## Resource and publication record

Initial capture started11:52:43Z before fallible metadata reads. Instructions were
read separately, not copied into evidence. Two Node processes only: syntax
qualification and the refused source/table helper; no product/parser/engine
imports. Subsequent tools were scoped Git metadata/blob/diff/hash operations and
bounded shell text reads. All calls retired synchronously; no active session,
compiler, Worker, native process, network, private input or test run occurred.

Known administrative/source process count remains within40, peak at most3;
the final commit replaces its shell rather than adding a child. Source reads
and captures remain below48MiB capture/192MiB work. No helper retry, newer-source
substitution, deadline renewal, or historical outcome rescore was performed.
Publication is confined to this new independent scope. Stop at handoff.
