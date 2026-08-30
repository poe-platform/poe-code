# Node MODULE author v2 — compiler repair / capture admission HOLD

## Immutable bindings

- v2 permission/executor preseal: 7e53dd844b84d7589631887209a2864ba7298eb5, SHA256d330e47dcab59f897caf424d3aa00ff741e746ba16ac81a5ea3e3f51b7457457.
- Preflight evidence: 3fbc5a2cc0cf42eb90ef517bd441f309c655e2f0. Six controls passed in one harmless Node child, exit0, no capture/close fault; state removed. Preparation totals9 owned children, within15min/32. This does not rescore v1.
- Ordinary Node source repair: 263a786dd526a121c710aaf1b87b5a6e7f22272b; fixture terminal-byte restoration: 0599795d01f042a90bc1c8bed66537b06ac10218. Exact current module manifest SHA2565f0427b24cb1c4fc7bc3c8e7a7f0e0a5d3e62927909575c0f98bc33c5c8521f4, new preseal SHA2565b7278f1807776c1f95b1a99f203637f8308c08cc49d81c6c7b5a8ce5961874d at validation-v2/revision-1/PRESEAL-v2.json.
- Baseline remains exact public79 composition7fde32264d757ef856acf3ae92c8581b4a294341/full898 SHA256643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd. Sixteen Node-local source inputs only; no root/default/package/shared-core modifications or engine vendoring.

## Actual compiler result, not product execution

The corrected read/write grant reached the pinned strict TypeScript build. Three actual OS processes (launcher, owner, compiler) naturally closed; compiler exit2. Original diagnostics are retained verbatim:

- src/commands/node/rules.ts(1,41): error TS1127: Invalid character.
- src/commands/node/rules.ts(1,42): error TS1134: Variable declaration expected.
- src/commands/node/rules.ts(134,1): error TS1160: Unterminated template literal.

The source had escaped raw-template opening/closing backticks outside a string. The repair removes only these two backslashes. The original c10 source and failed build remain unchanged in evidence. This is a confirmed ordinary source compilation defect, not a TypeScript/engine bug.

The failed compiler emitted956 files; that count is NOT a successful build/typecheck/load claim. Before compilation,7 capture-helper controls and8 receipt-judge controls passed; they are distinct from the six permission preflights and from Node product tests. No focused product cases, Workers, engine attempts, guest entries, type consumers, packages, installed/moved consumers or mutants ran.

The first actual owner authenticated its raw archive before removing work. SUMMARY reports cleanup:true/unsafe:false, all children closed. RAW SHA256bd0afcb0740d68bc4496af0d1781dacc594778f8ba3ad5fbc58f767a906d3f51,66625 bytes; capture/journal accounting1506 bytes; recorded owned writes157920559 bytes; observed full scratch high-water163997857 bytes. The unchanged PUBLIC95 emissions were copied as test inputs, never executed or shipped.105 fixture files were censused. These are finite source/build admission observations, not containment/RSS or arbitrary guest claims.

## Repaired revision stopped before dispatch

The versioned repair preseal now exactly binds all22 executor inputs and16 current module inputs. A preparation copy normalized seven terminal blank lines; source-only census caught it before dispatch.0599795d restores the original exact bytes and predicates; it is not a runtime failure or rescore.

The repaired revision's closed bootstrap then attempted to create its child directory beneath a missing nested validation-v2 parent. The tool returned:

> ENOENT: no such file or directory, mkdir '/Users/kjopek/Workspace/safe-bash/tests/commands/node-author-20260829/validation-v2/revision-1/validation-v2/bootstrap'

That first mkdir is before the bootstrap capture/try block. No new Node child, compiler, Worker or guest was acquired; the source control flow and bounded directory census establish known nonacquisition. There is **no structured bootstrap or raw-file receipt for that attempt**; the exact tool error is retained in REVISION-1-ADMISSION-STOP.json. No raw reason identity/stack or successful capture is invented. The revised module remains unrebuilt.

This is a **capture-admission gap**, so execution stops under ROOT's no-auto-retry rule. It is not another read-permission failure, native fallback, environment-key problem or reason to broaden permissions. The authorized v2 read/write root already contains the intended nested paths. No missing directory was silently created after the failure and no second dispatch occurred.

## Required narrow next step

Provision/authenticate the exact nested bootstrap parent under the already-authorized validation-v2 tree before dispatch, and put first directory/capture acquisition inside explicit outer failure ownership. Preserve this failed attempt. A fresh reviewed/authorized dispatch is required after the capture STOP; **no additional filesystem permission or profile expansion is requested**. Existing source case/type/engine inputs and caps can remain fixed.

Current status: Q01–Q03/F01–F03 are SOURCE repairs; reference provider source is complete but neither compiler-success nor runtime/provider-qualified. Ordinary output remains intended to be quiet; no full Node/Bash identity claim. Poincare can inspect the immutable source successor, but source/installed/moved acceptance remains UNRUN. All old 89965809/v1, F05, feasibility and SOURCE histories stay intact.

Counting: before this handoff's publication, v2 actual phase used11 owned starts (3 execution plus8 source/preseal publication helpers); repaired dispatch added0. Final handoff reports publication separately. Preparation9 is separate, not hidden in this count. No deadline/TERM/KILL, guest cleanup or engine cancellation branch was exercised.
