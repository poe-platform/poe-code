---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: fs-errno-bridge
    title: Carry node errno metadata across the SafeJS host bridge
    prompt: |
      In packages/safejs/src/interp/host-bridge.ts, `createHostErrorValue()` rebuilds host
      errors via `createSubsetErrorValue(name, message, ...)` and drops every own property,
      so a rejected `node:fs/promises` call reaches sandbox code without `code`, `errno`,
      `syscall`, `path`, or `dest`. Scripts must be able to write
      `catch (error) { if (error.code === "ENOENT") ... }` and see exactly what node sets.

      Copy an allowlisted set of node system-error properties from the host `Error` onto the
      sandbox error object: `code` (string), `errno` (number), `syscall` (string),
      `path` (string), `dest` (string). Only copy own properties whose type matches; skip
      anything else. Charge strings through `budget.allocateString` the same way
      `normalizeSurfacedSubsetError` does, and keep the copy inside a
      `budget.suspendChecks()`/resume pair if that is what the surrounding code does.
      Do not add an fs-specific branch: this is generic host-error metadata, driven by the
      allowlist only.

      TDD: add cases to packages/safejs/src/interp/host-bridge.test.ts (or the closest
      existing suite) proving a host function rejecting with an `Error` carrying
      `code/errno/syscall/path/dest` surfaces those exact values in sandbox `catch`, that
      unlisted properties (e.g. `secret`) are not copied, and that non-Error rejections keep
      today's behavior. No new files on disk; use existing in-memory test helpers.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-module-core
    title: Add the opt-in fs host module with a node-identical surface
    prompt: |
      Create packages/safejs/src/modules/fs.ts exporting
      `makeFsModule(options: { root?: string; fs?: FsImplementation })` and export it from
      packages/safejs/src/index.ts next to `makeGitModule`/`makeEnvModule`. It is never
      registered by default; callers opt in by putting it in the `run({ modules })` registry.

      Surface must mirror `node:fs/promises` exactly — same function names, same argument
      shapes, same return values, same thrown/rejected error shapes:
      `readFile`, `writeFile`, `appendFile`, `mkdir`, `rm`, `rmdir`, `readdir`, `stat`,
      `lstat`, `access`, `copyFile`, `rename`, `realpath`, `mkdtemp`, `truncate`, `symlink`,
      `readlink`, `link`, `utimes`, `chmod`, plus a `constants` export with node's
      `F_OK`/`R_OK`/`W_OK`/`X_OK`/`COPYFILE_EXCL` values. Delegate to the injected `fs`
      implementation, defaulting to `node:fs/promises`, so tests can pass a memfs volume.
      Do not invent poe-specific names, options, or convenience helpers, and do not
      re-validate arguments that node itself validates — pass them through and let node's
      own `ERR_INVALID_ARG_TYPE` / errno errors surface. Out of scope, and must not be
      exported: `FileHandle`/`open`, streams, `watch`, `opendir`, `bigint` stats, `Buffer`
      results, `glob`, and the callback/sync APIs.

      Declare a resume policy for every operation with `declareHostOperation` from
      ../interp/host-bridge.js: reads (`readFile`, `readdir`, `stat`, `lstat`, `access`,
      `realpath`, `readlink`) are `"re-issue"`; anything that mutates the filesystem
      (`writeFile`, `appendFile`, `mkdir`, `rm`, `rmdir`, `copyFile`, `rename`, `mkdtemp`,
      `truncate`, `symlink`, `link`, `utimes`, `chmod`) is `"read-side-effect"`. The module
      knows nothing about logging, dry run, or the CLI.

      TDD first, using memfs (`memfs` is already a dev dependency) as the injected
      implementation — tests must not touch the real disk. Cover the happy path of each
      operation and the errno path for a missing file.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-encodings-and-values
    title: Match node's encoding, Stats, and Dirent shapes inside the sandbox
    prompt: |
      packages/safejs/src/modules/fs.ts must return values a SafeJS script can actually
      hold: `SandboxValue` has no `Buffer`/`Uint8Array` (see packages/safejs/src/interp/values.ts).

      1. Encodings: `readFile(path, "utf8")`, `readFile(path, { encoding: "utf8" })` and
         every other node string encoding (`utf-8`, `utf16le`, `latin1`, `ascii`, `base64`,
         `base64url`, `hex`) must return exactly the string node returns. `readlink` and
         `realpath` follow the same rule. A call that would make node return a `Buffer`
         (no encoding, or `encoding: "buffer"`/`null`) must reject with a clear
         `TypeError`-shaped error naming the unsupported capability and telling the caller
         to pass an encoding — never a silent coercion or a lossy string.
         `writeFile`/`appendFile` accept a string plus node's encoding options.
      2. `stat`/`lstat` return a plain object carrying node's numeric fields (`dev`, `mode`,
         `nlink`, `uid`, `gid`, `rdev`, `blksize`, `ino`, `size`, `blocks`, the `*Ms`
         timestamps) and the predicate methods `isFile`, `isDirectory`, `isSymbolicLink`,
         `isBlockDevice`, `isCharacterDevice`, `isFIFO`, `isSocket` returning the same
         booleans node returns. `Date` fields and `bigint: true` are out of scope: reject
         `bigint: true` with the same unsupported-capability error as above, and expose the
         `*Ms` numbers instead of `Date` objects.
      3. `readdir` returns the same string names node returns, in node's order — node does NOT
         sort; order is filesystem-dependent, so never impose a sort and never assert order in
         tests (compare as sets). With `withFileTypes: true` it returns objects with `name`,
         `parentPath`, and the same predicate methods; with `recursive: true` it returns the
         same relative paths node returns, and `withFileTypes: true` + `recursive: true`
         combine as node combines them.

      TDD with memfs as the injected fs; no real files. Assert the unsupported-capability
      errors by message and by the fact that nothing is written.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-root-confinement
    title: Confine the fs module to an optional root with node-shaped denials
    prompt: |
      Add the `root` option handling to packages/safejs/src/modules/fs.ts. When `root` is
      omitted the module behaves exactly like `node:fs/promises`. When `root` is set, every
      path argument (including the second path of `rename`, `copyFile`, `link`, `symlink`,
      and the `mkdtemp` prefix) must resolve inside `root` or the call rejects.

      Resolution rules: resolve relative paths against `root`, then canonicalize through
      `realpath` walking up missing segments — reuse the approach already proven in
      `resolveWorktreePath`/`resolveCanonicalPath` in packages/safejs/src/modules/git.ts so
      that `..` traversal and symlinks pointing outside the root are both caught (check the
      link target, not just the link path). A denial must reject with a node-shaped system
      error: `code: "EACCES"`, matching `errno`, the `syscall` of the attempted operation,
      and `path` (plus `dest` for two-path calls), so scripts handle it with the same
      `error.code` branch they would use against real node.

      TDD with memfs, including: relative path resolved against root, `..` escape denied,
      absolute path outside root denied, symlink inside root pointing outside denied on read
      and on write, `rename` denied when only the destination escapes, and root itself
      readable. No real files.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-root-confinement-edges
    title: Close the root-confinement edge cases
    prompt: |
      Harden the `root` option in packages/safejs/src/modules/fs.ts against the cases a naive
      prefix check gets wrong. Each case below is a test first, then whatever code it takes.
      Denials keep the node-shaped `EACCES` (code, errno, syscall, path, and `dest` for
      two-path calls) established in the fs-root-confinement task.

      Must be allowed (these are inside the root, however ugly the spelling):
      - `root` itself, `root` with a trailing separator, `.`, `./`, and `a/../b`
      - a path that walks out and back: `a/../../<basename-of-root>/b` resolving into root
      - a relative symlink inside root pointing at another path inside root
      - a path whose missing intermediate segments don't exist yet (write-then-read flows)

      Must be denied:
      - `..`, `../x`, and any absolute path outside root
      - a path escaping via a symlinked *parent directory*, not just a symlinked leaf
      - `symlink(target, path)` where `path` is inside root but `target` points outside — and
         the mirrored read of that link afterwards
      - `link(existing, newPath)` where `existing` is outside root (hardlink escape: a hardlink
         has no target to re-check later, so the check must happen at creation)
      - `rename`/`copyFile`/`cp`/`link` where either side escapes
      - `mkdtemp(prefix)` where the prefix escapes, including a prefix with no separator that
         resolves relative to root's parent
      - a path containing a NUL byte (see fs-arg-validation for the exact node error — argument
         validation wins over confinement; node rejects the argument before touching the fs)

      Decide and encode one rule, then document it: on a case-insensitive filesystem (darwin
      default) a path differing only in case still resolves into root, so canonicalization must
      not turn a case difference into a false denial. Symlink loops inside root surface node's
      `ELOOP`, not `EACCES` — the confinement check must not swallow node's own errno.

      TDD with memfs; no real files.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-arg-validation
    title: Match node's argument validation errors exactly
    prompt: |
      Node rejects bad arguments before it ever touches the filesystem, with `TypeError`s and
      `RangeError`s carrying specific `code` values. packages/safejs/src/modules/fs.ts must
      surface the same errors with the same `name`, `code`, and `message`. Do not hand-roll
      validation that node already does — pass arguments through and let node's error surface;
      only add explicit checks where SafeJS must diverge (below). Derive every expectation by
      running the real API, not from memory.

      Parity cases to cover:
      - non-string path (number, object, `null`, `undefined`) → node's `ERR_INVALID_ARG_TYPE`
      - path containing a NUL byte (`"a\u0000b"`) → node's `ERR_INVALID_ARG_VALUE`
      - empty-string path → node's errno result (`ENOENT`), not an argument error
      - unknown encoding (`"utf9"`) → node's error for a bad encoding
      - `access` mode out of range / non-integer → node's `ERR_OUT_OF_RANGE` /
        `ERR_INVALID_ARG_TYPE`
      - `truncate` non-integer length → node's `ERR_OUT_OF_RANGE`, but only on a file that
        exists: node opens the path before it validates the length, so a missing path answers
        with the open's `ENOENT` first, and a negative length is accepted and truncates to zero
      - `chmod` mode as octal string (`"755"`) accepted like node; out-of-range mode → node's
        error
      - `utimes` with a numeric string, `NaN`, `Infinity`, or a non-coercible value → node's
        errors and coercions, exactly
      - bad options object (`readFile(path, 42)`, `mkdir(path, { recursive: "yes" })`) → node's
        error

      Documented SafeJS divergences (each must throw a clear unsupported-capability error naming
      the argument and the reason, never silently coerce): a `Buffer`/`Uint8Array` path and a
      `URL` path (`file://`) — the sandbox has neither `Buffer` nor `URL`, and node accepts both.
      An integer file descriptor path is not one of them: `fs/promises` has no descriptor path
      form, so node blames an integer's argument type like any other non-string and the module
      does the same. Add these to the deviations list documented in the fs-docs task.

      TDD; no real files. memfs is the volume, but it cannot be the reference here — it performs
      almost no argument validation (see "Why memfs alone can't prove compliance"), so asserting
      against it would pin the module to the wrong behavior. node validates every argument before
      it opens anything, so real `node:fs/promises` is the reference and still creates no file:
      the path errors the module raises itself are proven equal to node's by differential, and the
      arguments it forwards are driven through the module over real `node:fs/promises`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-unsupported-options
    title: Reject unsupported node options loudly instead of ignoring them
    prompt: |
      A silently-ignored option is worse than an unsupported one: the script thinks it got node
      semantics and did not. In packages/safejs/src/modules/fs.ts, every node option that SafeJS
      cannot honour must reject with a single, consistent unsupported-capability error naming the
      option, the operation, and the reason — reuse one error factory, no per-option prose
      duplication.

      Options to reject:
      - `signal` on `readFile`/`writeFile`/etc. — the sandbox has no `AbortController`, and
        cancellation is the bridge's job (packages/safejs/src/interp/cancel.ts), not the script's
      - `encoding: "buffer"` / `encoding: null` / no encoding where node returns a `Buffer`
      - `bigint: true` on `stat`/`lstat`
      - any option whose node behavior needs a handle, stream, or watcher

      Options to honour (prove each is really passed through, not dropped): `mkdir` `mode` and
      `recursive`, `rm` `force`/`recursive`/`maxRetries`/`retryDelay`, `readdir`
      `withFileTypes`/`recursive`/`encoding`, `writeFile` `flag`/`mode`/`flush`, `appendFile`
      `flag`/`mode`, `copyFile` `mode`, `cp` `recursive`/`force`/`errorOnExist`/`dereference`,
      `rmdir` `maxRetries`/`retryDelay`, `stat`/`lstat` `throwIfNoEntry` where node accepts it.

      Audit the option surface against the installed node version's `fs/promises` typings rather
      than a remembered list, and fail the test suite if the module accepts an option key it does
      not handle — an unknown key must reject, never pass through unvalidated.

      TDD with memfs; no real files.
    notes: |
      `cp` is not part of this module's surface (see fs-module-core), so its options are not
      classified here. Adding `cp` is separate work: its `filter` option is a callback the
      sandbox would have to call back into, and a recursive copy needs its own root-confinement
      design.

      The audit reads @types/node, which is ahead of the runtime node: it has already dropped
      `rmdir`'s options argument, while node 22 still validates `maxRetries`/`retryDelay`. The
      audit therefore proves every option node's typings declare is classified, and the table is
      allowed to classify more than the typings declare. `signal` on `appendFile` is the same
      skew in reverse: undeclared by the typings, honoured by the runtime.

      `throwIfNoEntry` is forwarded rather than refused: node's fs/promises accepts the key and
      ignores it (only the sync variants honour it), so forwarding is node's own behaviour.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fs-mkdir-rm-edges
    title: mkdir/rm/rmdir edge cases and return values
    prompt: |
      These are the operations whose node semantics are most often approximated wrong. Cover each
      in packages/safejs/src/modules/fs.ts with a test that asserts against the real node
      behavior (return value, `code`, `errno`, `syscall`, `path`, and message):

      - `mkdir` recursive: returns the *first directory created* as a path string, and
        `undefined` when nothing was created — not `true`, not the requested path
      - `mkdir` non-recursive with a missing parent → `ENOENT`
      - `mkdir` non-recursive on an existing directory → `EEXIST`; recursive on an existing
        directory → resolves to `undefined`
      - `mkdir` where a path segment is an existing *file* → `ENOTDIR`; on the leaf being an
        existing file → `EEXIST` (recursive and non-recursive both)
      - `mkdir` with `mode` and the process umask interaction — assert what node reports back via
        `stat().mode`, and if umask makes this environment-dependent, assert the relationship
        rather than a literal
      - `rm` missing without `force` → `ENOENT`; with `force` → resolves
      - `rm` a directory without `recursive` → node's current error for that case (check the
        installed version: `ERR_FS_EISDIR` vs `EISDIR`), with `recursive: true` → resolves
      - `rm` `force: true` on a directory without `recursive` still errors
      - `rmdir` on a non-empty directory → `ENOTEMPTY`; on a file → `ENOTDIR`; on missing →
        `ENOENT`
      - `rmdir` on a symlink to a directory → node's error, not a followed delete

      TDD with memfs; no real files. Where memfs disagrees with node, the node behavior wins and
      the divergence is recorded per the fs-node-truth-fixture task.

      Recorded outcome: the module needed no change — mkdir/rm/rmdir are pure passthrough and
      already surface node's answer untouched. The work was the assertions, and memfs turned out
      unable to ground 13 of the 24 cases, including every headline bullet. The recorded gaps
      (darwin, node v22.22.2, umask 0o022) now live as data in the `mkdir, rm, and rmdir node
      semantics` block of packages/safejs/src/modules/fs.test.ts for fs-node-truth-fixture to lift:

      - mkdir recursive returns the requested path, not the first directory created
      - mkdir recursive on an existing *file* resolves instead of `EEXIST`
      - mkdir blames the missing parent / file segment rather than the path it was given
      - rm blames `stat` where node's rm `lstat`s first
      - rm on a directory raises a plain `Error` with the code prefixed to node's message, where
        node raises a `SystemError` (`ERR_FS_EISDIR`, a positive errno of 21)
      - rm on a symlink to a directory follows the link instead of unlinking it
      - rm on a *dangling* symlink stats through the link and raises `ENOENT`, where node unlinks
        the link and resolves without needing `force`
      - memfs applies no umask to mkdir's mode
      - memfs sets neither `errno` nor `syscall` on any error

      Every recorded literal above was afterwards replayed against real node v22.22.2 on darwin and
      matched, including the two most easily mis-recorded: rm-on-a-directory's positive errno 21 and
      `ENOTEMPTY`'s darwin errno of -66 (Linux uses -39, so a fixture that asserts errno must record
      the platform). Four cases the first pass missed, each a semantic the passthrough gets right
      only because it forwards:

      - `force` forgives `ENOENT` and nothing else — `rm('/f/leaf', {force: true})` through a file
        segment still raises `ENOTDIR` from the `lstat`
      - mkdir recursive builds its answer from the path it was handed, not a normalised one:
        `/repo/./d1/../d1/d2` answers `/repo/./d1`, and a relative path answers a relative one.
        Mutation-testing showed the already-normalised cases cannot catch a module that resolves its
        result, so this case is the only guard against one
      - node still honours rmdir's deprecated `recursive` (DEP0147) on v22, and rmdir refuses a
        dangling symlink with `ENOTDIR` — memfs agrees on both, so both assert over memfs
      - recursive rm of a link to a directory resolves on node *and* memfs while memfs deletes the
        target node leaves alone. The case table compares what an operation answered, so it is
        structurally blind to this; it needs a test that asserts the effect, and it is the one gap
        where memfs silently destroys data rather than reporting differently

      mode/umask is asserted as node's rule (`reported === mode & ~umask`) over four umask/mode pairs
      recorded from real node, because memfs applies no umask and so cannot ground the relationship.
      The one mode assertion driven over memfs takes its mode from the live umask rather than a
      literal, so its premise holds under any umask — a literal `0o700` fails under `0o277`, where
      node reports `0o500`.

      Two consequences worth carrying forward. First, a memfs-only assertion of the headline case
      is unfalsifiable: memfs already returns mkdir's requested path, so a module that returned the
      requested path passes. Mutation-testing proved this, so each case is additionally driven over
      a reference that replays node's recorded answer — that is what makes `errno`/`syscall` and the
      first-created-directory assertable with no real disk, and it catches that mutation. Second,
      the pre-existing "returns the implementation's result untouched" test asserts memfs's wrong
      mkdir answer; it is honestly named and proves transparency, not node parity, so it stays.
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: fs-symlink-edges
    title: Symlink, readlink, and realpath edge cases
    prompt: |
      Symlinks are where a filesystem facade usually stops matching node. In
      packages/safejs/src/modules/fs.ts, cover each of these with a test asserting node's exact
      result or error (`name`, `code`, `errno`, `syscall`, `path`):

      - `stat` on a dangling symlink → `ENOENT`; `lstat` on the same link → resolves, and
        `isSymbolicLink()` is `true` while `isFile()` is `false`
      - `readlink` returns the target *exactly as stored* — relative stays relative, never
        resolved or normalized
      - `readlink` on a regular file → `EINVAL`; on missing → `ENOENT`
      - `realpath` on a dangling symlink → `ENOENT`; on a chain of links → the final canonical
        path
      - a symlink loop (`a` → `b` → `a`): `readFile`/`stat`/`realpath` → `ELOOP`, `lstat` still
        resolves
      - `symlink` where the path already exists → `EEXIST`; a dangling target is allowed (node
        does not validate the target)
      - `unlink`-equivalent (`rm`) on a symlink removes the link, not the target
      - `readFile` through a symlink to a directory → `EISDIR`
      - `copyFile` from a symlink copies the *contents* (follows), while `cp` with
        `dereference: false` copies the link — assert whichever node does for the installed
        version

      TDD with memfs; no real files.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-copy-rename-edges
    title: copyFile/cp/rename/link edge cases
    prompt: |
      Add `cp` to the exported surface of packages/safejs/src/modules/fs.ts (same signature and
      options as `node:fs/promises`), then cover these against node's exact result or error
      (`name`, `code`, `errno`, `syscall`, `path`, `dest`, message):

      - `copyFile` with `COPYFILE_EXCL` onto an existing destination → `EEXIST`
      - `copyFile` onto itself (same path) → node's behavior; source is not truncated
      - `copyFile` where source is a directory → node's error; where destination is a directory
        → node's error
      - `copyFile` overwrites an existing destination's contents fully (shorter source does not
        leave a tail)
      - `cp` non-recursive on a directory → `ERR_FS_EISDIR`; recursive → copies the tree
      - `cp` with `errorOnExist: true` and `force: false` onto an existing file → node's error
      - `cp` of a directory into itself → node's `ERR_FS_CP_EINVAL`-family error
      - `rename` onto itself → resolves as a no-op
      - `rename` missing source → `ENOENT`; file onto an existing directory → node's error;
        directory onto an existing file → node's error; directory onto a non-empty directory →
        `ENOTEMPTY`
      - `rename` overwriting an existing file → resolves, destination has the source contents
      - `link` where the destination exists → `EEXIST`; where the source is a directory → node's
        error; `link` then modify → both paths see the change and `stat().nlink` reports what
        node reports

      TDD with memfs; no real files. Where memfs cannot model a case (e.g. `EXDEV` cross-device
      rename), record it as a known reference gap per fs-node-truth-fixture rather than asserting
      a made-up result.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-write-flag-edges
    title: writeFile/appendFile/truncate flag, mode, and length edge cases
    prompt: |
      Cover the write-side semantics of packages/safejs/src/modules/fs.ts against node's exact
      result or error (`name`, `code`, `errno`, `syscall`, `path`, message):

      - `writeFile` default flag `w` creates and truncates; over a longer existing file no tail
        remains
      - `writeFile` with `flag: "wx"` onto an existing path → `EEXIST`
      - `writeFile` with `flag: "r+"` onto a missing path → `ENOENT`
      - `writeFile` with `flag: "a"` appends rather than truncates
      - `writeFile` onto a directory → node's error (`EISDIR`)
      - `writeFile` with `mode` on creation vs on an existing file (node only applies mode at
        creation) — assert the difference
      - `appendFile` creates when missing; appends when present; with `flag: "r"` → node's error
      - `writeFile` of an empty string creates an empty file
      - `truncate` shrinking, growing (grown region reads back as NUL bytes — assert through the
        chosen encoding), to zero, on missing → `ENOENT`, on a directory → node's error
      - `truncate` with no length argument defaults to 0 like node
      - a non-string data argument (number, object, `null`) → node's `ERR_INVALID_ARG_TYPE`, not
        a stringified write

      TDD with memfs; no real files.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-error-message-parity
    title: Match node's error message text, and document the stack deviation
    prompt: |
      Node's system errors have an exact message format: `ENOENT: no such file or directory,
      open '/tmp/x'` — errno name, colon, the OS description, comma, the syscall, and the quoted
      path (two-path calls append ` -> '<dest>'`). Scripts and logs depend on this text.

      Add a test suite to packages/safejs/src/modules/fs.ts's tests asserting the full message
      string (not a substring match) for a representative error per syscall: `open`, `read`,
      `scandir`, `mkdir`, `rmdir`, `unlink`, `rename`, `copyfile`, `link`, `symlink`, `readlink`,
      `realpath`, `stat`, `lstat`, `access`, `chmod`, `utimes`, `truncate`. Derive the expected
      text from the reference API rather than typing it by hand, and assert `error.name` is
      `Error` (node's system errors are plain `Error`s, not `TypeError`s) while argument errors
      are `TypeError`/`RangeError`.

      Then handle the one field that cannot match: `error.stack`. The sandbox rewrites stacks to
      sandbox frames (`normalizeSurfacedSubsetError` in packages/safejs/src/interp/exceptions.ts),
      so a node stack is neither available nor meaningful inside a script. Assert that the stack
      is sandbox-shaped and that the first line is still `name: message`, and add `stack` to the
      documented deviations list in the fs-docs task.

      Confirm the message-format assumption against the installed node version before writing the
      assertions — if the reference API produces a different shape, the reference wins.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-node-conformance-suite
    title: "Differential conformance suite: fs module vs node:fs/promises"
    prompt: |
      Add packages/safejs/src/modules/fs.conformance.test.ts in the spirit of
      packages/safejs/src/interp/conformance.test.ts: a shared case table where each case runs the
      same operation twice over an identical, freshly created memfs volume — once directly against
      the memfs `promises` API (the reference) and once through `makeFsModule` with no `root` — and
      asserts the results are deeply equal and that failures match on `name`, `message`, `code`,
      `errno`, `syscall`, `path`, and `dest`. Export the case table: fs-node-truth-fixture records
      real-node outcomes from this same table, so it must be data, not inline assertions.

      Cover at minimum: `readFile` missing file (ENOENT), `readFile` on a directory (EISDIR),
      `writeFile` into a missing directory (ENOENT), `writeFile` over a directory,
      `mkdir` existing (EEXIST), `mkdir` recursive return value, `mkdir` non-recursive with a
      missing parent, `rm` missing without `force`, `rm` missing with `force`, `rm` directory
      without `recursive` (ERR_FS_EISDIR/EISDIR as node reports it), `rmdir` non-empty
      (ENOTEMPTY), `readdir` missing (ENOENT), `readdir` on a file (ENOTDIR), `readdir`
      withFileTypes, `readdir` recursive, `stat` vs `lstat` on a symlink, `access` with
      `R_OK`/`W_OK` on missing paths, `copyFile` with `COPYFILE_EXCL` onto an existing file
      (EEXIST), `cp` recursive, `rename` missing source (ENOENT), `realpath` missing (ENOENT),
      `readlink` on a regular file (EINVAL), `truncate` beyond length, and each encoding
      round-trip. Fold the cases the edge-case tasks defined into the same table rather than
      duplicating them.

      Also add a case-generation note in the test file header stating the rule: any behavior
      difference from the reference is a bug in the module, except the deviations documented in
      docs/plans/safejs-optional-filesystem.md (Buffer results, Buffer/URL/fd paths, bigint stats,
      Date stat fields, `signal`, FileHandle, streams, watch, `error.stack`) and the
      root-confinement EACCES. Never assert `readdir` order. Tests must be fast and must not touch
      the real disk.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-node-truth-fixture
    title: Ground the conformance suite in real node behavior, not memfs behavior
    prompt: |
      The differential suite from fs-node-conformance-suite proves the module matches *memfs*.
      memfs is not node: it approximates errno behavior and diverges in places. Without a
      node-truth reference, "matches node exactly" is unproven.

      Add a generator script (e.g. scripts/record-fs-conformance.ts, wired as an npm script) that
      runs the conformance case table against real `node:fs/promises` in a fresh
      `os.tmpdir()` directory, records `{ result | { name, message, code, errno, syscall, path,
      dest } }` per case plus `process.platform` and `process.version`, cleans up after itself,
      and writes a committed JSON fixture. This is a script, not a test — tests still never touch
      the real disk.

      Then have the conformance test compare the module-over-memfs outcome against the recorded
      node fixture for the current platform. Where memfs cannot reproduce node, mark that case in
      the fixture as a reference gap with a one-line reason and skip it loudly (the test reports
      the skip list; a case cannot be silently absent). Where the module diverges from node and
      memfs is not to blame, that's a module bug — fix the module.

      Fail the suite if the fixture is missing cases the table defines, so adding a case forces a
      re-record. Document the record-and-refresh workflow in a header comment and in the fs-docs
      task's README section.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-platform-variance
    title: Handle darwin/linux errno variance and scope win32 explicitly
    prompt: |
      Node's fs errors are not identical across platforms: unlinking a directory is `EPERM` on
      darwin and `EISDIR` on linux, message text comes from the OS, path canonicalization is
      case-insensitive on default darwin volumes, and win32 diverges further (`EPERM`/`UNKNOWN`,
      drive letters, no real symlinks without privileges).

      Make this explicit rather than accidental:
      - The conformance suite must never assert a hardcoded platform-specific errno; it compares
        against the reference/fixture for the running platform (see fs-node-truth-fixture).
      - packages/safejs/src/modules/fs.ts must not normalize or translate platform errnos — it
        passes node's error through untouched. Add a test proving a platform-specific code is
        surfaced verbatim (inject a reference that throws darwin's code and linux's code; the
        module returns each unchanged).
      - Root confinement must stay correct under case-insensitive path comparison on darwin (a
        case variant of an in-root path is in root) — cover it here if fs-root-confinement-edges
        didn't already.
      - Decide and record win32 support: either supported and covered by a recorded fixture, or
        explicitly out of scope with a clear startup error / documented limitation. No silent
        half-support.
      - CI runs on one platform; state in the test header which platform the committed fixture
        was recorded on and how a contributor on another platform refreshes it.

      TDD with memfs and injected reference implementations; no real files.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-concurrency-and-snapshot-edges
    title: Concurrent fs calls, cancellation, and snapshot/restore edges
    prompt: |
      The fs module is a host module, so it inherits the bridge's journal, cancellation, and
      snapshot machinery (packages/safejs/src/interp/host-call.ts,
      packages/safejs/src/interp/cancel.ts, packages/safejs/src/snapshot/policy.ts). Prove it
      behaves at the edges:

      - `Promise.all([...])` over several `readFile` calls resolves each to its own result with no
        cross-talk, and one rejecting call does not corrupt the others
      - `Promise.allSettled` over a mix of hits and `ENOENT`s reports each error with its own
        `path`
      - an `AbortSignal` firing while an fs call is in flight surfaces the existing abort behavior
        (not an fs error), and the run reports aborted
      - snapshot taken with a pending `readFile` then restored: the `"re-issue"` policy re-runs
        the read
      - snapshot taken with a pending `writeFile` then restored: the `"read-side-effect"` policy
        behaves as it does for `git.commit` — it does not blindly re-apply the mutation; assert
        the same observable behavior the existing git tests assert
      - an fs operation with no declared policy must fail loudly with
        `HostOperationResumePolicyError`; add a test that enumerates every exported fs operation
        and asserts each has a declared policy, so a future operation cannot ship undeclared

      TDD with memfs; no real files. Reuse the existing snapshot/restore test helpers rather than
      inventing new ones.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-budget
    title: Charge fs reads against the SafeJS data budget
    prompt: |
      A SafeJS script must not be able to blow past its budget by reading a huge file. Verify
      how `copyHostResultToSandbox` / `Budget` (packages/safejs/src/interp/budget.ts) account
      for strings and arrays returned from host calls, and make sure `fs.readFile` and
      `fs.readdir` results are charged against `stringLength`, `arrayLength`, and the data
      budget like any other host result. If the existing bridge already charges them, prove it
      with tests instead of adding new code.

      TDD: with memfs, a `readFile` of a file larger than the configured string budget must
      fail with the existing budget error (`SandboxError` with `code: "budgetExceeded"`) and
      must not corrupt the run; a large `readdir` must be charged the same way. Keep the tests
      fast — small budgets, small fixtures, no real files.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-off-by-default-integrity
    title: Prove fs stays absent unless explicitly enabled
    prompt: |
      SafeJS's sandbox promise is that no filesystem exists unless the embedder registers one.
      Extend packages/safejs/src/sandbox-integrity.test.ts with cases proving that a default
      `run()` and a default `poe-safejs` module registry expose no `fs` module: `import { readFile }
      from "fs"` fails with the existing unknown-module diagnostic listing available modules,
      `import ... from "node:fs"` fails the same way, and the lint layer
      (packages/safejs/src/lint/runtime-modules.ts) reports it without any fs-specific rule —
      the lint surface must keep being derived from the runtime registry. Then prove the mirror
      case: when `makeFsModule` is registered, the same import lints and runs.

      Do not add fs to any default registry. Tests use memfs for the enabled case; no real files.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: harness-run-fs-flag
    title: Gate the fs module behind poe-code harness run --fs
    prompt: |
      Wire the opt-in filesystem into the harness command. In src/cli/commands/harness.ts,
      `createHarnessModules()` builds the registry (agent, fail, git, harness, log, metric) and
      `registerHarnessCommand` declares the run flags. Add:

      - `--fs` — off by default; when present, register `makeFsModule` from @poe-code/safejs in
        the harness module registry under `fs`.
      - `--fs-root <path>` — root for confinement, resolved against `container.env.cwd`,
        defaulting to the harness directory (`meta.dirname`) when `--fs` is given without it.
        Passing `--fs-root` without `--fs` is a `ValidationError` explaining the fix.

      Follow the surrounding conventions: `HarnessRunOptions` type entry, option registration
      next to the existing run options, and honour `--dry-run` (report that fs would be enabled
      and at which root, without running). Keep SDK parity — expose the same capability through
      the SDK harness-run path used by the CLI (see src/sdk/, src/cli/commands/harness.ts callers)
      as an `fs?: { root?: string }` option, and make the CLI pass its flags into the SDK rather
      than assembling the module registry twice.

      TDD in src/cli/commands/harness-command.test.ts (and the SDK's own test) with memfs: no
      `--fs` means an `fs` import in a harness fails as unknown; `--fs` makes it work rooted at
      the harness dir; `--fs-root` overrides the root; `--fs-root` alone errors. Then spot check
      with `npm run dev -- harness run --help` and a screenshot via
      `npm run screenshot-poe-code -- harness run --help` to confirm the help renders well.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: safejs-cli-fs-flag
    title: Add --fs to the poe-safejs runner
    prompt: |
      packages/safejs/src/cli.ts runs markdown harness files with stub host modules and parses
      its own flags (see `ParsedArgs`: `--fix`, `--max-steps`, `--data-size`, `--snapshot`,
      `--restore`). Add `--fs` (off by default) and `--fs-root <path>` with the same meaning as
      the poe-code harness flags: `--fs` registers `makeFsModule` under `fs`, rooted at
      `--fs-root` when given, otherwise the directory of the harness file. `--fs-root` without
      `--fs` is a usage error with a clear message and non-zero exit. Unlike the other bundled
      stubs, fs is real — say so in the usage text.

      Keep the CLI declarative: no fs logic in cli.ts beyond flag parsing and passing options to
      `makeFsModule`.

      TDD in packages/safejs/src/cli.test.ts using the existing injected-stream/inject-fs test
      seams plus memfs; no real files. Verify the usage/help text output too.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: fs-docs
    title: Document the optional filesystem capability
    prompt: |
      Document the opt-in fs module now that it exists.

      1. packages/safejs/README.md: the "Sandbox by design" section currently says SafeJS ships
         "no built-in filesystem" and tells embedders to build their own narrow module. Update it
         to describe `fs` as an explicitly-registered, off-by-default capability whose surface
         matches `node:fs/promises` exactly, list the supported operations, and state the
         compliance rule: identical return values and identical error `name`/`message`/`code`/
         `errno`/`syscall`/`path`/`dest`, verified against a recorded real-node fixture.

         List every deviation, each of which throws rather than diverging silently: Buffer
         results (no `Buffer`/`Uint8Array` in the sandbox), `bigint: true` stats, `Buffer`/`URL`
         path arguments (both of which node accepts; an integer path is not a deviation, it is
         node's own `ERR_INVALID_ARG_TYPE`, as `fs/promises` has no descriptor path form), the
         `signal` option, `FileHandle`/`open`, streams, `watch`, `opendir`, callback/sync APIs,
         `Date` stat fields (the `*Ms` numbers are exposed instead), and `error.stack`
         (sandbox-shaped, not a node stack). Note the one deviation that is an ordering rather
         than a refusal: with both a bad path and another bad argument, SafeJS blames the path
         because it validates paths itself (`root` rewrites them first), where node may blame the
         other argument. Explain the `root`
         confinement and its node-shaped EACCES denial, note that `readdir` order is
         filesystem-dependent exactly as in node, note the resume policies (reads re-issue,
         mutations read-side-effect), state the platform-support decision from
         fs-platform-variance, and document the fixture record/refresh workflow from
         fs-node-truth-fixture. Add the `--fs` / `--fs-root` flags to the `poe-safejs` docs in
         that README. Keep the existing advice that a narrower purpose-built module is preferable
         when you only need a few paths.
      2. packages/safejs/README.md config/env section and, if the harness wiring lives there,
         packages/agent-harness/README.md: document the new config options exposed
         (`fs`, `fs.root`) per the package README rules in AGENTS.md.
      3. Root README.md: do not touch it — that needs the user's permission.

      Do not restate anything derivable elsewhere and do not add code examples that the lint
      subset would reject. This is a docs-only task: no source changes.
    status:
      implement: open
      commit: open
---

# Context

## Goal

An **optional** filesystem capability for SafeJS: a bundled `fs` host module that is not
registered by default and is turned on with a flag (`poe-code harness run --fs`,
`poe-safejs --fs`, SDK `fs: { root }`).

## Compliance bar

"Matches node exactly" means: for any call SafeJS accepts, the observable result — return
value, thrown/rejected error `name`/`message`/`code`/`errno`/`syscall`/`path` — is identical to
`node:fs/promises`. Enforced by a differential conformance suite (`fs-node-conformance-suite`)
that runs each case against the module and against the reference API over the same memfs volume.

Deliberate deviations, each documented and each producing an explicit error rather than divergent
behavior:

1. **No binary results.** `SandboxValue` has no `Buffer`/`Uint8Array`, so any call whose node
   answer would be a `Buffer` is rejected with an unsupported-capability `TypeError`. Every
   string encoding node supports is supported.
2. **No binary/URL path arguments.** The sandbox has no `Buffer` and no `URL`, so those path
   forms — both of which node accepts — are rejected rather than coerced. `fs/promises` has
   no file-descriptor path form (only the callback API takes one), so an integer path is
   node's own `ERR_INVALID_ARG_TYPE` like any other non-string and needs no SafeJS refusal.
3. **No handles/streams/watchers.** `open`/`FileHandle`, streams, `watch`, `opendir`, `bigint`
   stats, `Date` stat fields, the `signal` option, and the callback/sync APIs are not exported.
   They don't survive snapshot/restore, and YAGNI until a harness needs them.
4. **Sandbox-shaped `error.stack`.** Everything else on a system error matches node; the stack is
   rewritten to sandbox frames by `normalizeSurfacedSubsetError`, because a node stack is neither
   available nor meaningful inside a script.
5. **Which of two invalid arguments is blamed.** The module raises node's path errors itself
   (it must: a `root` rewrites the path before node sees it, and an injected implementation
   validates however it likes), so a call invalid in both its path and another argument is
   blamed on the path where node would blame the other — `readFile(42, "utf9")` reports the
   encoding in node and the path in SafeJS. Each error is node's own, shaped exactly as node
   shapes it; only the order two invalid arguments are reported in can differ.
6. **Optional root confinement.** With `root` set, escapes (via `..`, absolute paths, symlink
   targets, or hardlinks) reject with a node-shaped `EACCES` so scripts branch on `error.code` as
   usual. Without `root`, no confinement.

An ignored option is a worse deviation than a rejected one, so an unknown or unhandled option key
rejects rather than passing through unvalidated (`fs-unsupported-options`).

## Why memfs alone can't prove compliance

memfs is the test filesystem (tests never touch the real disk), but memfs is not node — it
approximates errno behavior. A module-vs-memfs differential only proves the module matches memfs.

Argument validation is the sharpest case: memfs performs almost none. A NUL-bearing path is an
`ENOENT` to memfs, an integer path is a file descriptor, an out-of-range `access`/`chmod` mode is
accepted, `truncate(path, -1)` leaves a size of `-1`, and its own argument errors carry no `code`
at all. So memfs can never be the reference for `fs-arg-validation`: node validates every argument
_before_ it opens anything, which is what lets real `node:fs/promises` be the reference in a test
that still creates no file. The module raises node's path errors itself and is proven equal to
node's by differential; every other argument is forwarded untouched and driven through the module
over real `node:fs/promises`. The one argument that resists this is `truncate`'s `len`: node opens
the path before validating it, so it is only reachable on a file that exists — its recorded truth
(`1.5`/`Infinity` → `ERR_OUT_OF_RANGE`, `"3"` → `ERR_INVALID_ARG_TYPE`, `-1` → truncates to zero)
belongs to `fs-node-truth-fixture`, and what the memfs suite proves is that the length arrives
unmodified.
So `fs-node-truth-fixture` records the case table's real-node outcomes via a **script** in
`os.tmpdir()` into a committed fixture, and the suite compares against that fixture. Cases memfs
cannot reproduce are marked as reference gaps and skipped loudly; a case can never be silently
absent. Platform-specific errnos (`fs-platform-variance`) are never hardcoded — `unlink` on a
directory is `EPERM` on darwin and `EISDIR` on linux, and the module passes node's error through
untranslated.

## Ordering

Implement, then verify, then wire: core surface (`fs-module-core` … `fs-root-confinement-edges`),
then argument/option/operation edge cases (`fs-arg-validation` … `fs-error-message-parity`), then
the verification layer (`fs-node-conformance-suite`, `fs-node-truth-fixture`,
`fs-platform-variance`), then flags and docs.

`fs-errno-bridge` comes first: `createHostErrorValue` in
packages/safejs/src/interp/host-bridge.ts currently rebuilds host errors and drops `code`,
`errno`, `syscall`, and `path`, so no amount of module-side work can make `error.code === "ENOENT"`
true inside a script. That fix is generic host-error metadata driven by an allowlist — not an
fs branch. Everything else builds on it; the flag wiring lands after the module is conformant.

## Constraints

- No fs-specific branching in the lint layer or module registry: the lint surface is derived
  from the runtime registry (packages/safejs/src/lint/runtime-modules.ts) and must stay that way.
- Resume policies are declared in the module via `declareHostOperation`, not added to the
  hardcoded table in packages/safejs/src/snapshot/policy.ts.
- The module knows nothing about logging, dry run, or the CLI.
- Tests use `memfs` via an injected fs implementation and never touch the real disk.
- CLI and SDK keep parity; the CLI calls the SDK.
