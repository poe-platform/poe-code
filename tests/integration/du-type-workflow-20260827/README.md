# DU staged-input typing repair — author checkpoint, 2026-08-27

Independent review is required. This repairs type-input routing, not DU source,
public exports/defaults, a whole-product gate, or the pending DU-v9 verdict.
No private checkout was accessed and no dependencies were added.

## Committed change set

- `5f6960a277f37c69bc6ec04b74018438db46e956`: exact classifications,
  owning-manifest verification, root exclusions and maintained DU-leaf route.
- `bca8848f2cf5e843efe51298eea5897943b32ce0`: separate exact compiler-policy
  fixture migration. Original raw-data/five-capture controls remain; fourteen
  literal DU paths, role/route assertions and additional exclusion controls join
  them. The old missing-capture mutation still removes an actual capture, rather
  than accidentally becoming a last-array-element DU mutation.
- `491da31cc6ef07a3bc4584c15ae2efe9f0482c96`: correct this new author consumer's
  invalid one-byte-cap diagnostic assertion, with exact status1/empty-streams
  and unchanged-file assertions. DU documents combined stdout/stderr charging in
  `src/commands/du/README.md:140`; no diagnostic fits that cap. This is a disclosed
  author-fixture correction, not a DU product fix. Original failed runs remain.

Final frozen candidate: `491da31cc6ef07a3bc4584c15ae2efe9f0482c96`.
Tree: `0682029eeea9c0b0a639e450ff86288f210735c0`.
No `src`, package/lock, build-config or root-README differences from the earlier
`bca8848f` candidate; intervening evidence is not additional source acceptance.

## Exact input roles and maintained coverage

`tests/plugins/qualified-current-release/staged-types.json` lists every complete
path, byte count, SHA256, owning manifest SHA256 and exact manifest input record.
All fourteen original `consumer.ts` files remain unchanged and tracked:

| Role | Count | Meaning |
| --- | ---: | --- |
| Sealed captures | 6 | Historical execution inputs, never rewritten/rescored |
| Versioned templates | 5 | Frozen v5 plus individually discovered v6–v9 inputs |
| Reusable templates | 3 | Still usable staged recipes, not disposable history |

The relative installed-leaf imports require the original isolated package layout.
Root compilation is the wrong layout for these fourteen files. The verifier
rejects missing/changed inputs, changed/unbound owning manifests, duplicate or
wildcard paths, unknown roles, and absent local-package/runtime routes. It also
retains the existing full `.mts` inventory and exact root include/exclude checks.
No directory-wide DU omission, artifact rename, cast, or source/dist redirect is
introduced. Unknown neighboring `.ts` type errors still fail compilation.

Maintained `du-leaf.mts` has `localPackage:true`. It strictly imports the real
installed DU leaf factories/options/limits, executes apparent-byte accounting on
a memory/overlay VFS, checks a one-byte combined-output refusal and file bytes,
and awaits shell disposal. This is internal-leaf coverage, not a root DU export.
The existing strict-resolution authenticator rejects an alternate leaf declaration
even when it adds an export that makes the compiler succeed. Missing leaf types
and runtime fail rather than finding repository source. File permissions reject
an actual source read while the positive moved consumer executes successfully.

Both unique original template byte variants also compile unchanged against that
same package, staged through `consumer.ts.fixture` to `consumer.ts`. These are
two current type replays covering the two contents represented by fourteen paths,
not fourteen runtime replays or rescored historical packages. Future new recipe
inputs should use this `.fixture` convention; old frozen names stay unchanged.

## Executed evidence

| Cohort | Result | Qualification |
| --- | --- | --- |
| Exact-role/admission and compiler/package controls | 75/75 | Author checks; includes deliberate negative compiler/runtime exits |
| `typecheck:all` implementation | exit0; one build | Cold archived input; source/tests, historical build-first input, three source-consumer groups |
| Maintained strict consumer groups | 23/23 | Type-only phase, zero runtime executions within typecheck |
| Existing exact negative-type groups | 3/3 | Their expected compiler exit2 diagnostics remain intact |
| Old exclusion policy on same current source/build | 14 TS2307 | Reproduces exact fourteen DU staging imports; not the old ten-file source revision |
| Canonical config fixture, Node22.22.2 | 8/8 | Includes actual included/excluded discovery and source-error controls |
| Packed DU leaf program | Node22 and Node24 exit0 | Same consumer bytes/package; VFS output/refusal/effect assertions and disposal |
| Two original template contents | 2/2 strict | Byte-identical staging; candidate declaration resolution authenticated |

Node22.22.2 arm64 Darwin binary SHA256:
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Node24.11.1 arm64 Darwin binary SHA256:
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
TypeScript5.9.3 `_tsc.js` SHA256:
`e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419`.
These are executed local profiles, not latest-version claims or Linux evidence.

Package **metadata (`package.json`)** SHA256:
`691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535`.
Actual **npm-packed `.tgz`** SHA256:
`08667ba7a67c5e9342c062007265279965138afe99c700f756df3e8ec97533f3`.
The three attempts that reached packing produced that same tarball. The moved
package has 830 authenticated regular files, no source tree or symlinks, and an
unchanged before/after regular-file inventory (empty directories are not records).
314 scoped tracked source/config inputs are Git-blob-checked and byte-stable;
this is not an append-proof inventory of the entire archive. All fourteen input
bytes and their owning manifests still authenticate after execution.

## Preserved failures and remaining harness issue

Raw evidence retains three unsuccessful author attempts, not three product
failures: an archive-buffer ENOBUFS before tests; a run with an out-of-layout
baseline type-root probe, `/var` permission-path alias, missing ESM metadata in
a synthetic compiler control, and the consumer's wrong diagnostic assertion;
then a corrected-layout run exposing only that wrong consumer assertion twice.
The final replay uses streamed archive hashing, physical `/private/var` paths,
explicit candidate type roots and ESM metadata. No budgets/timeouts were raised.

**A separate Node24 canonical-fixture profile remains 7/8, not green.** At
`tests/plugins/qualified-current-release-native-data/controls.test.ts:199`, the
unchanged nested `npm test` assertion expects TAP `# tests 5`; Node24's child
prints the spec summary instead. All five child tests passed, but that assertion
fails and the later unfiltered-discovery negative in the same test is unreached
on this profile. Node22 executes the entire unchanged eight-test cohort. The
Node24 raw result is retained; no reporter/count assertion was waived or changed
in this typing repair. A future separately reviewed harness fix should select TAP
explicitly for nested execution while retaining all exact count/discovery checks.
The Node24 packed-DU and permission checks here are separate successful cohorts.

This does not rescore the historical owned-output thirteen diagnostics, old ten
DU artifacts, DU-v8 timestamp controls, or any whole gate. The regex three-error
repair is separate accepted work; production and the original first-read tests
remain untouched. The first-read proposal stays unapplied.

## Reproduce and inspect

```sh
node tests/integration/du-type-workflow-20260827/verify.mjs
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node \
  tests/integration/du-type-workflow-20260827/replay.mjs \
  491da31cc6ef07a3bc4584c15ae2efe9f0482c96 \
  /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node
```

Replay requires existing Git/tar/npm and development dependencies; it installs
nothing. All builds/control mutations are in a new owned temporary archive or
separate control/consumer directory, never the live source/private checkout.
`capture.mjs` is explicit and refuses existing evidence outputs. The compressed
bundle preserves 65 raw JSON files, including every failed attempt and compiler
resolution trace. `verify.mjs` authenticates those bytes and checks the final
scoped claims, without pretending to independently rerun the product.
