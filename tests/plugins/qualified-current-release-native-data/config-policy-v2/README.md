# Exact compiler-policy fixture migration — August 27, 2026

Author source91d56dbe changes only the maintained `controls.test.ts`. No root
config, compiler, product, inventory or historical capture was changed.
Different-reviewer acceptance is pending; this is not a whole-gate rescore.

The original assertion compares the live config to its original native-data
baseline plus one native subtree. Approved b9559de5 later added exactly five
flattened historical contract captures and a built-consumer typing workflow.
Consequently the unchanged original file is4/5 against the current config,
with exactly that assertion failing. Its source and raw TAP are preserved here;
frozen8670's12 raw failures and failed immutability gate remain untouched.

The replacement expectation is independent of the current config: it authenticates
the old `before-02.json` SHA256, preserves all original settings, and appends the
literal native subtree plus five explicitly named captures. The approved capture
classification is separately pinned to its original SHA256. No wildcard, sixth
capture, unknown exclusion, current-source exclusion or strictness reduction is
accepted. Current source/test includes are unchanged. The three typing script
entrypoints and four required current source-consumer files/three explicit routes
are checked without imposing a brittle total count on future additional groups.

## Author evidence

- Original4/5; migrated8/8, zero skips/TODOs. Four unaffected old tests retain
  their assertions, including six real TS2304 errors and actual npm discovery
  of five eligible tests versus two excluded native data files.
- Eight explicit policy mutations refuse: unknown/wide/sixth/current exclusions,
  missing approved/native exclusions, lost test include, and disabled strictness.
- New real compiler control includes all five current contract counterparts plus
  three neighbors. The five captured files are excluded. All eight eligible
  files independently produce exact TS2322 diagnostics when corrupted.
- A real copied-test mutant replacing the comparison with `current === current`
  fails the new mutation test (7 pass/1 required failure). Only two relative
  imports are relocated for its isolated scratch; the actual source is untouched.
- Strict NodeNext scoped TypeScript compilation passes without diagnostics.
  Commands/source hashes/raw evidence are in `RECEIPT.json`.

## Actual gate-integrity scope

`guard-scope.mjs` runs the verbatim post-phase `verifySource` function from
admission6699804a against owned miniature files, alongside unchanged fresh
archive verification:10 observations pass. Initial admission rejects extra
source/artifact files and empty directories. Post-phase verification detects
tracked byte/mode changes and deletion, but **does not enumerate new entries**:
an extra source file, evidence file or empty directory is not reported by it.
The source hash/function hash and exact observations are in `guard-scope.json`.

Separate staged-artifact hashes protect only their listed files; native and
dependency checks likewise concern listed assets. This does not establish an
append-proof tree, arbitrary host-JavaScript confinement, detection of identical-
content rewrites, or a post-run check of every generated output. No guard is
changed or weakened here. A future post-run entry census needs explicit generated-
output policy because builds, tools and owned consumer scratch add legitimate
entries. Such a change requires separate review, not a silent universal claim.

The separately authorized fresh8670 runtime-consumer/package cohort is not this
fixture review and cannot turn the failed whole attempt into release acceptance.
