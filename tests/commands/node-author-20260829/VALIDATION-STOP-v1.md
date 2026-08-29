# Node MODULE author validation v1 — admission HOLD

Date: August29,2026. This is an actual launcher/owner admission failure, **not a Node product/runtime finding or module acceptance**. The one activation is spent; no retry occurred.

## Exact candidate and preseal

- SOURCE successor: c10d338331d56e1f293970010c7015fa602b6a8d; complete executable admission revision: ee150ba1d2c9165118310d78de8d6453020b9271.
- Selected baseline is exact public79 derived composition7fde32264d757ef856acf3ae92c8581b4a294341/full898 package SHA256643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd, plus only16 Node-local inputs (15TS and README). No Git80/movingHEAD/root/shared/default/package-export changes.
- MODULE-v4 SHA25641be9715e826ba698677490d4886dc3cc64d631e3fbe3d26074f8f8ff5cfff9c; selected src tree29c92432af028ede35c66f1bc6e3ba0357395e89; selected full input tree4f86505a9c8ffcf8f8e4040854bb2442e67dcbb1. These computed trees need not be stored Git objects.
- PRESEAL-v1 schema-v2 SHA25627e8de81e717aa3e20cc5883234507e27d6b86cedccf23dc0bab84f95ca46254; activation source SHA2561afad46bd34f7da8da14f98efb0928dd7d61402fd18a9b0672b1ec9e00130bbc. The actual submitted closed function authenticated its own source before dispatch; it did not reuse unsealed cross-call helpers.
- RAW-STOP-v1 archive SHA2565b123c8cd2ec47993baffcc847b9afc8b79318c92f1c416371f88a58c8383d45,6125 bytes. It contains all8 exact raw files, original census and22 preseal/16 module post-input hash checks. No raw file was rewritten.

## Actual observations

Bootstrap started2026-08-29T03:55:42.825Z; launcher PID28199 and owner PID28201 both spawned, naturally closed with exit1, signalnull. Launcher observed owner-entry-through-retirement94.839ms; bootstrap scope258.79741599969566ms. No timeout/TERM/KILL or rescue was exercised. These are admission durations, not workload performance evidence.

**Two actual qualification OS processes, peak2; zero compiler/build children, zero Workers, zero engine attempts, zero guest entries, zero product-module loads.** Owner child journal is empty; it records only ownerEntry/ownerRetiring. All75 planned main Worker runs, ten mutation/restore Worker slots,96 focused main executions,64 focused mutant/restores, type/build/pack/install/load controls and15 DATA controls remain UNRUN. No0/N failure rescore is made. Source/installed/moved qualification has not begun.

The original owner archive captures this primary own-data message exactly:

> Access to this API has been restricted. Use --allow-fs-read to manage permissions.

It preserves primary presence, non-undefined value and name:null. Original code/stack were not transported; do not invent them. Owner finalization separately reports “Access to this API has been restricted” and emits final unsafe:true/cleanup:false. The original RAW unsafe:false was written **before** that finalization failure and is not final safety/cleanup acceptance.

Raw pipe capture is883 bytes total (443 bootstrap +440 launcher); journal170 bytes. All8 raw files total2069 bytes; owned census including the pre-existing80-byte ownership marker is2149 bytes. Both outer capture scopes report zero close faults. The exact original RAW is577 bytes, SHA256cac1234544b678ab1c010758f55cd2f7eb6fdbe54e6194afb13c721aa1cfbb37. ARCHIVE.json/SUMMARY.json were never published. The evidence collector authenticated the raw archive separately; it does not overwrite the failed owner's cleanup claim.

Post-stop bounded census finds **no work root, no copied compiler/tool/source/engine tree, no installed consumer or package**. There is no owned scratch to remove; raw capture/evidence directories are retained. All known processes closed, so no live Worker/parent VFS work exists. This does not turn the owner's failed finalization into a pass.

## Source diagnosis, distinct from runtime detail

CONTROL-v1 gives the owner write permission to validation-v1 but gives read permission only to selected source/control/tool inputs. It omits read permission for its own output/work namespace. The first source operation after ownerEntry is existsSync(work), before work creation or input reconstruction. This explains the admission failure at the source level, consistently with the message and absent work tree. Later finalization writes RAW and then calls hashFile/lstat on that own output, which also lacks read permission. The raw diagnostics do not contain an original stack/call-site; the route attribution is SOURCE reasoning, not a recovered original stack.

This is a launcher admission/receipt-publication defect. No source/product behavior was reached. The32 focused fixtures still provide no runtime proof of the source repairs. The reference provider is source-complete, not compiler/runtime/provider-qualified.

## Required next authority — no automatic execution

A new explicitly versioned launcher profile needs **read AND write authority only for a fresh owned validation-v2 namespace**, including its work/capture/evidence paths. Keep exact selected input/tool read roots and every existing cap; do not grant Workspace/repository access, reuse validation-v1, change product behavior or retry this spent run. The same closed source/tool/module/engine binding and case expectations can then be resealed for a fresh root-authorized activation. No permission correction or second activation has been made here.

Q01–Q03 and SOURCE findings F01–F03 are addressed in the successor source and finite fixtures, not proven fixed by this failed run. Ordinary success retains quiet virtual stdio; unsupported NP1 forms remain explicit, without fake Node identity or full Bash/Node compatibility. Existing NP1/Worker/F05 histories and all unrelated component qualifications are unchanged.

Publication is separate from the two-process cohort: seven planned bounded Git/apply_patch evidence-publication children (no test/compiler/Worker), yielding nine all-owned starts for activation plus publication if all complete. Final tool handoff reports actual publication count; this statement is not a two-process total-work claim.
