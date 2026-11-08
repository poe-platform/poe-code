# Oracle correction record — August 27, 2026

The first corpus and native observations were committed in `3462e3e` before
product scoring. Run `run-bd2cacb` used frozen production
`bd2cacb3a20403302fd0a49441932d5522793e56` and recorded 191/224 versus 146/224.
**Those totals are historical, not accepted parity scores.** Initial native
validation checked declared exit status, which was insufficient to catch two
oracle-launch/projection defects:

1. On this host, temporary paths beginning `/var` resolve under `/private/var`.
   Replacing only the lexical temporary path left `/private/fixture` in native
   pwd/readlink/realpath/cd output. Map both real and lexical fixture/bin roots,
   longest/canonical first, to the same declared virtual namespace. This is a
   harness path projection correction, not a product change or output trimming.
2. GNU gzip 1.14 distributes gunzip and zcat as scripts invoking `gzip -d` and
   `gzip -cd`. Symlinking the gzip binary under those names compressed again
   instead. Resolve and hash the actual distribution launchers. The original
   zero exit status did not prove a valid decompression oracle; some scripts
   also ended with successful cleanup after an earlier diagnostic.

`native-controls.test.mjs` independently asserts binary decompression through
both launchers, file replacement and canonical path projection. The corrected
native capture retains **identical recipes, bytes, option families and declared
statuses**. Both old and corrected raw observations remain committed, with their
own source hashes. No product expectation is hand-edited and no case is dropped.

Recompare the same frozen product revision with the corrected committed harness
to separate oracle correction from concurrent product improvement. Instrumentation
and performance observations from the first run are retained but are not a new
whole-product claim. Every corrected mismatch still needs classification, and a
different agent must review benchmark fairness.
