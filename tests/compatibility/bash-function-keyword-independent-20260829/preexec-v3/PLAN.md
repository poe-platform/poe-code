# B35 v3 corrective preexecution review

Source d97a038f742ac06872a30a7c0dd27ea7ab86b640; evidence
475d165b49f7fbfef49254d2fbcd8314db3b0f81. Author PRESEAL9140 bytes,
SHA25660f526f043e7e94b1526f8146d792b342a148efb261ffb3435dfb8b5ea2cc1ff.

Replay the exact D01–D18 assertion block from controls.mjs in a new canonical
owned root, and H19/H20 with unchanged tiny entry/manifest/guard bytes and
relocated authenticated role metadata. Copy no historical traces as inputs.

Replay prior N01–N08 assertion bodies unchanged. Their valid-grant fixture now
uses the versioned v3 schema and the refusal adapter invokes validateActivation,
mapping only AUTH_* refusal exceptions to true. Expected outcomes do not change:
missing/nonnumeric deadlines must refuse. Original v2 failures are immutable.
The v2 valid fixture uses state.work; the v3 schema fixture uses that same
expected work in both grant and validation context. This metadata alignment was
corrected before execution/committed preseal, with the unexecuted draft retained.

No collector/owner/supervisor/product/parser/engine entry import, build/compiler,
install or Worker. Only pure helper exports and exactly two harmless Node
entries execute. One outer controller, one pure controller and serial readiness
child give peak3. Twelve-minute review,32 known roles/48MiB capture/192MiB work.
30s outer watchdog,5s fixture deadlines, TERM2s/KILL1s; capture before admission.
Fixture files are archived before exact owned cleanup. No retry after unsafe or
unknown retirement. Initial host/tool/zsh startup is not suppressed by -f and
is not newly qualified by these Node controls.
