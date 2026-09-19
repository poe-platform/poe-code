# Isolated native reference tooling

The existing TypeScript ESM domain engine and opt-in safe-bash plugin retain all
14 original command names. This tooling is separate from both: nothing in src,
the product exports, package build hooks or canonical unit discovery imports or
executes it. `tools/reference/checks.ts` is an explicit, in-memory tooling check,
not a native oracle test or a substitute for maintained domain unit tests.

The target remains csvkit 2.2.0 with source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Historical profile, source manifest, captures and failures remain unchanged.
The frozen CPython profiles and distribution manifests are in
[reference-profile.json](reference-profile.json); exact replay environment,
locale and pipe stream metadata are in
[reference-requalification-20260917.json](reference-requalification-20260917.json).

## Capture inputs

Invoke explicitly from the repository root:

```sh
node --import tsx packages/csvkit/tools/reference/capture.ts \
  /absolute/path/to/out/binding.json \
  /absolute/path/to/out/request.json \
  /absolute/path/to/out/case-directory \
  /absolute/path/to/out/new-capture.json
```

The case directory must already exist below this repository's out directory;
the capture destination is outside that directory and must not already exist.
The runner does not install dependencies, discover executables through PATH,
download artifacts or manufacture inputs. The caller explicitly supplies trusted
native bindings. This is host-native oracle tooling, not a sandbox for arbitrary
native argv or authority to use host services. Product execution still uses
only explicitly injected filesystem/network/database/interpreter capabilities.

Binding JSON shape (replace paths and hashes with authenticated actual values):

```json
{
  "profileId": "darwin-cpython-3.14.2-csvkit-2.2.0",
  "interpreter": {"path": "/absolute/canonical/python3.14", "sha256": "frozen executable SHA-256"},
  "sourceArchive": {"path": "/absolute/canonical/csvkit-2.2.0.tar.gz", "sha256": "147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b"},
  "executables": {
    "csvcut": {"path": "/absolute/canonical/bin/csvcut", "sha256": "actual executable SHA-256"}
  }
}
```

Each requested executable keeps its original basename and literal argv. All
bindings are bounded, canonical regular-file artifacts; binary files are hashed
through streams and never decoded or dumped. Current tooling rejects interpreter
symlink aliases; a frozen canonical installation binding is required. It never
silently changes a virtual environment or substitutes the system installation.

Example request:

```json
{
  "id": "csvcut-two-columns-first",
  "command": "csvcut",
  "argv": ["-c", "1"],
  "stdinBase64": "YSxiCjEsMgo=",
  "env": {"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","TZ":"UTC","PYTHONIOENCODING":"utf-8","COLUMNS":"80","LINES":"24"},
  "tty": false,
  "timeoutMs": 1000
}
```

There is no ambient environment merge. Different env or true TTY requests are
blocked rather than treated as equivalent. No additional runtime env variables
or command-suite configuration options are exposed by this tooling.

The native-only Python probe hashes every installed non-pyc distribution file,
records its distribution-relative path and recomputes the historical sorted,
compact, sort_keys manifest hash. The runner compares frozen interpreter
hash/version/implementation/platform, every frozen distribution version/file
manifest, the selected frozen csvkit script hash, locale and pipe
buffering/encoding metadata before executing csvkit.
Installed script hashes are installation-specific; recreating a venv at another
path can correctly fail qualification. Missing or changed prerequisites produce
an exit-78 blocked capture with inspection evidence, not a comparison pass.

## Evidence and comparison

Capture records retain binding/request/stdin/profile/probe hashes, binary and
archive hashes, dependency file manifests, argv/env/cwd/TTY, base64 stdout/stderr,
native status and signal, timeout/output-cap events, before/after file bytes and
hashes, empty directories, and an explicitly uncontrolled elapsed observation.
Snapshots reject symlinks/special files and bounded-capture overflow. They are
trusted quiescent-directory observations, not atomic filesystem transactions.
The tool has 64 MB combined output and snapshot byte caps, 10,000 snapshot entries,
and a maximum 60-second per-process timeout. Capped/timeout/failed-stream captures
cannot pass an exact comparison. Stdin early-exit errors remain harness events;
they are never synthesized into the native stderr bytes.

`compareCapture` compares stdout/stderr/status/signal and both file snapshots
exactly. It does not rewrite warning or verbose traceback paths, normalize line
endings, strip diagnostics, compare decoded text instead of bytes, or treat
identical incomplete captures as passes. Database and interactive qualification
remain unmeasured even if visible output matches. Native linkage/compression
versions, driver/service transaction/result observers, workbook structured
semantics, PTY/IPython, controlled timing and signal/buffering equivalence need
their own authenticated evidence; the narrow profile check does not qualify them.

## Coverage ledger

Generate explicitly:

```sh
node --import tsx packages/csvkit/tools/reference/coverage.ts
```

[coverage.json](coverage.json) authenticates the original inventory inputs and
historical reference capture files. It retains each of 415 option declarations
(including applicability, defaults, choices and source help), 323 branches,
394 upstream test files, 14,817 source test declarations and 52 static test
assignments. Source declarations are not a runtime-collected test count. Each
entry retains its original declaration/disposition and an unresolved comparison
mapping. Exact case attribution requires reference/candidate source hashes,
inputs/profile/effects and named compared cases; it cannot be inferred from a
command-level passing total. Zero qualified mappings in this ledger means
attribution is unfinished, not that all existing product behaviors are absent.

This is an explicit blocker ledger, not full compatibility certification.
Historical captures remain useful evidence, but neither their existence nor
independent cleanup/refusal assertions qualify the current dirty candidate.
The existing engine's quoting, Unicode, Decimal, diagnostic, service, interpreter,
workbook and compression limitations remain in the maintained status records.
