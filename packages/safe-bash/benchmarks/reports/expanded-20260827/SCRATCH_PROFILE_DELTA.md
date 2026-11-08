# Scratch profile correction — separate oracle delta

The original frozen206/224 with18 failures, native-corrected JSON and all raw
results remain unchanged. Faraday's routed-five review identified an unequal
scratch configuration affecting `command/patch/dry-run`.

Commit2f1bdcb records four pre-command/no-op/native controls: tmp is absent
before execution and remains absent after noop; GNU patch creates it because
the original harness points TMPDIR at a nonexistent child inside the asserted
fixture. With a preexisting external scratch directory, dry-run leaves the exact
same fixture entries as noop, and the scratch directory is empty afterward.
This is a real native effect of a harness setting, not an already-present fixture
directory and not evidence that the product should create a fake directory.

The revised harness gives all engines an explicit preexisting scratch role
outside `/fixture`: virtual TMPDIR=/tmp, initialized in the benchmark filesystem;
native TMPDIR points to a unique owned temporary directory projected as /tmp.
No product command/source changes. `/fixture/tmp` is **not** added to either
virtual fixture. Filesystem-effect assertions stay exact, with no ignored paths.
As before, outside-fixture scratch state is not part of the general effect
assertion; controls separately verify cleanup in this targeted native case.

`native-scratch-aligned/native.json` is a new228-observation capture. Recipes,
stdin, file bytes and every native stdout/stderr/status remain byte-identical
to the previous capture. Only the dry-run final namespace drops the empty tmp
directory. Unit checks assert this exact one-row delta. Old scores are not
retroactively increased; later product runs must identify this profile and their
own source revision. The patch -s source fix is a different owner's real feature
change, not this harness correction. Different-agent fairness review is pending.
