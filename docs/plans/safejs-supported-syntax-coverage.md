# Supported syntax adversarial coverage

The Test262-style adversarial file still skipped classes, private fields and
array elisions with descriptions claiming these were outside the language.
Current built-runtime probes verified inheritance/super dispatch (7), private
field access and branding ([7,true,false]), and holes distinct from undefined
([3,false,true,false]). Replace those empty skips with active assertions.

Dynamic import was probed separately with a registered fixture module and
still raises a ParseError. Its skip remains, as does the proxy/weak-reference
gap. Do not claim those capabilities are implemented. This is a test-only
coverage correction; no runtime or historical fixture is changed.

Run the focused file, the maintained adversarial route and relevant lint
before a separate conventional commit and direct main push.

Focused run 61203 passed six active cases with two remaining unsupported skips.
Maintained adversarial run 38737 passed 11 tests across five files, with those
same two skips. Candidate ESLint 48920 and whitespace checks passed. No build
is required for this test-only change.
