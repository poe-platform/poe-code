# Prospective public-boundary fixture v2 — UNEXECUTED

The sole author attempt on c83f352f retained three failures:
source-m1a/PUBLIC-NEGATIVE, installed-m1a/PUBLIC-NEGATIVE and
moved-m1a/PUBLIC-NEGATIVE. Each expected `gitCommands in api === false` and
observed true. The same row's later expectation of an absent commands/git
subpath was unreached. This was a correct old module-only boundary and is
incompatible with the explicitly authorized new public integration; no Git
parser/query/pack behavior failed in these rows.

New `m1a-public-v2.mjs` changes only this one row to PUBLIC-REGISTERED:
require the root export present and the exact declared subpath mapping. The
zero dependencies/optionalDependencies assertions and all other139 rows remain
byte-identical to the consumed m1a.mjs composition version. Its earlier two
changes versus the historical author file (explicit after-aggregate replacement
and the30s case watchdog) remain documented in FIXTURE-VERSIONS.json.

This is a new fixture candidate, not a product change. The derived product tree
c83f352f057c64917f219eb938f54aa42cdab829,292 build inputs and actual950 tar
4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156 are unchanged.
No product execution or rebuild follows this correction. Original139/140 each,
three failure captures, original historical module-only row and all prior module
failures remain. Different review must approve and execute this correction;
do not passively promote it to140/140 or reuse the consumed EXECUTOR as if it
authenticated this new file.

Suggested independent negative controls, not executed here: missing root
gitCommands must fail the revised first assertion; missing or changed subpath
must fail the revised mapping assertion; runtime/optional dependency injection
must still fail the unchanged assertions. Existing actual G01 and six type
groups independently exercised these public exports on the candidate, but that
does not rescore this row.
