# OS-process callgraph and scope

Source inspection only; no old workflow or product rerun. Paths below are under
`capture-membership-v3/future-v3/` unless qualified. PRESEAL sourceBindings hash
the inspected files; AGENTS bodies are never copied into artifacts.

| Site | Reachable OS-process route / qualification |
| --- | --- |
| controller.mjs child(), lines116–157 | Every declared Git/guard/build/type/product job -> supervisor.supervise -> node:child_process.spawn. Old one-child retirement guard excludes administrative processes. |
| supervisor.mjs | Detached direct child, bounded copied streams, timeout TERM/KILL, close and negative-group signal-zero retirement. Post-close group handling does not prove no concurrent descendants existed. Old peak is assigned, not an all-owned census. New controls retain admission, byte ownership, close-before-next and exact retirement semantics, but use exact child PID only because the two finite child routes cannot legitimately create descendants. |
| controller.mjs:229–237 | Direct /usr/bin/git ls-tree and cat-file --batch authenticate base/candidate/object inputs; administrative Git elsewhere is not included. |
| controller.mjs:262–268; guard-control.mjs | Node guard -> loader.registerHooks -> inert stub import; loader performs fs/crypto/module hooks in-process. Guard process lacks the product permission flags. Binary stdout guard is another Node child. |
| controller.mjs:271,215 | Direct Node -> TypeScript bin/tsc -> lib/tsc.js -> lib/_tsc.js; build and ten completed type children. Launcher enables Node compile cache, potentially writing ambient cache. No invoked spawn/exec/fork site found in the inspected compiler; the child_process string is a builtin-name table. This is static source qualification, not execution or universal containment. Future compiler needs a separately qualified contained route; these controls do not run it. |
| controller.mjs:192; bootstrap.mjs; loader.mjs; worker.mjs | Permission-contained Node -> authenticated bootstrap -> module hooks -> worker -> candidate dist/index.js and apply-patch/index.js. Worker builtins and product builtins differ; child_process denied, process ambient module/binding access replaced, network functions denied, no worker permission. Loader includes worker_threads in its product builtin list; Node permissions remain important. Host builtins/native implementation are not a hostile-host sandbox. No candidate import now. |
| controller.mjs:316–321 | Waiting runtime-seal barrier; separate operator Node -> execFileSync Git add/commit/rev-parse and Node -> Git show documented in runs/OPERATOR-PROCESS-QUALIFICATION.md. Waiting controller + helper + Git >=3. These ephemeral invocation bodies are NOT checked-in source; qualification is documentary and exact historical peak remains unknown. |
| runs/materialize.mjs:22,46,53,90–91 | Separate Node -> execFileSync /usr/bin/git show/ls-tree/cat-file; inherits process.env. compose-future is in-process text transformation. path-bytes is fs-free crypto/assert; controller-admission -> parent capture-io -> manifest-bindings (literal data) and path-transport-v2/path-bytes. These readCapture routes do not spawn. Materialization is not safe to overlap a controller. |
| runs/seal-runtime.mjs | fs/path/crypto/assert only, inventories/build receipt/source/harness/mutations -> wx+fsync runtime seal. Not itself Git; the operator wrapper provided the extra Git processes. Must become bounded in-process controller function, not another Node process. |
| freeze-inventory.mjs, data-controls.mjs -> capture-io.mjs | Administrative Node -> recorder.git -> supervisor -> Git. freeze-seals is in-process hash/JSON/patch stdout. independent-tree/path-bytes are in-process hash/data helpers. These administrative entrypoints also count if alive. |
| controller.mjs:358–398 | Finally inventories, JSON/base64/gzip archive, owned rmSync, FINAL wx, exitCode all in-process. Final peak assignment cannot certify administration. No archive utility subprocess. Unknown cleanup failure is preserved. |
| runs/verify-results.mjs | assert/fs/path/crypto/zlib only; read/decode/hash bounded captured fragments/archive and write derived reports. No product loader or subprocess. Invoking it as a new Node while controller alive would itself consume the second slot. |
| native Git / operator shell | /usr/bin/git is a platform tool-selection entrypoint; its helper/exec behavior is not qualified by its own hash. Git commit/add can consult hooks, signing, fsmonitor, attributes/filters, maintenance/GC; pager, lazy fetch/promisor, credential/remote helpers and aliases/external commands are additional routes. Prior environment only disabled system/global config and replacement objects, not this closure. Current repo config is core-only and scoped attributes absent at inspection, but this is not a future commit guarantee. |

## New finite control graph

`exec <sealed Node> controls.mjs <committed-preseal-id> <preseal-sha256>` is the
only control launch. Its imports are assert/fs/path/crypto/zlib/url/child_process
and local primitives.mjs (assert/fs/path/crypto only). No imported source from
the frozen workflow, compiler, private package or candidate executes.

`controls.mjs -> one direct native Git ls-tree` on only an in-process-built tiny
object database, then full close+PID absence; `controls.mjs -> one Node fixture`
with an actual child_process denial before nested spawn. During the handshake
the controller attempts another admission and must reject BEFORE calling spawn.
The fixture contains its full attempted nested body, not generated -e code in the
controller. It waits for `release\n`, exits normally, and is probed after close.
No `ps`, Git wrapper, administrative Node, compiler, loader, archive subprocess,
shell, watcher, native addon, private import or network callback is reachable.

`seal-author.mjs` runs only before control launch, producing an apply_patch stream;
it hashes bytes with a bounded chunk, copies immutable JSON job descriptors and
prints a patch. It never imports any bound source or calls child_process.
Development metadata Git and evidence-authoring commands are serialized outside
the controller epoch. Their processes are NOT excluded from ownership by role.
No controls are executable by canonical test discovery (.mjs, no test suffix).
