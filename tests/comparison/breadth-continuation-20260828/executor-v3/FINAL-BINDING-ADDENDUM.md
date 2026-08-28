# Final preexecution admission-data binding

The active recipe additionally derives each worker's complete file inventory,
consumer and engine from PROJECTION.json, rather than trusting transported view
metadata alone. Admission binds STAGED.json's complete bytes into RESULT.json;
the later cohort verifies that hash before using the saved layout. Three positive
view schemas, nine wrong-file/engine/consumer controls and positive/tampered-stage
hash controls are predeclared data-only validation, not package execution.

A root grant gets an atomic exclusive authority-HASH.lock in the owned runs
namespace. Changing RUN-ID cannot reuse an already consumed runtime grant.
Workers reauthenticate authority without creating further attempts. A consumed
failed prerequisite remains consumed; it is not automatically retried.

Final validate.mjs also authenticates and decodes the complete already-pinned
target pack as bounded data (858 expected regular members), and hashes the
existing comparator archive. Neither operation evaluates code, stages the real
packages, installs dependencies or opens the comparator instruction member.
This is a presealed data check, not full build reproduction or runtime admission.

Previously executed synthetic controls bind unchanged mechanism bytes where
applicable. Current recipe changes are explicit: coordinator/worker transported
view verification and one-attempt authority consumption, projection pure schema
checks, and the static validator. No synthetic/process/timer cohort is repeated
for these final data-only checks. All earlier failure receipts remain unchanged.
