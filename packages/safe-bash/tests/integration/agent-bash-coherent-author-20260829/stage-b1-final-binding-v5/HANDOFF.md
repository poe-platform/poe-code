# B1 final binding v5 — corrected consumers, no actual authority

The actual future helper is now **stage-b1-final-binding-v5/preimport.mjs**.
The defective v3 helper and historical preparation/reseal files remain unchanged
but are not selected entrypoints. Both active consumers use the same gate:

1. prepare.mjs -> combinedIdentities -> authenticatePacketFiles(next).
2. preimport.mjs main -> authenticatePacketFiles(packet) -> combinedIdentities.
3. finalize.mjs uses combinedIdentities for final binding source postguards.
4. readIdentity validates each scalar record before filesystem access.

combinedIdentities validates each input list, then explicitly spreads both
admitted record copies and rejects duplicate paths across them. Reflect.ownKeys
and data descriptors enforce exact path/bytes/sha256 fields, rejecting hidden,
symbol, accessor, missing, nested-array and sparse-list inputs. Path is canonical
absolute; size is a bounded safe integer; SHA256 is lowercase64hex. There is no
prototype-identity requirement or arbitrary flattening.

## Actual bounded controls and source binding

Source preseal0bf2b4981943ce5ede61b18dbcddfd6295e4c773:
1958B/0b52380d11f750ebe88ad4c084ef733aac44960922bf397c8e3403795f966876.
One PURE controller,8/8 fixed groups: both lists consumed; nested; missing;
hidden; symbol; accessor without invoking getter; duplicate across lists;
invalid path/size/hash and sparse list. The positive uses two genuine owned DATA
files and the exported authenticatePacketFiles function called by future main,
not a source-only model. Negative inputs reject before any subject filesystem
reader call. Full helper main/ROOT authority/publication activation are UNRUN;
the actual publisher module was never imported. No product/engine/Worker activity.

New helper4731-independent successor is4751B/
39aa97b2ba7b62ad87d109cb96602557d2a8951988101029a74ee00f0efdb2fb;
shared gate3228B/8e2bd3172834f0cb90e6f3473cbb25ff01a5a389e5c863f614580718f9af2769.
Both absolute physical paths are in FINAL-BINDING.preimportFiles and must be
authenticated by the trusted outer before Node entry. Self-check is not prior
execution admission. No frozen runtime or publisher code changed.

## Exact inherited bindings and fresh checks

Runtime candidate bd0f227d081829512bafc2936f0b33632e02890b,
PRESEAL17692B/007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc.
Runtime preexecution ebf511e8/receipt12c8f7... and publisher logical approval
7c8fb0e3/receipt602295f8... remain bound. Publisher source daf5179d unchanged:
BINDING-v2:3923B/022ff1fc4ec15f25ef937419062a69ade7a0b3e3df482a0dcea7318e802fce56;
PRESEAL-v2:1532B/eaf5c9d789906e689eb47b7586c1b0ad41226eff4a3ae4957a51013fbded7152.

309-source/1012-emits/1014-members/2274+12 tool DATA retains independent b4cdef973a
authentication (receipt771a5c71...). No redundant full census is claimed here.
Fresh checks cover all45 consumed runtime pins, five unchanged publisher pins,
the two new helper pins, receipts, exact930368B package2fe streamhash and absent
owned slots. Package/source constituents are unchanged. No binary text dump,
inflate, native oracle, compiler, install, private or Node guest engine activity.

## Fresh window and fully bound commands

Issued2026-08-29T14:03:58.806Z; latest start14:23:58.806Z;
expires14:53:58.806Z. Same+20/+50-minute interval; runtime window enforcement
remains external. Old v4 window is RETIRED_UNUSED; old v3 draft and prior
undefined-path/peak3-vs2/HOLD observations are preserved without rescore.
New actual authority still requires different final-slot acceptance plus ROOT GO.

The final artifact is FINAL-BINDING.json with identity in BINDING-RECEIPT.json.
The earlier unexecuted FINAL-PACKET.json is preserved: finalization removed the
stale inherited v4 four-control narrative and rebound the final packet locator,
without changing helper source, control results, window or runtime.

Repo cwd /Users/kjopek/Workspace/safe-bash, login:false; exact future runtime:

```sh
B1_ROOT_GO=ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION /bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-b1-r2/launch.sh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-b1-r2/PRESEAL.json 007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc 17692
```

Future preimport executable is the exact pinned Node22.22.2; argv starts with
absolute v5/preimport.mjs and v5/FINAL-BINDING.json/hash/size. Remaining typed
arguments are the future ROOT-grant hash/size and actual prior-ledger hash/size,
not invented current values. Root grant lives at the absolute v5/
ACTUAL-ROOT-GRANT.json path in the packet, with action ROOT_B1_PUBLIC15_ACTUAL,
finalPacketSha256, authorization string, actual start, exact window and owned
absolute metadataHome. The ledger and output filenames retaining “v3” are
unchanged schema/path roles, NOT activation of the retired v3 helper.

Prior ledger must list6..26 actually observed retired starts; v5 helper adds its
observed self PID to produce7..27. Coordinator must observe its exit/close before
publisher and allow no intervening OS starts. Trusted capture precedes helper
entry. Absolute paths are explicit; no count0 or reserved slots are fabricated.
The same-buffer written authority hash/size yields fully resolved publication
argv. Its publisher script/BINDING-v2 paths and hashes stay unchanged.

## Scope and bounds

Actual envelope remains32knownOS/peak3, four sequential install/workflow roles;
1800inclusive=1620active+180tail/install120/layout300/case30/cleanup5;
64MiB capture/768MiB logical work;15guest/live5,Regex0/asyncloader0,
3main/≤15guest synchronous hooks (not nested-load/thread proof). No actual15.
Logical Git storage/8KiB startup reserve/headroom/no-guaranteed-persistence
qualifications accepted in7c8fb0e3 remain; no OS cap/fullcensus/group-absence claim.
B2 remains Halley's and is untouched. All final metadata publication occurs in
the own scope with explicit-path commits; foreign staging is not included.
