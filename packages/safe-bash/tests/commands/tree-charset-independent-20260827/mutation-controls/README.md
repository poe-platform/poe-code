# Tree charset mutation controls

This verifier binds only the immutable Git candidate
`f1a90436c45208ca248e058a039893233c608daa`. It archives that object into a
task-local scratch directory, authenticates every archived blob, installs the
candidate's locked development tools, builds, packs, installs the tarball into
a consumer, and then makes eight exact mutations to fresh copies of installed
JavaScript. It never imports the live checkout's product source.

Each isolated child runs the same assertion file. The required outcome is all
assertions passing on the installed baseline and the mapped unchanged assertion
failing for every mutant. Per-child stdout, stderr, PID, timeout, close event,
and best-effort post-close PID reachability are retained in a unique attempt
directory. The work directory is removed after a completed or failed run.

Run from the repository root:

```sh
node tests/commands/tree-charset-independent-20260827/mutation-controls/harness/run.mjs
```

The final load controls apply one path/hash guard to a genuine installed load,
a separately packed and installed wrong package, and a same-byte package copy
outside the allowed root. The latter two resolve but are denied before import.
This is not a claim that Node.js is a sandbox: unguarded host JavaScript can
import existing file URLs. PID/process-group absence is a bounded post-close
observation and cannot rule out instantaneous identifier reuse.
