# EXPRPUBLICCOMPONENT v3: HELD / incomplete component qualification

Recipe commit: 56f550afee7e6fd895b6d700e4cec376b6cf1eaf. Authorization label: August 28, 2026.

Reader admission: qualified; 16/16 qualified controls.
P01: fail; runtime artifact: separately authenticated authorpack; P01 remains failed.
Runtime assertions: 0 pass, 0 fail, 104 unrun /104.
Types: 0/0; package controls: 0/0.
Observed process children closed: true; postcheck: pass.

- P01: independent build/exact pack proof failed; authorpack cannot repair P01
- runner: Error: ENOENT: no such file or directory, open '/Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v3/cases.json'
    at openSync (node:fs:560:18)
    at read (file:///Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v3/common.mjs:16:22)
    at json (file:///Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v3/common.mjs:20:40)
    at bind (file:///Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v3/run.mjs:84:154)
    at file:///Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v3/run.mjs:248:27
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)

Accepted-DU and original gate remain HELD, unchanged and unrescored. HTML was accepted separately by root; no HTML/DU/TAP run here. No whole76/fullgate claim. V1 failures and unqualified v2 drafts are retained unchanged. Raw receipts and generated work remain available; no retry or product repair.
