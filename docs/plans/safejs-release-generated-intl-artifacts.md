# Preserve generated Intl source artifacts in release validation

Release 34226919118 shared unit job 102065571124 failed 42 files because source
imports could not find packages/safe-js/src/intl-data/dist/numberformat-engine.js.
The same run's build succeeded. The artifact archive includes root dist and
packages/*/dist but omits the generated source-side Intl directory. Fresh
checkouts do not contain that ignored directory. Shared root/workspace tests
import SafeJS source before the SafeJS workspace's native pretest generates it.

Include the generated source-side Intl directory in the same-run, SHA-verified
build archive. Keep the generation in the maintained build; do not commit
generated output, reintroduce asynchronous bundle initialization, bypass tests,
or rely on stale runner files.

Validate with npm run lint:workflows and a tar stream listing proving the
source engine/data/declarations are included. No workflow unit tests per
repository policy. Deliver this configuration fix independently of the
pending RelativeTimeFormat feature and monitor the next release.
