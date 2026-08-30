# Memory faithful-method eligibility correction

This checkpoint applies the user-approved trusted backing-binding rule. It changes
only Memory's method-reference eligibility predicate, not the shared helper,
contracts, core, remote adapters, exports, rmdir, or metadata functionality.

## Source and actual reproduction

Before source SHA256:
`57a6148aec90c7a1db058e59bd2586e7c162c74498309e7173443096cb8906ad`.
After source SHA256:
`2ece749f3f22be6a0da76dcd964feb9b1055e742a05c727c43f672e9bc7ec8b4`.

Assigning `memory.readFile = memory.readFile.bind(memory)` previously removed the
otherwise truthful stat scope and made qualified comparison return unknown.
Mounted overwrite rejected ENOTSUP, leaving source `[1,0,255]` and target `[9,8]`.
The new unchanged positive probe also covers faithful method decorators and
subclasses, both remote kinds and both copy directions. Before the source edit,
that 15-test file passed 2 and failed 13, including a known-alias error regression
caused by losing truthful identity. Raw baseline is `before-faithful.tap`.

The sole production change replaces the root-plus-method-table predicate with
`this.root === root`. Constructor-owned backing observations, FS/path/stat/root
association, actual node metadata, scoped identity semantics, and original
comparison-function references used for dispatch are unchanged. Different
function references are no longer identity eligibility conditions. No new scope,
client token, blanket disjointness rule, or SDK binding API was introduced.

Content methods must honor the actual backing binding asserted by their metadata.
Redirecting data operations while retaining an unrelated inherited identity is a
host semantic-contract violation, not a compliant configuration this patch claims
to protect. This is not a JavaScript sandbox or a new atomicity guarantee.

## Preserved evidence and policy deltas

The complete original `comparison.test.ts`, including all nine override checks,
is unchanged; its hash is checked in `after.json` and its exact baseline is saved
as `original-comparison.test.ts.txt`. Prior `qualified-comparison-20260827` and
`late-authority-20260827` evidence remains untouched, including the three original
source-corruption observations and historical 31/38 versus qualified38/38 reports.

The complete Memory suite deliberately still reports **15 failed old-policy
assertions**; they are not skipped, erased, or counted as compliant passes:

| Suite case IDs | Exact case family | Classification |
| --- | --- | --- |
| 8, 19 | `qualified {s3,webdav} cannot bless altered or copied Memory observations` | The failing assertion expects a faithful readFile decorator to lose authority. Copied-stat and wrong-path checks still pass; the new dedicated observation test preserves those requirements. |
| 10, 11, 21, 22 | `genuine {s3,webdav} metadata with Memory-alias content mapping stays unknown {to-remote,from-remote}` | Metadata assertion describes a different backing store from content operations. These four were already red with the concurrent remote policy implementation before this Memory edit. |
| 30–38 | `Memory {subclass,instance,prototype-before-construction} data overrides cannot certify an alias to {memory,s3,webdav}` | All nine old checks retain their original ENOTSUP/no-effects assertions. Their data remapping contradicts inherited binding metadata. Current damaging observations remain raw evidence, not successful compliant workflows. |

`after.json` enumerates every exact name, case ID, classification and raw nine-case
byte/effect observation. Nothing relabels the observed source corruption as safe.
The two composite copied-observation tests were not weakened to make the suite
green. Test-policy reconciliation is explicitly separate from this source fix.

The three shared-authority cases in `late-authority.test.ts` previously obtained
unknown identity incidentally by changing stream method references. Their fixture
now explicitly omits the optional lstat identity scope, a legitimate unknown
observation. Their exact EIO/cancellation/ENOTSUP, once-per-operand and byte guards
remain unchanged. Twelve late-authority cases now additionally bind `readFile`
faithfully before exercising same/distinct/unknown/error/invalid/cancellation.
The exact earlier fixture is preserved in `original-late-authority.test.ts.txt`.

## Results and limits

- New faithful cases plus late-authority cases: **32/32**.
- Unchanged original four plus required 49 guards: **53/53**.
- Complete Memory before: **141/158**, with 13 new compliant probe failures and
  four already-red remote policy assertions.
- Complete Memory after: **143/158**, with the 15 classified assertions above;
  no additional failures, skipped tests, or cancelled tests.
- Memory-scoped strict noEmit: **exit 0**, no diagnostics.

`before.json` / `after.json` record HEAD and exact Memory, remote, contract,
fixture and relevant helper/core source hashes. Remote source hashes were stable
across the bounded baseline/fixed runs but included other owners' working-tree
changes. Therefore this is not a clean committed whole-product result. No remote
source was edited or included in this commit, and no independent expectations
were modified. The original positive gate was not rerun or claimed closed.

## Reproduction

```sh
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/faithful-binding.test.ts tests/fs/memory/late-authority.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/mount/copy-identity.test.ts tests/fs/mount/copy-identity-guards.test.ts tests/fs/overlay/copy-identity.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/fs/memory/*.ts tests/fs/memory/*.ts
```

The complete Memory command currently exits 1 for the preserved policy deltas;
do not describe it as green. Raw TAP retains original diagnostic whitespace.
