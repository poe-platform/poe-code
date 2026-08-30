# Source comparison before diagnostics

Reference evidence38a4e7b08f47139328f3a4ac5b4b50d83a6544b3 is qualified resolved-WRITE proof, not this provider full read/exec/network fence. Its immutable source86038b27d1bee03333f13560e374ad407db417b8 supplies the comparison; no reference tools or products were executed.

| Axis | Reference source | Provider-v1 / F01 | Meaning |
|---|---|---|---|
| Base policy | `(allow default)`, then deny writes/links outside2 roots/protected names; `/dev/null` write allowed | `(deny default)`, narrow read paths/sysctl names, case writes; explicit network/fork denial | Concrete broad capability difference; copying allow-default would violate current task, not a repair. It does NOT identify the ABRT cause. |
| Launcher | sandbox-exec `-p` inline profile | same executable pathname, `-f` exact owned profile | Different profile delivery; no malformed-profile diagnostic captured in F01. No change authorized. |
| Node | reference24.11.1 | pinned22.22.2 | Runtime version differs; reference success cannot qualify this startup. |
| Program | staged worker/phase module with imports/preloads and optional IPC | staged fixture.mjs file, fd3 eventpipe | These are not equivalent programs. New pair instead uses one fixed --eval readiness literal with no imports/file/network operations. |
| Environment | source merges explicit environment and HOME/TMPDIR/TMP/TEMP, sometimes audit/import variables | exactly LC_ALL/LANG/TZ/HOME/TMPDIR/PATH, no inherited variables | Concrete environment delta, not attribution. Pair holds provider environment constant. |
| cwd | bound owned source/work roots | F01 owned work | Pair keeps existing owned F01 cwd, no mutation of historical inputs. |
| Capture | streams opened before spawn; detached group; polling ps/lsof and cooperative notifications | synchronous capture descriptors before spawn; detached group; direct listeners/EOF and kill0 group absence | Both distinguish cleanup; reference itself says polling is not full process-image inventory. No universal census transferred. |
| Dependency evidence | historical OS26.4.1/build25E253 references; explicit gaps/transient basename origins | exact executables,13 cache-file metadata/path allowances and6 system-image literals, not loaded-image hashes | Neither provides complete image attribution for this new ABRT. |

The reference os-instruction-fence.mjs SHA256 is0be2d726ef3bb3092b0fb02c8bcb1c2837b2d9a782bb75b5ea88b1cd53921d06. Exact frozen objects/raw source are retained in this phase capture. The reference additionally reports undeclared xcodebuild and unresolved transient origins; these limitations are not hidden or inherited as accepted roles.

## New pair and interpretation

D01 directly launches the pinned Node; D02 launches the SAME Node/--eval literal under the UNCHANGED F01 profile. Both use a fresh6-key env object, same already-owned cwd and4 pipes. Target source only writes `PROVIDER_DIAGNOSTIC_READY` plusLF to stdout. No fixture/module import, file operation, child launch, Bash or network call. New identities do not rescore F01.

Unfenced success plus fenced failure would localize the association to the fenced launch composition, NOT prove a particular permission caused it. If D01 aborts/fails, D02 is unrun. Any unexpected abortion/unknown retirement/capture/integrity failure stops dependent launches. No profile variant is part of this grant.

A minimal future decision could authorize one explicitly named startup-capability delta only AFTER evidence justifies selecting it. This packet does not select an unproved missing permission or authorize broad default-allow. No host logs/cache inspection beyond already pinned metadata is added.
