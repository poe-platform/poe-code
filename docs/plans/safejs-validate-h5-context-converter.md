# Independent H5 context-converter review

Date: 2026-08-29. Reviewer: Nash, directly delegated; no nested agents.

## Verdict

**SCOPED H5 SOURCE/SEMANTIC PASS; CLEAN/FULL PUBLICATION AND FINAL COMPOSITE HOLD.** No H5 production repair is indicated by this review. This is not a twelve-profile O05/O13/O14 closure and not approval of the completed-Map behavior.

The frozen H5 converter resolves the two original representation failures through a typed, context-scoped public API. Native-first original workflows, fresh-process recovery, genuine callback identity and conversion-without-invocation controls pass. Generic native-function rejection remains intact. The five original unchanged Nash publication files are byte-identical; only the two unsupported generic fixture conversion calls move to the new context API. No expected assertion was weakened by this reviewer.

PPR2 packaging is now independently READY/root-approved after CTX, with actual publisher-main gates still required. Its 27 author paths match the previously staged fixture refresh exactly; the 28th path is the independent packaging report. PPR1/G01/default-setup final capsule is still awaiting an exact frozen locator/hash. No live Turing files were read. The separate completed-Map finding remains OPEN with Boyle as single fix owner.

## Frozen inputs and scope

| Input                                  | SHA-256                                                          | Treatment                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| H5 author review candidate             | 6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74 | Verified all 587 listed artifacts, 18,593,577 bytes.                                      |
| PPR2 author fixture refresh            | 442d7028a286a43b2e9bcb6d5b3a54df11438a4bd5d4860bb874f75b3e4a2ade | 23 nonproduction publication paths staged; no 50-prerequisite overwrite.                  |
| Root-approved PPR2 28-file publication | 31d14e25974bf910ec253539458085d903d1c38a6ccd3551b2f4992b1dd136b0 | Verified 27 unchanged postimages plus one additional review; staging only the new report. |
| Original H6 handoff                    | c603eafb5f8d100087e81510ebe453ac41b99b3f71c8724c6e559d4f9e40188f | Preserved, not amended or relabelled final.                                               |

H5 locator: /Users/kjopek/Workspace/poe-code-safejs-function-proof-conversion/out/safejs-remediation/function-proof-conversion/review-candidate/manifest.json.

Approved PPR2 locator: /Users/kjopek/Workspace/poe-code-safejs-ppr2-fixture-packaging/out/safejs-ppr2-packaging-independent/publication/manifest.json.

Review workspace: /Users/kjopek/Workspace/poe-code-safejs-async-proof-execution. Existing isolated base: 7203ec5135edce5a4da2e603778fd91c3fe042e9. The candidate runtime uses immutable base 6e3733a0df3b764a5d87d5f19fe6142bfed905f1, 19 captured source overrides, and 125 current TypeScript runtime files. Source manifests distinguish this from old worktree source or installed dist.

H5 scope is eight delta paths, six ordered preimages, thirteen intended publication paths, and exactly two production files. H5's eight-file patch is not interchangeable with its thirteen-file publication patch. Five unchanged Nash files must remain part of publication. This review adds only its report and two proper package test/config files; no production edits, README edits, branches, commits, pushes, or home/other-clone writes.

| Production path                           | Ordered preimage SHA-256                                         | H5 postimage SHA-256                                             | Postimage bytes |
| ----------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | --------------- |
| packages/safejs/src/interp/host-bridge.ts | 963698796bc0f846a319376762dab65918634223f4ceedd8eaf70da2e0543e83 | 4ee1fad8e50568478ab5cb0bc6923aa77c40a3811ba53c8d14c23c633bbfb1b4 | 35998           |
| packages/safejs/src/interp/host-call.ts   | 1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc | b8abcf757ac5d4af1a8fb1af96758cd7d703b93c172304edb940d6d413c67d7f | 26942           |

The composed packages/safejs/src/interp/values.ts remains 394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e. Do not overwrite it with an older NUM/PPR2 converter. The future PPR1 bridge pin 963698... is H5's ordered preimage, not a replacement for H5's 4ee1fa... postimage.

## Public boundary review

- host-call.ts:61 declares HostCallResumeContext.toSandboxValue(value: unknown): SandboxValue. Tests check the result against the public fulfilled-outcome type using genuine emitted declarations, not a cast.
- host-bridge.ts:151 creates a per-host-call provenance WeakMap. Genuine wrappers created by the existing sandbox-closure bridge register their exact wrapper/closure identity at line 710. The map is not caller-populated.
- At lines 374–386 the active resume context uses the existing cycle-aware graph copier with that map. It checks active lifetime and the existing abort signal. Reconciliation expires it in finally at line 387, including refusal.
- At lines 840/846/848/874 proof mode refuses raw sandbox capabilities, resolves only registered wrapper identities, and rejects unregistered functions and unresolved promises. It does not fall through to ordinary injected host-callable wrapping. H5 does not modify the generic converter in values.ts.
- Repeated conversion neither invokes compute nor creates callback invocations. Aliases/captures/cycles and callback-request IDs remain observable. A returned function is data in the proof graph, not a request to run a callback.
- Bounded benign invalid-value controls reject ordinary/nested native functions, a plain record with a native call property, a Set containing a native function, unresolved native promises, and genuine adapters from a different active context. Plain function-labelled data remains data. No private adapter, raw SandboxValue cast, forged proof, or broad host-callable acceptance is used.

These are ordinary public-contract controls, not a security review or an exhaustive claim about hostile objects. The precise static review and source line locators are in static-boundary-review.json.

## Independent tests and native anchors

The new packages/safejs/test/h5-context-converter-review.test.ts contains five fast in-memory tests: exact native source; pure repeated graph conversion; ordinary invalid values; foreign active-context rejection; and converter expiry after provider refusal. There are no filesystem writes, LLM calls or guest I/O. Gates use finite microtask budgets and explicit release/cleanup, not raised wall-clock timeouts.

The independent source expects value=7, before=0, one compute call, one callback, all function/object/list/Set aliases and the object cycle true, and calls exactly ["after-host", "compute"]. These assertions pass before and after replay; conversion leaves requests, callback keys, replayed IDs and calls unchanged. The real host record ends consumed.

The original frozen-source procedure is executed inline from the unchanged H6 Markdown child, not saved as a new QA runner. Its child SHA-256 is f2e13ed9ecf607564f0f20d2cc812aede74c66244b4155c5effca22c6b8d227c. The fixture library uses the new context conversion API but retains the original sources and expected assertions.

| Original case                                                                           | Exact source SHA-256                                             | Independent execution                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| O05 async-replay:/schedulerBoundaries/1; 05-callback-checkpoint::callback-external      | 2c89d4b9263d5adef1d04d0c9cb034be894d537526b7d5e220addf6c5c8181b3 | Native, in-process capture/recovery, capture child, separate fresh resume child all pass. |
| O05 async-replay:/correctedBoundaries/3; 09-callback-data-proof::callback-external-data | 464e5059007e0c8970604ffdb90aec4663fa115f908a90f330ffe871b1a64611 | Same four modes all pass.                                                                 |

Full expected native value for the function workflow (not a single-input substitute):

```json
{
  "result": [
    [
      [2, 21],
      [3, 31]
    ],
    [
      [5, 52],
      [7, 72]
    ],
    [
      [11, 113],
      [13, 133]
    ]
  ],
  "counters": {
    "callbacks": 6,
    "total": 410
  },
  "trace": [
    [0, 0, 2, 20],
    [0, 1, 3, 30],
    [1, 0, 5, 50],
    [1, 1, 7, 70],
    [2, 0, 11, 110],
    [2, 1, 13, 130]
  ]
}
```

All eight raw child receipts preserve PIDs, full stdout/stderr, exact argv/stdin, source hashes, native values, typed output graphs, host traces, pending/completed serialized checkpoints, real provider requests, proof returns and consumption anchors. native-anchors-and-suffixes.json contains the full expected/actual values, graphs and call arrays. Each resumed call sequence matches the required native suffix; returned proofs are consumed. The provider does not call compute to erase the function graph.

The unchanged joined/detached controls also pass. They hold/release callbacks explicitly and observe whether source progress occurs before callback release. A deliberately held future proof is not reported as a bug merely because it has not been released. No final O13/O14 or all-twelve-profile verdict is inferred from these H5 controls.

## Fresh commands and results

Evidence root: out/safejs-remediation/h5-context-converter-independent/. Every command receipt has exact argv, cwd, status, stdout/stderr and inline program where applicable. gate-command-index.json is the command index; original/\*.json contains the eight complete inline child commands. These are data receipts, not executable QA runner files.

| Independent gate                                              | Actual result                                                                                                        | Receipt                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Original tests on exact pre-H5 ordered two-file boundary      | 8 pass, 2 fail of 10; expected RED                                                                                   | fresh-original-red.json                                                                    |
| Candidate author + new independent focus                      | 21 pass (16 + 5)                                                                                                     | author-and-independent-focus.json                                                          |
| Author's portable local-source config, no runtime/out support | 16 pass                                                                                                              | h5-local-default-config-no-out.json                                                        |
| Final relevant host/converter/replay suite                    | 182 pass, 13 files                                                                                                   | relevant-host-and-replay-tests-final.json                                                  |
| New independent tests directly against projected TS           | 5 pass                                                                                                               | owned-tests-direct-current-source.json                                                     |
| PPR2 package-local default history + adjudication             | 59 pass (40 + 19), no old out fixtures                                                                               | package-local-ppr2-default-tests.json                                                      |
| Exact public declaration + ESM builds, candidate and pre-H5   | Pass                                                                                                                 | public-build.json; pre-h5-public-build.json                                                |
| Configured SafeJS types                                       | Exit 0                                                                                                               | configured-safejs-types.json                                                               |
| Owned/author tests against genuine public declarations        | Zero diagnostics                                                                                                     | owned-and-author-types-final.json                                                          |
| Author/owned ESLint                                           | Exit 0                                                                                                               | author-publication-eslint.json; owned-eslint.json                                          |
| All 13 H5 publication Prettier paths                          | Exit 0                                                                                                               | author-all13-prettier.json                                                                 |
| Prepared publication formatting                               | Pass after removing explicit unsupported .prettierignore parser input; exact two authorized history ignores retained | prepared-projection-publication-formats-retry.json; approved-ppr2-extra-report-format.json |
| Author 13-path strict whitespace diagnostics                  | Empty for all paths                                                                                                  | author-publication-whitespace.json                                                         |

The two RED failures are the original <root>[0].compute: function and <root>.compute: function generic-conversion errors. This is a fresh semantic reproduction using the old fixtures against the ordered production preimages, not a missing-new-method failure. The updated representation makes the same expected assertions green.

Do not sum overlapping test counts. The author's 24,579-root and 982-combined counts, Curie's PPR2 24,544-root/41-skip and 40/999/23 counts, and Turing's 24,403-root/41-skip count are external handoff evidence, not this review's fresh full gate. The 56 expanded legacy type diagnostics remain explicitly qualified, not silently declared passing. A complete clean root build/lint/default-test gate has not yet been independently executed here.

The first projection format command explicitly passed .prettierignore and returned parser error 2; the retry excludes only that non-formattable ignore-list file. It is not a source whitespace failure. Both receipts remain. For git diff --no-index --check, exit 1 with an empty diagnostic stream represents differences, not a whitespace defect; all actual diagnostics are preserved. No historical AW patch-application warning is used as a waiver for current-file formatting.

## Clean projection and remaining handoff

The prepared full source tree is out/safejs-remediation/h5-context-converter-independent/clean-projection. It comes from read-only git archive 6e3733a0df3b764a5d87d5f19fe6142bfed905f1 (3,799 tracked paths), the 90 frozen H5 composite paths, only the 23 nonproduction Pascal refresh paths, and the additional approved PPR2 review. That yields 96 distinct overlaid publication identities. No Git repository mutation, old 50-prerequisite overwrite, or README authorship edit is involved.

The projection has no out/ support directory. None of H5's seven legacy requiredValidationSupport paths is shipped into it. The two historical JSON files are the genuine package-local fixtures, loaded by relative URL; the root-authorized .prettierignore has exactly two anchored fixture exceptions. H5's executable publication fixture/config imports and path literals are local, verified statically and by the 16-test no-out run. This is not yet a clean dependency-install/full-gate claim.

The approved history qualification is exact: eight negative raw-v6 invocations cover four distinct packaged snapshots. Older evidence for eight distinct histories is preserved separately. The package-local fixtures are not re-labelled as eight distinct historical snapshots.

Turing's known old serial beforeAll at packages/safejs/test/integration/promise-alias-independent.test.ts:234 processed 40/54 captures before the default ten-second setup deadline. The user reports an approved repair using TWO fresh processes, without changing assertions, child programs, deadlines or Vitest configuration. This validation-only file is absent from the frozen H5 publication and base. We have not read or staged an unpinned live replacement. No occurrence of that old setup issue is classified as a new H5 production regression, and no hook timeout is raised.

When root supplies the frozen final PPR1/G01/setup capsule: verify hashes; preserve current G01/PPR1 values.ts and H5 bridge layering; stage only authorized immutable deltas; install/build in the isolated projection with a clone-local cache; run actual default full gates using env -u TERM with no hook-timeout override; retain failures and route source repairs to the assigned author. Re-seal successor evidence rather than rewriting this scoped capture. Actual publisher-main integrated gates remain necessary after queue application.

Boyle's separate OPEN finding is map.get(shared.compute) === shared becoming false after completed replay versus true natively/initially, with zero provider calls; other aliases/cycle/Set/value 7 stay correct. Source SHA-256: fee18fa1cb868e0ee313393032be182b9835b1b4be6f7f1b3cc036b5e0406a38. It reproduces on PPR2 baseline without PPR1 and on H5 composition. The author's completed-graph comparison records this qualification; its passing test does not close the native mismatch. No duplicate investigation or fix was performed here.

## Integrity and limits

The inherited exact 38 excluded identities plus the entire original security prefix remain guarded; the whole original audit root is denied for this task. No original audit payload, excluded read/hash/execute, security probe, LLM, guest real I/O, fake proof, snapshot-marker rewrite, private adapter, or arbitrary oracle weakening occurred.

No CLI-facing behavior was changed or newly validated in this scoped converter review. No screenshot or H7/runtime-SIGINT claim is made. Final O05/O13/O14 execution, completed-Map repair review, final PPR1 source/setup acceptance, and actual publisher-main gates are still separate work.

The sealed independent candidate is out/safejs-remediation/h5-context-converter-independent/candidate/manifest.json. It records the three owned publication files with absent base preimages, hashes/bytes, tested runtime source manifest, author eight/thirteen-path references, raw command/native evidence, and explicit HOLD fields. The old H6 capsule and the original frozen H5 candidate remain unchanged. Production repair request: **none for H5 within the reviewed scope**.
