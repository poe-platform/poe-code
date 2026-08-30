# Bounded independent DU type-workflow review — 2026-08-27

## Scoped verdict

The frozen classification/exclusion repair and maintained installed DU-leaf route
are supported by the bounded checks below. **The unchanged Node24 canonical
fixture remains failing, 7/8.** This is a nested-reporter assertion failure, not
evidence of a DU or native-data exclusion failure. No candidate edits, rescoring,
public DU acceptance, whole-gate acceptance, superiority claim, or moving-HEAD
assessment is made.

## Authenticated identities

- Classification/exclusions/leaf: `5f6960a277f37c69bc6ec04b74018438db46e956`.
- Compiler-policy fixture: `bca8848f2cf5e843efe51298eea5897943b32ce0`.
- Candidate: `491da31cc6ef07a3bc4584c15ae2efe9f0482c96`;
  tree `0682029eeea9c0b0a639e450ff86288f210735c0`.
- Author evidence: `e9843e601859282de25fa40742529c6be6668bf3`.
- Exact packed artifact SHA256:
  `08667ba7a67c5e9342c062007265279965138afe99c700f756df3e8ec97533f3`.

Commit trees, parent ancestry, exact path deltas, all 65 author evidence payloads,
the complete 314-record author source/config witness, and all 830 package regular
files authenticate. The final consumer assertion correction changes no product,
package metadata, lockfile, build config, or root README from `bca8848f`.
The package is the authenticated author build, **not an independent rebuild**.
Only 282 selected Git inputs were materialized; no full archive or live product
source was substituted. The pinned inventory contains all 192 candidate `.mts`
paths, but that inventory verification is not compilation of all those files.

## Independent execution

| Bounded cohort | Observed result |
| --- | --- |
| Original DU records and owning manifests | 14/14 unchanged versus the pre-classification commit and evidence candidate; exact 6 sealed / 5 versioned / 3 reusable roles |
| Admission negatives | 41/41 expected rejections: all 14 missing and 14 same-length mutated originals, plus owner/role/path/route/exclusion controls |
| Count-preserving valid-role swap | Structural verifier accepts; canonical pinned-policy test rejects, exit1. This is a documented separation of enforcement, not structural role-immutability |
| Maintained DU consumer | Same original bytes strictly compile installed and after moving; Node22 installed and moved executions exit0; Node24 moved execution exits0 with its supported permission flag |
| Original template contents | 2/2 byte-identical strict compilations against authenticated candidate declarations; 603-byte variant covers 9 paths, 554-byte variant covers 5; **zero template runtime executions** |
| Package boundary controls | Missing leaf types exit2/TS2307; missing runtime exit1/ERR_MODULE_NOT_FOUND; changed declarations compile but fail package binding; real source read denied with ERR_ACCESS_DENIED |
| Exclusion boundary | All 14 literal DU data paths excluded; source/test and five versioned-template neighbors produce exactly 7 TS2322 diagnostics, exit2 |
| Unchanged canonical fixture | Node22.22.2: 8/8, exit0. Node24.11.1: 7/8, exit1 |
| Explicit-TAP synthetic follow-up | Both runtimes: filtered 5/5, exit0; unfiltered 7 tests / 2 deliberate data failures, exit1 |

Root include/options remain unchanged; exclusions add exactly fourteen literal
files, not a DU directory. No original rename, source/dist import redirect, or
default/public DU integration was introduced. The consumer checks VFS bytes,
exact output/refusal status and empty streams under the combined one-byte cap,
and disposal. Resolution traces bind its root and internal-leaf imports to the
same package. Complete post-run inventories verify all 282 selected inputs and
830 package files, including detection of newly added regular files; empty
directories are not records.

Author-only claims remain author-only: `typecheck:all` exit0, 23 strict groups,
3 negative groups, and 75 controls. None was independently rerun wholesale.

## Reporter blocker and minimal recommendation

At the unchanged `controls.test.ts:199`, Node24's nested child exits0 with five
passing tests but emits spec text (`ℹ tests 5`), not TAP (`# tests 5`). The later
unfiltered negative in that same canonical test is consequently unreached.
Independent direct-child receipts retain both the successful exclusion boundary
and the intentional unfiltered failures.

Recommend a separate fixture-only patch, **not applied here**:

1. For the current forwarding npm script, call
   `run(copy.directory, "npm", ["test", "--", "--test-reporter=tap"])`.
2. For the synthetic historical direct-node script, insert
   `--test-reporter=tap` immediately after `--test`, **before** its positional
   `"tests/**/*.test.ts"` glob. Preserve the immutable `before-02.json` and all
   count, named-neighbor, marker, and natural-exit assertions.

Merely appending npm arguments to the historical script is insufficient on this
Node24 profile; that failed reviewer experiment is retained. The corrected
placement is verified only in reviewer-owned synthetic fixtures, not rescored as
an 8/8 canonical Node24 result.

## Evidence limits and reviewer corrections

`receipts/execution.json` retains the initial 56 assertions (54 pass, 2 reviewer
assertion failures) and 17 raw command receipts. Three command outcomes also
expose reviewer harness errors: unsupported Node24 permission spelling and the
reporter-option placement described above. Flat-versus-recursive inventory
ordering caused the other reviewer assertion failure; bytes were unchanged.
`receipts/followup/result.json` separately records 4 correction commands and 7/7
checks, without replacing any initial result. There are 12 additional direct npm
child receipts across the original and follow-up probes.

Four pre-execution preparation failures and the first shell PATH-variable mistake
are preserved separately, with original supervisors. One oversized preparation
diagnostic was truncated by the interactive tool; its retained excerpt is
explicitly identified, not claimed as complete raw stderr. All executed test
receipts retain full stdout/stderr, natural status and signal.

Both runtimes are local Darwin arm64 profiles; Node24's broken npm link required
explicitly using the pinned Node22 npm implementation under each selected Node.
Development tools were hashed before execution; absolute author `.bin` links were
verified against archived tool bytes and flattened locally. No packages were
installed. No HTML34, whole gate, provider workflow, or private repository was run.
