# Unsafe draft: superseded, not a safe release

The original REPORT.md and all raw inputs/results here remain immutable. Its
safe-checkpoint characterization was invalidated before any production commit by
independent pre-construction data-method override reproduction. The recorded
passing selections did not test that destructive case. Constructor-time snapshots
of this.method incorrectly accepted subclass overrides as original methods.

Bad resource-id.ts SHA256:
bb1ad5de415ce3f4369aaccef3a3869162bc81a8f6eb66104df4e5c7db452916.
Bad webdav.ts SHA256:
b03c53d4fd1e5c7da4d665d532dbf25b39e9555dc1cb47890edd2ffd2d9fa51b.

The independent case returned distinct, invoked overridden writeStream, reported
EIO and damaged the source. Its unchanged reproduction, old/new source hashes,
current-core isolated correction and remaining required positive reds are recorded
in ../operation-override-fix/REPORT.md. No earlier raw result is overwritten or
reinterpreted as exercising the newly discovered case.
