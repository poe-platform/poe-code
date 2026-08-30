# C09 reviewer correction — qualified SOURCE ACCEPT / PURE ACCEPT

Date: August 29, 2026. This is a new, append-only correction to review
`c14ced251`; the old 11/12 replay, raw C09 failure, report, helper and receipt
remain byte-for-byte unchanged. It does not rewrite the old result into 12/12.

## Corrected comparison

`correct-c09.mjs:51` implements the reviewer's narrow primitive-array comparator.
It uses realm-independent array shape, exact ordered own keys, own data
descriptors, bounded finite length, explicit descriptor flags and exact primitive
type/value/order comparisons with `Object.is`. It requires dense index keys and
the own length key, rejects extra string/symbol keys, accessors, altered
descriptors, holes, non-arrays and nonpermitted/nonfinite values, and never
invokes index getters. It does not compare prototypes or serialize operands
through JSON. This is a fixed C09 sequence comparator, not a generic object
equivalence or hostile-host sandbox claim.

The author's exact C09 line and unchanged test/capture prelude run in the VM;
the unchanged writer and finalizer remain in the main realm, retaining the
original cross-realm condition. Only the reviewer's `deepEqual` assertion is
replaced. Other assertions remain the original strict assertion functions.
Author controls, writer and finalizer bytes match the prior authenticated audit
before evaluation and again after the controls. The execution seal remains
`0efb8f129c77f02a119548f9308eca39ad70ca73c5fb548c1fa9918b757326f2`.

## New observed evidence

One permission-restricted PURE helper runs exactly these four groups:

| Group | Result |
| --- | --- |
| C09-every-cleanup-attempted, exact author body with corrected comparator | PASS |
| X01-cross-realm-exact-keys-and-descriptors | PASS |
| X02-cross-realm-accessor-rejection-without-invocation | PASS |
| X03-cross-realm-primitive-types-values-and-order | PASS |

The three negative groups reject malformed cross-realm inputs rather than
weakening equality: holes/extras/symbol keys and descriptor changes; an accessor
whose invocation counter stays zero; and wrong primitive types, signed zero,
null/undefined, object/boxed values, nonfinite numbers and reordered elements.

`RESULT.json` binds the exact C09 line, generated control and comparator hashes.
`DIRECT-CAPTURE.log` was established by the outer shell before the helper;
it records the helper's output and exit 0. No second helper or retry was used.
All nine prior review files are hashed before and after the helper; the
before/after identities are recorded in `RECEIPT.json` and remain equal.

## Qualified verdict and inherited evidence

**SOURCE ACCEPT / PURE ACCEPT**, confined to this writer-delta review and
its version-qualified evidence composition: the earlier eleven passing author
groups, this corrected C09 pass, and the earlier eight passing novel groups.
The eleven other author groups and eight novel groups were not rerun. The new
three comparator-negative groups pass separately. This is not a fresh combined
12+8 run and does not rescore the older, unrelated newline-bug novel cohort.

The conditional prospective bound remains **332,129,069 logical bytes**,
including layout generations, captures, metadata, tails and one publication
copy; unique captures remain **131,072,000 bytes**. This is not an OS disk/RSS/
Git-internal physical quota, fresh layout census, or enforcement qualification.

Source/preseal remains `e33b99af9fbec345b4f5a76d50f627c3d4d9f73a`; author
evidence remains `d40efe4068545ecff91cfb4051806dc0417427da`. No author code,
product source, package, transport repair or guard is changed. There is no
product, Worker, ERE, compiler/build, installation, native-oracle or network
execution. Fresh materialized-layout/guard/private-transport qualification and
actual ROOT GO remain absent. Private close remains UNOBSERVED; H03 depth/H04
ticket exhaustion remain SOURCE-only. The later 1800-second global guard,
including 180-second publication reserve and next-case fit admission, is still
required; the inherited 125-minute guard is untouched and unapproved.

## Prior prose erratum

The old `REVIEW.md` says eight shell roles. **Nine shell roles is correct; the
prior total of 36 known roles is unchanged.** This new erratum supersedes that
single prose count without editing the historical report or raw captures.

## This invocation and receipt

Start: 2026-08-29T15:06:09Z. Publication-inclusive deadline:
2026-08-29T15:12:09Z. The helper records completion at 15:08:37.570Z.

The invocation-local known-role plan through final publication is exactly 18:
initial shell/date/three Git metadata roles (5); patch shell/patch role (2);
test shell/single Node PURE helper (2); publication shell/patch, prior-file Git
diff, scoped Git add, scoped staged whitespace check, explicit-path Git commit,
full commit identity, receipt SHA256 and final clock (9). Known peak is two,
within the approved peak-three ceiling. This is not a universal transitive OS
census; commit hooks, signing and automatic maintenance are disabled.

New owned logical bytes before receipt/publication are 12,092. The admitted
1,048,576-byte publication reserve yields a 1,060,668-byte new-file envelope,
below 96 MiB. Bounded output is far below the 24 MiB capture allowance. The
snapshot explicitly precedes receipt/report creation and final log appends;
the final atomic commit, not that snapshot, binds the published file bytes.

Machine receipt: `RECEIPT.json` in this directory.

Receipt SHA256:
`fbc5797d8ee2c49a81ada006620f19a4f7ee6e3ec9cc8574b0f2f7da4a44fbcf`.

The full final commit identifier and independently checked receipt SHA256 are
returned in the publication output. Only these five new correction files are
staged/committed; foreign staging is preserved.
