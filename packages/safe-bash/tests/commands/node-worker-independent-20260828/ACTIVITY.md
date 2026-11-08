# DATA activity and preserved limitations

Preseal `74af3106`, then exactly three serial Node DATA invocations. The first was
an inline fs/zlib/crypto JSON structure reader. It verified the known encoded
archive length/hash before decompression (8MiB maximum) and printed only:

```
decodedBytes: 1073919
archive keys: schema, proof, files
proof keys: commit, commitBase64, commitSha256, commitApiUrl,
            commitMetadata, packageTree, trees
files: 66, first keys path/base64
manifest files: 66
```

The second was `check-data.mjs` at5032eb71; its raw stdout/stderr and generated
RESULT-v1.json are retained. The surrounding shell failed **after** that output:

```
zsh:11: read-only variable: status
```

Its shell-tool exit was1. No independent child-exit code was captured. Do not
interpret the generated positive data assertions as a clean wrapper receipt.
There was no second execution/rebaseline. The third was `read-remaining.mjs` at
93e40b2c; its raw stdout/stderr are retained and its shell-tool exit was0.

The recipes only load Node builtins for inert reads, hashing and gzip/JSON.
There were zero spawned subject children, engine imports, Workers, compilers,
native oracles, private reads/writes, network services or package installations.
No active sessions remain. Research web requests were official documentation or
the same pinned public source rendered for reading; they were not provider calls.

The two excerpt captures total50,860 bytes; they are bounded inert source quotes,
not a loadable source tree or engine vendor. Main RESULT and captures stay in this
owned subtree. The original archive, author/root documents, apply_patch candidate,
private-ABI experiment fixtures and production remain unchanged by this review.

The development shell also encountered an unmatched source-inspection glob for
`PROFILE*` and a nonexistent design README; corrected by listing actual files and
reading np1-cjs-v1/CONTRACT.md. No subject execution or source failure follows from
that navigation error. These navigation failures are not runtime observations.

At evidence commit fa456e5a, `git diff --cached --check` reported trailing spaces
on numbered empty source-excerpt lines (`123: ` form). The shell continued to the
explicit-owned commit. These are preserved captured formatting bytes, not a
product or DATA assertion failure; the diff check is **not claimed clean**. The
capture was not trimmed or its recorded SHA256 rewritten to hide the warning.
