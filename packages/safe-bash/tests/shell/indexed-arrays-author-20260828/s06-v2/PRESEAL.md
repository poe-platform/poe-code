# S06 author repair preseal — August 28, 2026

This new cohort is sealed before product edits or product validation. It is not
Plato's independent acceptance, a rescore of old c7, or a native/oracle comparison.
The original foundation.test.ts, syntax.test.ts and public-consumer.ts bodies and
all old captures/seals stay unchanged and are individually hashed in MANIFEST.json.
The unchanged original source cohort is 32 test groups / 69 public execs; its ten
loaded mutants are retained in the versioned successor driver, not redefined.

Ratified G8 requires left-to-right, non-Cartesian aggregate splicing. Sealed S06
has a=(), b=(), word `"${a[@]}${b[@]}"`, expected argv []; S08 explicitly retains
`"""${a[@]}"` as [""]. The old reviewer package is full862 SHA256
0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26.
Product c7dae6e884d1a144266dfc1bb80785bf007a667f / source-test
50117fc54fdfd650e8f57e84b82ba21297ab8a0f / composed tree
d6c17f62d2d3062b5ab074044a86b8a455820373 remain immutable.

The cases vary zero-member @ independently from explicit empty literals,
scalar empty values, actual empty members, nonempty @/*, quoted empty *,
prefix/suffix, quote groups/literal quotes, quoted/unquoted pieces and repeated
left-to-right splicing. Existing scalar/positional controls are separate.
`baselineFailure` predicts c7 assertion failures from source inspection only;
baseline still asserts the proposed expected argv and retains every failure.
Unexpected expectation mismatches must be reported before any correction;
integrity, safety or cleanup failures stop the attempt. No broad rebaseline.

Source diagnosis: parser word() unconditionally injects/merges empty quoted text
on quote opening, and runtime word() counts it as present. This discards the
distinction between synthetic quote syntax and an explicit empty literal before
runtime expansion. The intended state is field presence from real literal,
scalar or member contributions; zero-member @ contributes no presence, whereas
quoted empty * is scalar and contributes a field. Minimal parser provenance
correction was requested from root. Root requires preserving actual observable
Word.parts entries, not just their type shape. The selected design therefore
retains quote-opening text entries and marks their synthetic-only provenance in
a private WeakSet using the existing arrays/syntax.ts metadata pattern. Literal
text merging and genuinely empty quotes clear that marker; quote openings never
erase a previous literal contribution. Explicit copies through copyArraySelector
must carry provenance; prefix removal keeps reused parts and cannot slice an
empty synthetic marker into a new part. Runtime field presence consults this
private provenance only in array-owned expansion, leaving scalar-only behavior
unchanged. Public AST equality has a separate regression assertion; lazy alternate
controls exercise actual metadata copying. No implementation exists at this seal.

There are 50 targeted argv cases plus one public-AST-preservation test. Nine
argv cases are source-predicted baseline failures. During authoring, a driver
generation command failed with a JavaScript SyntaxError before producing a file;
no product validation or product write occurred. The corrected versioned driver
is separately bound in MANIFEST.json, with the old driver unchanged.

Validation reconstructs accepted DOTGLOB 265 selected inputs plus exactly the
four c7 private modules, frozen c7 shell files and only the committed repair
overlay. Neither raw HEAD nor unrelated live source is a product input. Original
G4A bounds remain logical private ownership bounds, not command-wide memory/RSS.
No declaration, cleanup, provider, registry, shared-budget, held command, native,
network, installation or comparator work is authorized. npm pack is offline
with scripts disabled; installed consumers use physical archive extraction,
never npm install or source fallback. Existing consumer body runs unchanged,
then versioned S06 consumer runs all targeted cases in installed/moved layouts.

## v2 transport-only correction

The v1 c7 baseline build passed, then strict checking stopped on the new test
import `src/fs/memory.js` (TS2307). The existing module is `src/fs/memory/index.js`.
No runtime case executed, no expectation changed, both process groups were
reaped. v1 sources/manifest/capsule remain immutable. v2 changes only that new
fixture import; all 50 argv assertions and the AST assertion remain unchanged.
This v2 seal still precedes any product edit.
