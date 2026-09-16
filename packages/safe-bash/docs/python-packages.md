# Python package environments

Package provisioning is an explicit option of `pythonCommands` and the
`runBash` SDK's `python` configuration. Python remains optional. Registering a
plugin or running a non-Python shell command loads no interpreter and downloads
no packages. Imports never trigger dependency discovery or installation.

The supported runtime is Pyodide **314.0.6**, CPython **3.14.2**, wasm32 ABI
**2026_0**. Use the matching Pyodide-built native wheels. Desktop Linux, macOS
and Windows extension wheels cannot execute in this runtime. Pure-Python wheels
are installed with micropip and their declared dependencies. Source builds,
native pip and subprocess installers are not provided.

## SDK and CLI

The Python command options accept `packages` (package requirements or canonical
wheel paths), `requirements` (canonical requirements-file paths),
`packageProfile: 'documents'`, and `provisioning` (installer policy and storage).
The root SDK forwards the same options:

```ts
import { runBash } from 'poe-code';
import { createFetchTransport, createOriginAuthorizer } from 'poe-code/safe-bash';

await runBash({
  root: '/explicit/project',
  source: 'python report.py',
  python: {
    trustedPython: true,
    runtimeModuleURL: 'file:///explicit/pyodide/pyodide.mjs',
    packages: ['pypdf==6.18.1'],
    requirements: ['/requirements.txt'],
    provisioning: {
      cacheDirectory: '/python-cache',
      authorize: createOriginAuthorizer([
        'https://cdn.jsdelivr.net', 'https://pypi.org',
        'https://files.pythonhosted.org',
      ]),
      transport: createFetchTransport(),
      onProgress: event => console.error(event),
    },
  },
});
```

The host must explicitly supply runtime assets. The installation policy controls
package metadata and wheel downloads, not the trusted runtime loader. A fully
offline deployment must also preprovision the runtime module, WASM and stdlib
assets in its configured `indexURL`.

```sh
poe-code bash --root /explicit/project --python-trusted --python-runtime file:///explicit/pyodide/pyodide.mjs \
  --python-package-cache /python-cache \
  --python-package-allow-origin https://cdn.jsdelivr.net \
  --python-package-allow-origin https://pypi.org \
  --python-package-allow-origin https://files.pythonhosted.org \
  -c 'python -m pip install pypdf==6.18.1; python -c "import pypdf; print(pypdf.__version__)"'

poe-code bash --root /explicit/project --python-trusted --python-runtime file:///explicit/pyodide/pyodide.mjs \
  --python-package-cache /python-cache --python-package-offline \
  -c 'python -c "import pypdf; print(pypdf.__version__)"'
```

`--python-package` and `--python-requirements` are repeatable.
`--python-package-profile documents` selects the pinned profile below.
`--python-package-cache` is a path in the canonical filesystem exposed by
`--root`, not an implicit host cache. Prefer an absolute canonical path for a
stable environment across changes to `--cwd`. `--python-package-allow-origin`
is repeatable and is specific to the installer. Without authorization and a
transport, remote installation fails. Download progress goes to CLI stderr.

`provisioning` accepts:

| Option | Meaning |
| --- | --- |
| `requirements` | Additional package requirement strings, combined with `packages`. |
| `requirementFiles` | Additional canonical files, combined with `requirements` on the command options. |
| `profile` | `'documents'`; `packageProfile` on command options takes precedence. |
| `offline` | Refuse every missing remote artifact; defaults to false. |
| `transport`, `authorize` | Explicit `HttpTransport` and `NetworkAuthorizer`; both are required for downloads. |
| `cache` | Trusted host store implementing async `get(key): Uint8Array \| undefined` and `set(key, bytes)`. |
| `cacheDirectory` | Canonical persistent store; mutually exclusive with `cache`. |
| `maxCacheBytes` | Built-in memory-cache byte budget, default 128 MiB; positive safe integer. CLI: `--python-package-max-cache-bytes`. Does not limit external or canonical persistent caches. |
| `maxDownloadBytes` | Per-artifact bound, default 64 MiB. This is not a total runtime memory quota. |
| `onProgress` | Events with `phase: 'download' \| 'cached' \| 'installed'` and optional `url`, `bytes`, `totalBytes`. |

There are no package-specific environment variables. Requirements files support
one requirement per line, blank lines, comments and wheel paths relative to the
file. Package markers and named wheel references with extras are supported.
Selected extras propagate through declared dependencies, including extras added
to an already installed package. Requirement-file options, nested `-r`, and line continuations fail rather
than being ignored. Requirements from stdin (`-r -`) are unsupported. Each
requirements file is limited to 1 MiB.

## Scope, cache identity, conflicts and integrity

Without an explicit store, the environment and cache live in the plugin
instance. Both `python` and `python3` share it. Reuse the same plugin for multiple
commands; a new default plugin starts empty. An explicit `cache` or
`cacheDirectory` persists both artifacts and the installed environment manifest,
so a fresh plugin can reconstruct it. Separate stores/directories define separate
environments. The root `runBash` helper creates a new shell per call; use a
persistent store when retaining packages across calls.

The built-in cache retains at most `maxCacheBytes` of payload bytes and 1024
entries. It evicts the oldest inserted artifact/metadata entries before copying
new bytes. Artifacts too large for the remaining budget are not cached. The
installed environment manifest is protected from eviction; a manifest exceeding
the byte budget fails the commit explicitly. Offline replay can fail after an
artifact is evicted; online replay can download it again. These are payload
bounds, not JavaScript object-overhead or total process-memory measurements.

One package session retains at most one opened artifact, bounded by
`maxDownloadBytes`. Opening the next artifact retires the previous bytes;
concurrent opens in one session are rejected. The worker closes each artifact
in `finally` after transferring it, including failed reads. Session retirement
clears retained bytes and blocks later publication. Downloads can temporarily
retain chunks plus their assembled buffer and copies across the cache/worker
boundary. Installed/uncompressed package memory is not capped by these bounds.
External cache callbacks own their storage growth and concurrent access policy.
Manifest and cache metadata reads are checked against `maxDownloadBytes` before
decoding. New manifests and URL metadata are checked against the same bound
before cache publication, so an oversized record cannot replace a usable
environment or poison the next cached read. This does not undo an allocation
made by an external cache. Empty
download fragments retain no chunk objects. Trusted transport response headers
and callback allocations are not a total host-memory boundary.

Cache keys use `pyodide-314.0.6-cp314-emscripten-wasm32-v1`, the SHA-256 of each
artifact's bytes, and a SHA-256 URL key mapping to the content digest and response
headers. The persistent directory contains a runtime-key subdirectory. The
environment manifest retains original requirements/wheel sources and resolved
exact version pins. A new interpreter installs those cached artifacts before
running user code; this reconstructs site-packages without downloading again.
Metadata is retained for reproducibility; there is no automatic freshness check,
upgrade or uninstall. The built-in memory cache evicts artifacts under its bounds;
external stores have no plugin-managed eviction. Select a new environment to change an
installed version.

Conflicting requirements fail installation. The environment manifest is
published only after installation and dependency validation succeed. Concurrent
installations in one plugin detect a changed manifest and fail with a retry
diagnostic rather than overwriting it. Shared persistent stores require a single
writer across independently created plugins/processes: the canonical filesystem
contract does not supply a cross-process compare-and-swap transaction.
Resolution uses micropip's supported dependency resolver, not pip's backtracking
resolver. Direct wheel operands undergo compatibility, archive and integrity
validation even when that package version is already installed. Explicit pins
and wheel versions must match the resulting environment. Supply compatible pins
when resolution cannot find a valid set.

Pyodide native artifacts are checked against the matching runtime lock's
SHA-256; PyPI wheel and metadata digests are checked when supplied by the index.
Direct wheel URLs may carry the installer's SHA-256 fragment. Local wheels and
direct URLs without an expected digest are trusted inputs on their first read.
Every cached artifact is rehashed before reuse. Hash mismatch or malformed cache
metadata fails clearly; it never silently retries with unchecked bytes. The
store and its metadata are host-trusted: these checks detect corruption but do
not authenticate maliciously replaced metadata or replace signed provenance.

Cancellation reaches package transport, canonical reads and writes. Partial
downloads are not published as completed artifacts. An unsuccessful installation
does not publish a new environment manifest, though fully downloaded verified
artifacts remain available for retry. Retry is explicit: rerun the installation;
there is no automatic network retry loop. Cancellation cannot roll back a
completed canonical write or forcibly settle an uncooperative transport. On a
backend without atomic writes, interruption can leave an invalid record, which
is rejected on reuse; use a new cache directory or restore a trusted cache.

For offline preprovisioning, run installation once with explicit transport and
authorization, then retain the entire store and select `offline: true`. Local
wheel inputs can be used offline when their full dependency closure and
micropip/runtime assets are already available. An offline cache miss fails with
the missing artifact URL. Do not copy only an environment manifest: it does not
contain the wheels or package data.

## Shell installer compatibility

`python -m pip install` is a supported command facade over this Pyodide installer;
it does not run desktop pip. Its supported options are `-r FILE`,
`--requirement FILE`, `-h`, `--help`, and `--`.
`python3` supports the same workflow. Wheel operands and requirements files are
read from the invocation's canonical filesystem.

All other pip commands and options fail explicitly. This includes `--upgrade`,
`--force-reinstall`, `--no-deps`, `--target`, `--user`, `--prefix`, `--root`,
`--editable`, `--index-url`, `--extra-index-url`, `--no-index`, `--find-links`,
`--trusted-host`, `--require-hashes`, `--constraint`, `--dry-run`, `--quiet`,
`--verbose`, and cache/build/configuration options. Configure transport, cache
and integrity through `provisioning`; these unsupported flags never report
fake success. Use `provisioning.offline` or CLI `--python-package-offline` for
offline installation. Pip's `--no-index` semantics differ from this policy and
are not implemented.

## Document profile

This profile is opt-in and pins every verified dependency. It does not install
the legacy `fpdf` distribution, PyMuPDF, ReportLab, optional cryptography extras,
or a font file.

| Distribution | Version | Build |
| --- | --- | --- |
| python-docx | 1.2.0 | Pure Python |
| lxml | 6.0.2 | Matching Pyodide native wheel |
| openpyxl | 3.1.5 | Pure Python |
| XlsxWriter | 3.2.9 | Pure Python |
| pypdf | 6.18.1 | Pure Python |
| fpdf2 | 2.8.8 | Pure Python |
| Pillow | 12.2.0 | Matching Pyodide native wheel |
| fonttools | 4.65.0 | Pure Python |
| defusedxml | 0.7.1 | Pure Python |
| et-xmlfile | 2.0.0 | Pure Python |
| typing-extensions | 4.16.0 | Pure Python |

The [verified matrix](pyodide.md#pinned-installation-inputs) records original
package/runtime qualification. Document library support does not imply Word
layout, XLSX formula recalculation or arbitrary document conversion.

## Installation authority and runtime isolation

Installation requests use the configured transport and authorization policy,
including redirects. Package progress events report download/cache/install work.
No curl plugin or unrestricted guest networking is enabled by provisioning.
Conversely, installer authorization does not constrain Python's JavaScript
interop: the supplied worker/runtime host must separately enforce guest network
and host capabilities. A stock Node Pyodide worker is not an untrusted-code
security boundary.

Each Python invocation owns a fresh worker and interpreter. Installed artifacts
are reused, while user globals, mutated modules and interpreter state are not.
User scripts, wheel inputs, local modules, documents and requirements use the
canonical filesystem. Interpreter site-packages remain in runtime bootstrap
storage and are made available before that storage is mounted read-only.

Real-runtime acceptance is separate from fast mocked unit tests. Run the
[manual qualification](../../../docs/plans/python-package-provisioning-qa.md)
for installation, imports, package data, local modules, offline reuse and
failure cases. The [user edge review](../../../docs/plans/python-package-provisioning-edge-review.md)
records additional extras, wheel-conflict, cancellation and integrity regressions.
