# Retained preparation attempt

Before the independent freeze commit and before any candidate inspection or helper
execution, the first manifest-generation Node command failed reading the repository
index through execFileSync's default output buffer. Exact primary diagnostic:

```
Error: spawnSync git ENOBUFS
errno: -55
code: 'ENOBUFS'
syscall: 'spawnSync git'
path: 'git'
spawnargs: [ 'ls-files', '--stage', '-z' ]
status: null
signal: 'SIGTERM'
stdout: Buffer(1114112)
stderr: Buffer(0)
Node.js v22.22.2
```

The downstream apply_patch received no patch and printed its usage. The explicit
git add failed because FREEZE-v1.json did not exist; git commit --only then rejected
the five untracked pathspecs. No files were staged or committed by that attempt.
HEAD observed afterward was aa7541ee437de93b6bc1f80b9861f795c1e35b1f, moved by another
owner from the previously observed 925bbd9c172866e580c7d4ff6ac2891664deef98.

Correction: bound Git output at 64 MiB, fail the shell pipeline immediately on
error, then generate the same manifest. This is infrastructure preparation, not
a test failure, pass, mutant kill, or change to any executable expectation.
