# Frozen search raw-cursor caveat: independent README review

## Verdict and authority

August 30, 2026. Aquinas independently reviews Curie's documentation candidate.
**DOCUMENTATION CONDITIONAL READY.** The one new caveat accurately identifies
remaining raw-cursor compatibility gaps without claiming their repair or
permanently accepting them as restrictions. There are no documentation findings.
Fresh independent source/runtime acceptance and paired publisher gates remain
required. This is not a new source, runtime or release approval.

Author documentation manifest:
`/Users/kjopek/Workspace/poe-code-safe-js-frozen-search-readme-author/out/safe-js-frozen-search-readme/release-gated-candidate/manifest.json`,
SHA256 `820110c86c88f7b2ea75a2a66f4311fd482e0103ba59fa17a4e4eff12f66a490`.
Final author source manifest:
`/Users/kjopek/Workspace/poe-code-safejs-frozen-search-20260830/out/safejs-remediation/frozen-search/candidate-5dafe7a-sealed-20260830/manifest.json`,
SHA256 `0452f45f2c7ff830c8f5f74772978210d45c15d4b735b789afdf9f9e0ab3c046`.

The final three-path source seal is now authenticated. This supersedes the
documentation author's earlier pending-seal statement as a chronology update,
not an edit to that frozen handoff. Its captured source plan is byte-identical
to the final sealed plan, SHA256
`b4410029c76452102836d53aee8aa4a5e1c48bb9e4610492868d3ea9f21e0d6f`.
The source manifest itself remains author READY for independent review, not
independent runtime or publication approval.

## Current base and minimal publication selection

Fresh isolated main review workspace:
`/Users/kjopek/Workspace/poe-code-safe-js-frozen-search-readme-independent-20260830`.
Clone and immediate `git pull --ff-only` succeeded at
`5dafe7a59bf21da7365befe60e6b4d8d901e8669`. Ancestor/root AGENTS were read;
there are no additional instructions in `docs/AGENTS.md` or
`docs/plans/AGENTS.md`. Git object referencing shares no writable runtime modules
or dependency cache. No installation or source overlay was performed.

Exactly three documentation publication paths:

| Path                                                            | Base preimage             | Owner            |
| --------------------------------------------------------------- | ------------------------- | ---------------- |
| `packages/safe-js/README.md`                                    | Present, exact hash below | Curie, unchanged |
| `docs/plans/safe-js-frozen-search-readme-release-handoff.md`    | Absent                    | Curie, unchanged |
| `docs/plans/safe-js-frozen-search-readme-independent-review.md` | Absent                    | Aquinas          |

The README preimage is 52,672 bytes, SHA256
`820fd3d19777a46b103250d13683a1bf84cae4975f6561a1c5c1fa708732dc4e`.
The captured preimage, current Git blob and review-workspace README are equal.
The postimage is 53,036 bytes, SHA256
`6b98caba3deac2e972e9bd0a17e48161f18d89b3dab265f2286c123ca5cea79f`.
The author handoff is 6,222 bytes, SHA256
`29bad7677cefecffc88ad02c538450eeccca0d98244f32244af519571612ee30`.
The independent manifest records this report's exact postimage and absent base
identity. Source production, test and source-plan paths are prerequisites only,
not additional documentation publications.

## Exact caveat and three open raw observations

The added Gotchas bullet at `packages/safe-js/README.md:463` says guest
`lastIndex` assignment currently applies `Number(value)` instead of retaining
the raw value. It leaves raw string preservation and object-cursor identity /
coercion ordering, including frozen cases, open. It explicitly says the
conditional-write `search` repair does not resolve them or establish full native
cursor parity. This is useful current-contract disclosure, not a waiver of the
user's broader JavaScript scope.

The final source manifest's `caseMapping.remainingOverallRemediationGaps` and
the sealed source plan's named remaining-gap section agree on exactly:

| Named observation                              | Count | Disposition                                                                      |
| ---------------------------------------------- | ----: | -------------------------------------------------------------------------------- |
| Frozen string cursor `"0"`                     |     1 | Raw string preservation OPEN; unexecuted in the scoped source review             |
| Object cursor with `valueOf`, mutable receiver |     1 | Raw identity and coercion ordering OPEN; original event/identity oracle retained |
| Object cursor with `valueOf`, frozen receiver  |     1 | Raw identity and coercion ordering OPEN; original event/identity oracle retained |

No result or event sequence is invented for these three excluded observations.
They are not counted among the thirteen admitted recipes and are not represented
as passing. Current `packages/safe-js/src/interp/methods/regex.ts:42` contains
`target.lastIndex = Number(value)`. That assignment remains unchanged by the
sealed source delta and directly supports the caveat's current-behavior clause.
The report does not infer which arbitrary object-coercion hooks are supported
or substitute a normalized numeric oracle for a raw-value identity requirement.

Fourteen separate `y`/`gy` observations remain OPEN and unexecuted in this scope:
four required-write source, four caught source, two negative-zero source and
four original public observations. Their activation is not part of the two-write
repair or the new caveat. Existing README rejection of `u`/`y` is untouched.
Thus three raw-cursor observations and fourteen future-flag observations remain
separately accounted for; neither group is silently closed or waived.

## Source delta and error-boundary qualifications

The final source capsule contains exactly:

- `packages/safe-js/src/interp/methods/string.ts`, postimage SHA256
  `b657dacb191381fac83c2d7d6de258bb464b2758c3e8a8d4e7d5e35eecd93178`.
- `packages/safe-js/src/interp/methods/string-search-frozen.test.ts`, postimage
  SHA256 `0418fe7b99b461ed0b7a27bab11ea9fc496110476c77fafae33d58264b508fa6`.
- `docs/plans/safejs-frozen-regexp-search-20260830.md`, postimage SHA256 above.

The current `string.ts` preimage matches the sealed preimage, SHA256
`157c7aaa4f16e239aa278ec4888cd3de6da1c4a021a55dec0b73f96669d7ccfd`.
Its only production changes are the two existing assignments in `search`:
the initial write becomes conditional on `!Object.is(lastIndex, 0)`, and
restoration becomes conditional on `!Object.is(regex.lastIndex, lastIndex)`.
The saved cursor, `executeRegex` call, return expression and immediate abrupt
exit remain; no `finally` restoration is added. These predicates avoid
unnecessary same-value writes, distinguish negative zero and retain required
write errors. They do not modify cursor assignment coercion, activate a flag,
change owners/accounting, add native matching fallback or promise all-JS parity.

The authenticated LIGHT report, SHA256
`a6ddbbaf19427b94e6f0a8dfff31c2335fa663d33a7671ea7b6a092bce656530`,
and final source qualification distinguish two public error assertions from
the production repair. S03/S04 now require the run promise to reject with a
record named `TypeError`, rather than require a host `TypeError` prototype.
Their native oracle still throws native TypeError; the rejection channel is
not replaced with a fulfilled `{ ok: false }` result. These qualifications do
not prove native messages, stacks or host prototype equality. The new README
does not claim such equality, and this docs lane does not rerun or expand the
error-boundary investigation.

## Preservation, evidence provenance and gates

Removing only the added bullet reproduces every byte of the base README.
All eight fences and existing inline examples remain unchanged. The published
copy-alias paragraph, guard compilation/ownership bullets, corrected Array
wording, String, Float, locale, Map/Set, host-policy and browser/FS content remain
unchanged. No example, public option, environment variable, CLI flag, screenshot
or new language-support claim is introduced.

Author source results remain attributed: initial 6 failed / 7 passed; qualified
source and built baselines each 4 failed / 9 passed; then 13 source and 13 built
comparisons of the same thirteen unique recipes. The 3,016 regression passes
include the new thirteen tests and must not be counted again. Historical
formatting failures and all raw RED receipts remain retained by the source
owner. These counts are not executions or independent acceptance by this docs
reviewer. Root's latest same-byte final three-source-file format PASS is a later
reported check, not a rewrite of the manifest's earlier formatting chronology.

Franklin's STATIC READY is scoped and is not fresh runtime READY. Root reports
fresh source validation waiting for CPU, while Laplace separately validates
the installed alias 13.0.5 artifact. That installed-artifact activity does not
certify the unreleased frozen-search repair. Root's actual 13.0.5 publication
update supersedes old pending-alias-status prose only chronologically; this
review does not poll npm or claim the search repair already shipped.

Before publication, obtain final independent acceptance of these exact source
bytes and the current publisher preimage/dependency/composition gates. Pair
these three documents with the accepted frozen-search fix. No standalone fix
release, future version or final runtime success is claimed. A source or README
preimage change requires a bounded delta check; the remaining raw and future-flag
gaps stay open after this documentation approval.

## Checks and ownership

The independent capsule authenticates the author manifest and its nine indexed
payloads, the final source manifest, its small checksum index and the three
selected source postimages. It records current preimages and absent new-plan
identities, the exact single-bullet diff, unchanged fences, selected source
excerpts and source case/qualification metadata. Three documentation-format
checks and strict forward/reverse checks cover the exact three-path patch.
The expected new-file diff exit 1 has empty whitespace diagnostics.

One readonly report lookup initially exited 1 because the reviewer mistyped
`safejs-remediation` as `safejs/remediation`. Reading the exact supplied locator
succeeded; no alternative source candidate was substituted and no file changed.
That metadata lookup failure is recorded separately from source/runtime results.

Only lightweight metadata/hash/format/patch commands run; Prettier is loaded
read-only from an existing owned installation. QA is this agent-executed Markdown
review, not an executable runner. No target runtime, build, install, test,
compiler, original archive read, security probe, source/author edit, shared README
edit, ledger/home/SKILL change, branch, commit or push occurs. All earlier capsules
and the original checkout remain unchanged. No heavy worker is started.
