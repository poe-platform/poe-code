# File-based bootstrap, fresh grant

No rescore of6901dfae/tool-only syntax failure. Production7196bace is unchanged.
The copied launch-v2.mjs must be byte-identical to qualified ancestor SHA256
4a4d7635eb7853c172f70558680c1e9dd00f2bda4206d417b288bf39fffb5868.
Its hardcoded runner basename is retained in a new nested owned namespace; its
new data binding selects only the file-based DATA bootstrap, not the old suite.
Outer capture opens before that runner is spawned, even if the runner cannot
parse. The runner opens inner captures before node --check of preparation entry.

Three harmless controls: deliberate syntax refusal with captured diagnostic;
missing-parent entry refusal; exact stdout/stderr capture marker accounting.
Preparation entry must pass node --check before execution. No generated string
is eval'd. Generated execution files are checked as files before actual admission.
New helper/fixture file hashes, args, node22.22.2 identity and fresh namespace are
sealed in bootstrap PRESEAL/EXECUTOR before dispatch. No engine/native oracle,
Worker, compiler or product admission during preparation.

Fresh actual grant activates only after preparation/controls pass and executable
preseal is committed: 45min,112 known owned OS starts peak4,192MiB capture/1GiB
work,case30s/build120s,40 fixed loader admissions/8 RegexWorkers maximum. Planned
main identities672=636 retained current author+12 focused per layout. Six type
groups/24 negative diagnostics,7 loaded mutants/restores,2 binding refusals.
No current HEAD build, Node/coherent composition, private/network/native/P2/XAN.
