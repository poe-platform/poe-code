# Source preparation and DATA boundary

2026-08-28. Source authoring only; no Worker/engine/compiler/private execution GO.
Owned paths are this new preparation-v1 directory and the new design proposal-v3.
Existing review, v2, original schedules, F05 and all foreign files remain read-only.

Preparation authenticates committed Git objects and reads source/data text only.
The exact existing input roots are review 7b7a54ef5f1710d78297402a531a1fed63266cca,
v2 82aae2f5bff404423e81ddb6ddfacb6e0abd35a9 and its explicitly bound older inputs.
The public archive stays compressed on disk; source inspection is in-memory DATA.
No private checkout, source materialization, source import, parser, VM, compiler,
Worker, subprocess subject, native oracle, network, install or syntax trial.

After the complete source seal is written and committed, one zero-child DATA
check may read sealed JSON/text, compute SHA256/Git hashes, compare exact finite
inventories and source-text bindings. It may not import or execute authored code.
Use existing tool-host Node builtins fs/crypto/zlib only, no child_process. Bound
elapsed time 300000ms, retained logical work 67108864 bytes, tool capture 16777216
bytes, child count zero. Count all input/output buffers conservatively. Stop at
first limit/authentication failure and preserve its evidence; no retry disguised
as success. A later evidence commit records facts without modifying sealed code.

Source authentication and tool metadata reads are preparation, not runtime proof.
No full profile acceptance, new engine files or implicit future permission follows.
