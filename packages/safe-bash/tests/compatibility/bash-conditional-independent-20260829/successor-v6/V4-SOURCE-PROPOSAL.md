# Unexecuted fixture correction, no renewed runtime admission

Actual readFile is Promise<Uint8Array>, authenticated candidate dist/contracts/filesystem.d.ts:67 and dist/fs/memory/index.d.ts:36. Original collector incorrectly treated readBytes as byte-returning; v3 then incorrectly treated readFile as ByteSource. Both are reviewer errors. The source-only v4 fixture decodes await memory.readFile directly; exact scripts/output/status/expected filesystem bytes remain unchanged. This v4 is UNRUN, not acceptance.

ACTUAL-03 ends ordinary assertion HOLD with all10 affected observations failing in the new collector, not new product mismatches. All5 children close0/1 naturally, zero signals/RegexWorkers; outer group absent. Cumulative39 fixed loader admissions of40 leaves insufficient admissions for three-layout v4 closure. Stop runtime without spending or raising cap.

Any later proposed minimal replay must separately seal source-existing-emits/installed/moved N01,N10,N11, M04-restored file-content companion and meaningful mid-invocation M06 caller-reason activation/restore if ROOT wants10 mechanisms. No new product patch is indicated. M06 preabort route proves admission identity only, not modified post-execution selection.

FIXTURE-V3 description of four fixture-file outputs meant four dispatch roles; there are3 distinct affected files/cases, nine layout observations plus one restored-copy companion. No output was successfully collected there.

