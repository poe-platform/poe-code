# Remove unsupported npm release configuration

## Observation

Release run 33582884227 published `poe-code@14.0.5` from `adf11db97`.
Its release step emitted 385 warnings: 77 copies each of three unsupported
project settings and two inherited environment settings. The repository
declares npm as its package manager; these pnpm settings do not configure npm.

## Change

Remove the `.npmrc` containing only `link-workspace-packages`,
`package-manager-strict`, and `prefer-workspace-packages`. Preserve the declared
npm workspaces and native workspace lifecycle commands. Do not hide warnings,
change logging levels, or disable npm configuration validation.

## Validation

Reproduce the project warnings with npm 11 using the existing configuration,
then repeat the same read-only manifest query after removal. Verify native npm
workspace discovery remains unchanged and run the normal commit/push hooks.
Monitor the next GitHub release for publication and warning recurrence.

The read-only npm 11.19.1 query reproduced all three project warnings before
removal and emitted zero stderr bytes afterward, with identical manifest
output. Native npm discovery still finds all 72 declared workspace packages.

## Runtime checkpoint

The complete local `npm test -- --concurrency=1` on `adf11db97` passed in
697.04 seconds, including required build dependencies and lint stress tests.
The subsequent CI workspace test stage passed in 17m52s; the full release job
took 27m56s. The published tag points exactly to that commit and npm's latest
tag is 14.0.5. These observations do not meet the current CI runtime target.
