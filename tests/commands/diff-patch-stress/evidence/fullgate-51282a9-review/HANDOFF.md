# Independent canonical-fullgate bounded review

## Decision and immutable gate

**Accept the assigned bounded cleanup on committed source25a892f0908c12c1d00846690167fb520fa0fe42, not the current mutable working tree or the whole project.** Root's combined marker explicitly confirmed actual normal closure of original diff author13132, metadata author10024 and followup source fixer83389 before any new-author final tests executed. The marker is preserved verbatim in `final-gate.json`.

- Git tree: `354716c69ce261b3f6f3ecfa94abec9ef22ca888`.
- Final diff/patch aggregate: `7943828f6a3cda1626a0cd6685b4e1950f75b5fae690fa16977b1451a0b8f75d`.
- Source fix: `f93d7f671d98fe1f0a7f11830108e47b3aeb9eec`, after the independently detected over-restriction in retained intermediate `d841ece`.
- Separate fixture correction: `f73ff3a`; separate metadata prerequisite/provenance commits: `187425d` / `00051f0`.
- `final-receipt.json` authenticates 894 unchanged archived inputs plus44 supplementary matcher/type-wiring inputs, 15 native assets with source/destination hashes and modes, all four diff/patch binary profiles, 14 reviewer helper hashes, Node/tool versions and executable identity. Later repository HEAD/dirty/index states are recorded separately; they are not the accepted source.

The original14 target sources are identical at fullgate sourcee36dab2 and frozen72f780d. Initial source/profile evidence was captured before inspecting author changes. Only this reviewer's two assigned evidence trees and requested `/tmp` coordination files were written; no author fixtures, product source, filesystem implementation, package/root configuration or foreign native artifacts were edited. Source mutations occurred only in reviewer-owned disposable copies.

## Exact populations

These populations overlap and **must not be summed**. Controls, repeated profiles, native version checks and per-case assertions are not new command coverage.

| Independently executed profile | Tests/cases | Pass | Fail | Skip/cancel/TODO |
| --- | ---: | ---: | ---: | ---: |
| Frozen72f780d, original31, cold/no native overlay | 31 | 0 | 31 | 0 |
| Same original source/tests, explicitly qualified native overlay | 31 | 22 | 9 | 0 |
| Final source with exact frozen original31 assertions/helpers | 31 | 22 | 9 | 0 |
| Final source, corrected corresponding31 (three explicit name mappings) | 31 | 31 | 0 | 0 |
| Mandatory metadata/table qualified release | 318 | 318 | 0 | 0 |
| Setup/provenance author controls, explicit mjs invocation | 11 | 11 | 0 | 0 |
| Unchanged corrected three diff canonical files | 124 | 124 | 0 | 0 |
| Unchanged six matcher/publication/property files | 164 | 164 | 0 | 0 |
| Followup signed-search author regressions, separate controls | 22 | 22 | 0 | 0 |

The final old-assertion failure names are **exactly the same nine** as the initial qualified run: six obsolete parent link counts, one stripped-ancestor expectation, one repeated-hunk status expectation and one live-author-vs-historical SHA expectation. They remain failures in raw TAP, not silently green. All22 original metadata/table prerequisite instances actually pass under the exact mandatory release, including both native batches containing the original71 and216 inputs. Those batches remain two routed test instances, not287 new cases.

The corrected31 mapping is explicit in `final-corrected31.json`: only the repeated-hunk, stripped-ancestor and historical-provenance test names change; the eight diff input/effect distinctions and the historical source identities remain individually inspectable. Scoped results do not replace the original110-failure project gate.

## Source defect versus fixture correction

1. **Original repeated hunk is a conflict, not malformed GNU grammar.** With the exact repeated `@@ -1 +1 @@` input and old/middle/tail target, pinned GNU2.8 returns1. Apple returns2. Atomic virtual execution returns1 with the whole original namespace unchanged. Truncating the hunk body still returns2; no diagnostic tolerance was broadened.
2. **A distinct genuine source defect existed.** The same repeated input with old/middle/old was incorrectly applied by frozen72f780d. GNU rejects its first selected consumed match. Intermediate source fixd841ece then incorrectly rejected the legitimate adjacent old/old/tail case. The independent positive control exposed that over-restriction before final acceptance; root assigned a different fixer. Finalf93d7f6 preserves GNU signed search order, selected-offset carry and its literal negative-offset diagnostic.
3. **Six original empty-file assertions were stale fixtures.** GNU deletes authorized and changes root nlink4→3; Apple keeps that directory and nlink4. The corrected virtual fixture requires the GNU layout and observes safe `rmdir`, not recursive `rm`. The initial hidden stale mutation expectation and initial nlink failures remain preserved.
4. **The stripped ancestor is not the selected path.** With no strip option, GNU and virtual patch the basename. The separate selected-ancestor `-p0` control still refuses with no virtual publication; this stricter virtual safety behavior is not described as native parity.
5. **Metadata has no production fix in these commits.** One change qualifies missing development prerequisites; the other replaces an invalid current-author invariant with authenticated immutable historical source. No old expected SHA was replaced by today's author SHA, and no native oracle/fixture bytes were rebaselined.

## Independent native, namespace and mutation evidence

`final-corrected-native-product.json` replays the exact frozen eight original diff cases plus four bounded controls. The evaluator passes36/36 assertions over those12 cases. This is not36 cases. Both GNU and Apple are executed, independently pinned and retained as different Darwin profiles; no GNU/Linux claim is made.

`final-ordinary-native-product.json` separately replays the three existing repeated-hunk inputs in ordinary mode with default backup behavior. GNU and final product agree on exact status/stdout/stderr and complete typed namespace, including backup/reject bytes, for3/3. Virtual mode/link-count preservation is separately asserted. Raw native mode, link count, device/inode, size and bytes remain available; Darwin directory nlink conventions are not falsely equated with the virtual POSIX model. Atomic failures preserve the complete original virtual namespace instead of GNU ordinary partial publication. The earlier native profile's explicit no-backup-if-mismatch flag remains disclosed, not relabeled default behavior.

The two source mutations are detected for the **exact intended reasons**, with no fixture changes:

- Restoring only unified.ts from72f780d fails the later-duplicate conflict invariant.
- Restoring only unified.ts fromd841ece fails the adjacent-duplicate success invariant.

Each mutant has35/36 evaluator assertions passing and exactly its designated virtual-outcome assertion failing. Both negative controls are successful detections, not extra semantic cases. Original, intermediate and final sources remain in Git and durable records.

The evaluator's one development normalization defect is preserved: Apple emitted a random reviewer root and temporary entry in a selected-ancestor diagnostic. Only those exact observed root/temp names are tokenized for cross-run comparison; raw bytes and full namespaces are untouched. The initial failed evaluation, corrected evaluation, and source failure remain separate in `harness-development.txt`. There is no blanket stderr relaxation.
`stream-byte-audit.json` verifies all three original-cohort TAP files against their pre-save stdout hashes. Captured subprocess stderr is empty in all three (the original capture records SHA256(empty)); the text-artifact writer added one formatting newline to each empty `.stderr.txt`. Those historical text artifacts remain unchanged, and the exact empty captured stream is explicitly represented in the audit. This reporting-format defect is not product stderr or a changed result. Full staged whitespace checking reports19 whitespace-only lines in preserved raw TAP; code/docs/JSON pass when raw TAP is excluded. The byte-authenticated TAP is deliberately not reformatted.

## Prerequisites and historical authentication

The mandatory commands executed inside the committed snapshot with C locale and UTC:

```text
LC_ALL=C LANG=C TZ=UTC node tests/commands/metadata-stress/canonical-env/runner.mjs check
LC_ALL=C LANG=C TZ=UTC node tests/commands/metadata-stress/canonical-env/runner.mjs release
LC_ALL=C LANG=C TZ=UTC node --import tsx --test tests/commands/metadata-stress/canonical-env/setup.test.mjs tests/commands/metadata-stress/canonical-env/provenance-controls.test.mjs
```

Exactly14 whitelisted pinned primary assets were copied into the owned snapshot; the fifteenth, distinct historical stat executable remained at its original read-only host path. All15 source/destination hashes and modes match after execution. No installation, download, runtime dependency, fallback executable or root-dist build was introduced. The qualified profile is GNU coreutils9.7/Darwin arm64; absent/wrong pins or wrong OS are explicit `setup-unavailable`, not passing or skipped release checks.

Seven original author artifacts independently match their actual `git --no-replace-objects` commit/path blobs at7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3, their original SHA256s, and the original oracle record. Seven separate reviewer controls reject wrong blob, wrong oracle record, current-source substitution, wrong historical commit, missing native cache, wrong native pin and wrong host profile. Historical evidence is never edited.
The exact release CLI is also exercised with only its disposable copied cache withheld, then with only its copied stat bytes replaced by a non-executable wrong-pin text fixture. Both return `setup-unavailable`, exit78, and zero executed tests. Copied assets are restored with identical bytes/modes; original host assets and historical evidence are untouched. These are repeated negative prerequisite profiles, not new semantic coverage. The additional helper hash and both full CLI outputs are in metadata `release-negative-controls.json`.

The separate Git-unavailable archive control repeats318/318, all22 native rows, with null before/after Git HEAD and unchanged source authentication. A deliberately non-resolving `.git` indirection prevents discovery of the surrounding repository; it creates no Git database and is removed afterward. This mechanism is explicit rather than falsely claiming the surrounding host repository does not exist. Its complete runner report is retained under the metadata review tree. This repeat is not additional coverage.

## Type wiring, build and broader evidence

The existing cf1d1f0/83124c3 TS7053 correction remains an explicit `Actual` annotation in the renamed independent reviewer source. Both root and scoped configurations include that file. Its existing scoped noEmit passes, with no source/config edit and no execution of the separate five-tool suite. A source build redirected entirely into owned scratch also exits0; root `dist` is untouched.

The committed author's revised3758 report is independently authenticated against the final diff source hashes, all17 reported censuses, unchanged-input marker and count arithmetic. **Those3758 tests were not independently rerun by this reviewer**; this is report/source authentication, not a new independent fullgate pass. Literal-original3750pass/8fail and historical revised populations remain distinct. No other five-tool corpus was duplicated.

## Remaining root action and limits

- Plato still owns project-wide npm/release-job wiring. Requested script: `verify:metadata-table-native` → `node tests/commands/metadata-stress/canonical-env/runner.mjs release`, plus the explicit mjs control job. They must be mandatory in project release verification; exit78 must not be treated as green. Root made the standalone commands mandatory for **this scoped review only**. No root configuration was edited.
- The existing local native profile is qualified, not a portable or reproducible identical-binary build recipe for arbitrary Linux/Darwin hosts. GNU-on-Darwin is not GNU/Linux; archive/member hashes are not detached-signature or provider-deployment proof.
- This is not a whole-project/fullgate, default-command-count, public integration, superiority or72-hour completion claim. No performance conclusion follows from these functional runs.
- Reviewer-owned scratch copies/build outputs are removed after evidence capture. Foreign artifacts, concurrent work and staging remain untouched. Normal final handoff follows the explicit owned-path commit; root verifies actual process closure.
