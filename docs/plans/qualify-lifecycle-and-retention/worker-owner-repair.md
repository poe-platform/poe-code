# Realm atomic worker ownership

Task: qualify-lifecycle-and-retention. Public persistent-realm contract: cleanup
is realm-owned and runs once at close. Two evaluations with one cleanup slot
must reuse that realm's atomic worker; another realm must retain its own worker.

Reproduced on local `75d523a7bd66ed8d9811b158ac5aaffac806d229` plus preserved
local changes, and isolated remote main `d3acfb10092c3b4b39aa3f370464dee1a774da53`.
Node 22.23.2 / ICU 78.2. The deterministic worker acknowledges/settles each wait.
The second evaluation originally failed `Realm cleanup limit exceeded`; the
separate-realm isolation control passed. This is a SafeJS lifecycle defect,
not an ECMA-262 language defect.

Regression command: `npx vitest run packages/safe-js/src/realm-resource-ownership.test.ts`.
First red: 1 failed/1 passed, 113 ms tests, 2.37 s command. After the stable
resource owner change, both passed. The owner is reused for evaluations and
callbacks; no cleanup limit or budget is raised. Full qualification and unresolved
backend cells are recorded separately in safejs-gap-closure-evidence.md.
