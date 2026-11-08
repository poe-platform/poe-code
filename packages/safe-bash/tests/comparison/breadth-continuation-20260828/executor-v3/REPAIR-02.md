# Guarded CJS realpath continuation

Version2 recipe4ad7eefb / seal950626b647233848133080f6e2d3446cf27d34d3b0efde2a24ad6841a935793b
ran only C03/C04/C05. C04/C05 qualified; C03 remained an ordinary verifier
assertion failure, with all five children naturally reaped. Its new exact cause
was Node's CJS resolver calling fs.realpathSync on the authenticated loaded.cjs.
The guard refused before CJS evaluation. C03's wrong-hash tail remained unrun.
This is not a product failure or a reclassification of the first failures.

Version3 adds only an authenticated read-only realpath operation: the requested
file must belong to the exact projection, its bytes/mode/type must match, and
native realpath must equal the requested absolute path. Aliases and unbound
paths still refuse; no arbitrary live filesystem walk or source fallback.

Presealed `coordinator.mjs synthetic-load load-01` executes C03 and dependent
C04 only, at most six synthetic children. All other mechanisms, C05, defect
controls and the retained timer are bound but not repeated. No product,
comparator, native, timing or semantic cohort is authorized. All prior code is
Git-immutable and both raw failed invocations remain alongside this continuation.
