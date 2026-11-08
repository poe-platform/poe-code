# Preserved first preparation failure

Frozen harness commit: `bac58e3e9f11283b95f592080ba43d5e17a859e7`.
Common-base variant A compiled successfully. The author harness then gave npm
the SAME `/dev/null` pathname for both user and global configuration; npm rejected
that double loading before packing. This is a harness setup defect, not a product
build failure, missing tool, correctness result, or performance observation.

The immutable `evidence/` capture retains the exact error, readiness publication,
host metadata, integrity checks, and both settled owned children. Zero correctness
calls, load attempts, warmups or measured commands ran. No timing claim is possible.

A follow-up freeze will use two distinct empty owned npm configuration files,
retain this failed build tree under owned scratch, and restore A from the SAME
authenticated source archive. Sources, fixture bytes/expectations, load thresholds,
three-attempt total limit and timing schedule will not change. Its evidence will
be separate. This is not a new baseline or resampling of a load/timing failure.
