# Environment contract delivery QA

Use the pinned ECMA-262 edition 16 / ECMA-402 edition 12 target; keep newer APIs separately tracked.

1. Build the maintained SafeJS workspace closure before source tests; retain failures from attempts made before generated dependencies exist.
2. Run ambient/direct/computed/Function denial controls for node/core, explicit env and helper grants, registered import refusal, manifest/grant validation, callback revocation, cleanup, CLI configuration and filesystem validation/race controls.
3. Reproduce the private MCP declaration import before repairing it. Preserve private-runtime packaging denial. Build and package the candidate into a canonical task-owned directory; inspect and install the artifact only after complete packaging.
4. Smoke core/node/workerd entrypoints only with the supported host conditions. Node execution of a Workerd entry is not actual Workerd qualification. Record unavailable cells without claiming success.
5. Commit only task-owned files. Fetch, reconcile remote main and revalidate. Use normal hooks, verify remote ancestry and monitor required workflows to publication or explicitly recorded blockers. Verify actual package versions, integrity and provenance independently.

Blocking native calls cannot be interrupted or rolled back by cooperative cancellation. Filesystem path validation is not an atomic namespace sandbox. DOM and unrestricted npm/CJS loading are outside the host contract. No visible CLI change is planned; screenshot QA applies if a visible change occurs.
