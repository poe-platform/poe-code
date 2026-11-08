# Independent Bash-surface preparation — August 29, 2026

## Disposition

PREPARATION ONLY. All40 B01–B40 identities and all nine proposed native qualification observations remain UNRUN. No Bash, product, compiler, build/install, Worker, engine, native oracle, comparator or service ran. Twenty-two non-Bash DATA controls passed on helper v1 and the same22 passed after the v2 whole-namespace capture correction; these are NOT44 independent cases or native/fence acceptance.

The exact user requirement is: "Make sure that on the surface nobody is going to notice that it's not a real bash". This packet treats observable bytes, status, expansion and file effects as the target, not identity spoofing. It does not establish indistinguishability or override Curie's separate implementation window.

## Immutable baseline and independent findings

Curie audit5e7ca89d958c68504e410faf1dbc82e0a2525e2c and CASES original SHA45ab3659b3769d33dc0a50fd9547ba96949540048aa7240385a674d85131ea29 are bound as stored bytes. CASES.original.json is byte-for-byte identical, including B37's source fixture, its final LF, and B40's literal backslash000. No accidental doubled-escape correction was applied to the40 inputs. Every expected value remains null/unassigned; no source-visible gap is promoted into a runtime failure.

The source-manifest pointer binds292 selected inputs and author-derived c83f352f057c64917f219eb938f54aa42cdab829. This review does NOT independently reconstruct that source tree or repeat Curie's implementation audit. It independently checks all950 regular tar members from the complete864000-byte package4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156. Public80 is an author candidate, not independently accepted. Mutable runtime/parser/display edits were present and were neither read as baseline nor included. Future |&/&> changes require a separate candidate and comparison.

The concrete public API has stdoutBytes/stderrBytes and optional ByteSink outputs. The prepared adapter captures copied raw sink bytes, including bytes before an API rejection; it never reconstructs output from text or fabricates a shell exit tuple for rejection. It awaits dispose. Full allowed fixture namespaces work/home/tmp/empty-path are captured, not just out files. Mode differences are retained alongside paths/types/file bytes and link targets. Native umask022 and VFS existing writer behavior are explicit, not silently normalized. Absolute root timestamps/inodes are not meaningful cross-backend identity assertions and are outside the declared comparison fields.

B11 must see only the original fixture names: capture/home/tmp/PATH are outside work. B13 is an explicit parser read-time/extglob case, not permission to change whole-script preflight. B23/B24/B29/B30 require actual native descendant accounting; B09/B14 also create subshell work. B28 uses exec for descriptors, not an external command. B37 eval executes only the sealed literal v=eval; no host eval or arbitrary input. B38 is EXIT-trap behavior, not a host signal test. B39 uses an empty owned PATH. B40 requires NUL/UTF8 byte preservation. Missing functionality remains visible, never silently dropped.

## Which cases depend on version qualification

All40 primary comparisons require the selected GNU5.3 profile; none is certified against the unknown local binary. CASE-REVIEW.json enumerates every row. B20/B21 mapfile/readarray were introduced in GNU4.0 (maintainer release reference below); an older local oracle must not turn their absence into a virtual-product result. B23 read-N, B24 |&, B28 allocated descriptors and B36 case fallthrough specifically need legacy feature qualification. This packet does not invent precise minimum releases where the captured primary reference was insufficient. B18/B19 declaration printing, B11 glob defaults, B13 parse timing and B32 nounset/error behavior also require version-qualified observations. The remaining identities remain pinned-profile tests, not an assertion that every old Bash supports them identically.

Curie's SOURCE-gap set B12–13/B17–22/B24–25/B28/B30/B32–35/B38 is preserved as SOURCE only. It is not the same set as legacy-version-sensitive cases.

## Native version/fence preseal and blockers

QUALIFICATION-CASES.json freezes Q01 version, Q02 startup/environment, Q03 positive owned I/O, Q04 outside-read denial, Q05 outside-write denial, Q06 symlink-escape denial, Q07 unexpected-exec denial, Q08 fork denial and Q09 loopback network-denial observation. All sentinels belong to the fresh task root, never user/private files. Q09 has no listener or intended connection; its attempt is NOT authorized now. A compiled-out network redirection or generic error is insufficient evidence of a kernel denial. Denials require attributed observer evidence, not merely absent output. Qualification observations require ROOT review; the runner never labels them automatic passes.

/bin/bash metadata is regular0555,1293840bytes,SHA35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3. Its version and dependency closure are UNKNOWN. /opt/homebrew/bin/bash is absent; other installations were not exhaustively searched. /usr/bin/sandbox-exec metadata is102560bytes,SHA d1ee30dbde955aaa75c7f801fdfea4df05b10129454d7982eb6453f771436d42; it was NOT run or qualified. Presence alone is not a containment guarantee. GNU5.3 patch015 is a source reference, not this executable's identity.

A concrete qualified kernel-fence/observer provider is missing. There is NO fallback to direct spawn, sampled ps, a process group alone, broad host read grants or an invented observer. run.mjs deliberately refuses before target dispatch when provider=null. The required begin/run/close provider contract and unresolved exact OS bindings are in PROVIDER-REQUIREMENTS.md. This is an actionable preseal and finite adapter, NOT a currently dispatch-ready native fence. ROOT must bind the provider's complete code/tool/dependency closure and reviewed outer containment first. Then a fresh local-version/fence GO may run the9 observations. Semantic GO is separate and additionally requires actual accepted GNU5.3 patch015 qualification. No install/substitution/relabeling is authorized.

## Code and commands

harness.mjs validates inputs, exact native argv/environment, process receipts, strict byte/FS comparison and complete membership. virtual-case.mjs contains the full950 materialized-package public Shell/MemoryFS adapter; it has NOT been dispatched. virtual-guard.mjs refuses Worker/subprocess/network capabilities and hash-admits product/harness JS; it is source-only and must be qualified by the different reviewer. run.mjs orchestrates the finite phases through the required external containment provider. It does not build or install and does not register fake commands. Materialized-package execution is not a new offline-installed/moved proof.

Future commands, NOT authorized/executed:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-surface-independent-20260829/run.mjs --phase qualification --grant /Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-surface-independent-20260829/QUALIFICATION-GO.json
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-surface-independent-20260829/run.mjs --phase semantics --grant /Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-surface-independent-20260829/SEMANTICS-GO.json
```

Templates are deliberately NOT GO and contain unresolved provider/receipt/deadline fields. Setting decision alone cannot activate them. Final PRESEAL bytes and future provider/outer-capture bindings must be reviewed and granted separately; a completed local version probe cannot grant40 semantics automatically. Exact literal native requests are in QUALIFICATION-PLAN.json; SEMANTICS-PLAN.json has oracle executable null, not a /bin/bash fallback. No ambient cross-call REPL state is required by any runner/helper command.

## Bounds and cleanup

Fresh preparation:30minutes including publication/cleanup,64 ALL owned children, peak3,128MiB capture,512MiB work. No old priority/native43/fullgate reservation is borrowed. Only registered metadata/patch and two helper-control Node processes are used. Accounting distinguishes registered direct children from any unobserved tool-internal descendants; no kernel-wide census is claimed. Instructions were context-only and not copied into evidence. Administrative apply_patch uses the tool transport's inherited command resolution only, never as a native/product environment.

Proposed qualification:3minutes inclusive,32 ALL processes,peak3,one target at a time,3s/target,2s cleanup observation,256KiB/stream,16MiB total capture,64MiB work. Proposed semantics:10minutes inclusive,128 ALL processes,peak8,one case at a time,3s/target,2s cleanup observation,256KiB/stream,64MiB total capture,128MiB work. Forty native plus40 virtual targets are separate from the9 qualification observations. Native fork allowances total18 in CASE-REVIEW; they are conservative proposed admission bounds, not observed counts. Supervisor/provider and every descendant count toward128, not just direct spawn calls. Logical work/capture limits are not RSS, hard post-SIGKILL settlement or opaque-host preemption guarantees.

Any safety/capture/integrity/unknown-retirement event stops dependent admission. Ordinary semantic differences may aggregate only after known cleanup. Provider close must drain cooperatively and report unresolved resources honestly; remaining opaque work never becomes a success. Old raw staging is untouched. No runtime grants or future-run roots are created here.

## Preparation incidents and retained versions

One patch attempt used a mismatched escaped context and exited1 with full stdout/stderr and known retirement; it changed no file. Its exact stdin/output remain in the preparation archive. The administrative patch transport was corrected before its first helper dispatch. The originally valid NUL guard was made unambiguous; the semantic plan's erroneous local placeholder was removed before controls. V1 helper sources/preexecution seal/results are retained; v2 expands native and virtual snapshots to the full fixture namespace without changing40 inputs or22 controls. These are helper/source corrections, not product fixes or native outcomes.

## Primary references

Official GNU manual5.3 documents expansion, startup, redirection and builtin semantics. The extglob parser option must be active before constructs requiring it are parsed; this supports preserving B13 rather than normalizing a syntax difference. The maintainer's4.0 release announcement identifies mapfile/readarray introduction. These references classify tests, not unrun outputs.

- https://www.gnu.org/software/bash/manual/bash.html
- https://www.gnu.org/s/bash/manual/html_node/Pattern-Matching.html
- https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html
- https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html
- https://lists.gnu.org/archive/html/bug-bash/2009-02/msg00164.html
- https://lists.gnu.org/r/bug-bash/2009-12/msg00139.html
- Curie's unchanged REFERENCES.md records official5.3 patch015 source discovery. Some direct web opens were unavailable; successful official manual/search/maintainer results were used, never a local version claim.
