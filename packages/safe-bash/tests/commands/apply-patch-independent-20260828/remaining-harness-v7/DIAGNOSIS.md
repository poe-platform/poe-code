# V7 source-only diagnosis

Preparation starts 2026-08-28T21:18:09Z; hard stop 21:38:09Z.

V6 denied the OUTER Node owner, not a restricted child. The historical transcription names owner.mjs:17 openSync of /Users/kjopek/Workspace/safe-bash/tests/commands/apply-patch-independent-20260828/remaining-harness-v6/attempt-01/OWNER-EVENTS.jsonl, ERR_ACCESS_DENIED / FileSystemWrite. No raw receipt exists.

The exact frozen outer launch is preserved in V6-ARGV.json. It enables --permission and --allow-child-process, grants read of the existing v6 source directory and individual bound history/tool paths, and grants write ONLY to the attempt-01 string. The owner asserts that directory absent at line14, creates it at line15, stats it at line16, then opens its descendant journal at line17. No realpath/canonical-parent binding or precreation precedes permission initialization. No child spawn, discovery, MAIN-PRESEAL or raw child capture was reached.

Source-proven bootstrap defect: the permission-confined owner itself performs first journal acquisition before establishing the raw boundary, using an output directory deliberately absent at launch. Parent-string creation permission did not establish the descendant access actually requested. The transcription establishes the observed refusal, NOT its native intrinsic cause. Whether Node classified the initially absent grant as a file rather than a directory, or canonicalization contributed, is NOT proven by these JavaScript sources. No platform bug, universal descendant prohibition, or intrinsic change is asserted. Current canonical-parent observation cannot reconstruct historical runtime realpath state.

Authorized successor: trusted outer owner precreates the exact NEW owned root and capture files, canonicalizes once, passes the SAME bound root to restricted children; no blanket grant or second capture controller. Outer journal errors are not child errors. Child startup mkdir/open denial remains capturable by that already-established outer boundary.

V6 source49500bf8cd961788b1c212c862171306767ac069 / evidencea3b7ae8ee8ab05cdc5a9562ba0e560cc34f54266 / fullseal3eddac0c38ef0b6831982e7a67f0b567a730e3e1 remains actualFileSystemWrite0/6+0/4, transcription only. V5 and all prior failures are immutable.

