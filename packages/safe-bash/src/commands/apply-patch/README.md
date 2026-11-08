# apply_patch

Apply a literal Codex-format patch from stdin or a single argument. Add, update,
move, and delete regular files using absolute virtual paths or paths relative to
the shell working directory.

```sh
apply_patch '*** Begin Patch
*** Add File: notes.txt
+Remember to run tests.
*** End Patch'
```

Mutations require the filesystem's `confineExtraction` guarantee and
`atomicFileMutation` conditional writes and removals. The command
retains each existing destination and source parent, including its ancestors,
before preflight. The backend must enforce those retained directories and reject
symlink traversal atomically during every mutation. Conditional operations also
verify the destination's backing identity and revision at publication or deletion. Memory filesystems support
this route; backends without it refuse patches before modifying files.

A patch can partially complete if a later operation fails, including a concurrent
ancestor replacement. A move can leave its published destination if subsequent
source deletion fails. Completed mutations are not rolled back.
