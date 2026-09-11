# Issue 689: wget through the bounded network transfer stack

Add `wget` to the explicitly enabled network plugin, using the same configured
HttpTransport, NetworkAuthorizer, VFS, and host network limits as curl. Default
agent command registration remains network-free. No host wget process, ambient
credentials, proxy configuration, or alternate network client is introduced.

## Behavior

Supported arguments: `-O FILE`, `-O-`, `--output-document`, `-q`/`--quiet`,
`-nv`/`--no-verbose`, `--timeout SECONDS`, `--tries COUNT`, `--help`, `--version`,
and one explicit HTTP(S) URL. Long valued options accept `=VALUE`; short output
and quiet flags can combine as `-qO-`. `--` terminates options. Recursive
mirroring (`-r`/`--recursive`) and other unimplemented flags refuse before any
request or output file acquisition.

Default output is the initial URL's basename in the VFS, excluding its query;
a directory URL uses `index.html`. Explicit `-O-` streams exact bytes to stdout.
This follows the bounded curl remote-name file policy, including overwrite
behavior, rather than implementing GNU numbered filename collision handling.
Redirects are followed within host limits, reauthorized at each hop, and retain
the existing cross-origin credential stripping and HTTPS downgrade refusal.
HTTP errors suppress response bodies and return wget status 8. File failures
return 3, network/policy/time/byte failures 4, TLS verification failures 5, and
syntax/unsupported requests 2. Quiet suppresses operational diagnostics;
no-verbose retains errors. This noninteractive profile emits no progress meter.

Timeout is an aggregate transfer duration, capped by the host time budget;
zero cannot disable the host cap. Tries counts total attempts. The default is
20 total attempts capped by `maxRetries + 1`; zero is also host-capped. These
intentional differences from GNU idle-timeout/unlimited-retry semantics appear
in `wget --help`.

Transient HTTP statuses use the existing shared retry path. Wget additionally
retries acquisition failures with ECONNRESET, ETIMEDOUT, or EPIPE before a
response has been acquired. Each retry reauthorizes and consumes the same
elapsed deadline. Aggregate elapsed tracking retains the existing per-command
factory and execution-scope contract; the shell also retains its global limits. DNS, connection refusal, TLS, and policy denial remain fatal.
Body/output failures after publication are not replayed, preventing duplicate
stdout bytes or repeated partial VFS effects. Curl's retry classification stays
unchanged. GNU retry distinctions were checked against its primary manual:
https://www.gnu.org/software/wget/manual/wget.html .

## Shared implementation

`createTransferCommand` in the existing curl module owns the sole transfer
pipeline. Curl and wget supply typed parsers, command identity, help, and exit
status mapping. Wget does not synthesize curl argv or delegate an unauthenticated
argument carrier. The transfer path retains per-hop authorization, transport
private-address enforcement capability checks, response disposal, deadlines,
response/header/download limits, output cleanup, backpressure, and original
caller cancellation reasons.

Wget arguments are bounded before retained byte copies. Raw arguments must be
valid UTF-8; string arguments must have paired UTF-16 surrogates so they cannot
alias a replacement-character URL or VFS path. Long byte/string validation
checkpoints cooperatively. Literal U+FFFD and BOM filenames remain distinct and
valid. The network plugin checks every name collision before registering either
curl or wget.

## TDD and validation evidence

- `/tmp/poe-689-red.log`: missing wget makes all six initial memory-transport
  tests fail (VFS/stdout bytes, flags, recursive refusal, redirect authorization).
- `/tmp/poe-689-exports-red.log`: the network aggregate's old one-command
  expectation is updated to exactly curl and wget.
- `/tmp/poe-689-short-flags-red.log`: combined `-qO-` fails before the typed
  short-option scanner correction.
- `/tmp/poe-689-transport-retry-red.log` and `-green.log`: transient acquisition
  reset retries while connection refusal stays fatal, using mocked timers.
- `/tmp/poe-689-sdk-utf8-red.log` and `-green.log`: invalid surrogate SDK paths
  refuse before network access; literal replacement/BOM paths preserve identity.

All newly authored tests use the in-memory filesystem and injected transports.
Retry clocks are mocked rather than imposing real backoff on unit tests.
Existing maintained network tests qualify native transports separately.
Root public acceptance covers injected transport policy, cancellation and
recovery, retry counts, redirect/deadline caps, output bytes, and plugin wiring.

Maintained commands from `packages/safe-bash`:

```sh
node scripts/test-reporting.mjs --import tsx tests/commands/network/*.test.ts tests/shell/network-execution-deadline.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node tests/commands/network/wget.test.ts tests/commands/network/exports.test.ts
node scripts/test-reporting.mjs scripts/integration-inputs.test.mjs
```

Final checks pass: 870 network/deadline tests, 100 admission tests, and
strict TypeScript. Evidence: `/tmp/poe-689-final-network.log`,
`/tmp/poe-689-final-types.log`, and `/tmp/poe-689-admission.log`.
Root coordinates the normal build, installed cross-runtime acceptance,
screenshot, final lint, atomic remote-main delivery, and release verification.

## Portable export correction

The first installed candidate passed Node/Bun but failed browser bundling and
browser types: the root omitted network factories/types and the network subpath
loaded Node transport modules eagerly. The original evidence remains at
`/private/tmp/poe-689-public-_uyn87gj/bundle.log` and `types-browser.log`.
The relevant lint attempt was stopped and is not counted as a passing gate.

Network public factories/types now have a shared public entry; the Node entry
adds only the native transport export. Root and network-subpath browser/workerd
conditions share one emitted browser bundle and the portable public declarations.
The maintained portable bundler substitutes one exact platform module, retaining
native Node header/random/default-transport behavior in Node. The portable
module uses Web Crypto, equivalent HTTP header character validation, and requires
an explicitly supplied transport. `createFetchTransport()` remains available,
but still cannot claim DNS/private-address enforcement: policy requiring that
capability fails closed before transport. No Node transport is imported into the
portable graph, and VFS path operations use the existing shared path contract.

`/tmp/poe-689-portable-boundary-red.log` records the new boundary regression.
Maintained in-memory bundle tests cover root/subpath factory identity, the
absence of Node graph imports, explicit transport requirement, valid and invalid
HTTP headers, a real injected portable transfer, and multipart crypto setup.
Node network/deadline tests verify the native path remains intact. Additional
manifest and scoped-package tests cover the conditional export changes. Final
logs: `/tmp/poe-689-portable-tests-final.log`,
`/tmp/poe-689-portable-package-tests.log`,
`/tmp/poe-689-portable-network-complete.log`, and
`/tmp/poe-689-portable-types-complete.log`.
The portable path migration retains normalized body/header alias refusal;
`/tmp/poe-689-portable-path-alias-red.log` records its regression and the final
871-test network cohort passes after using the shared normalizePath contract.
The root bundle tests pass 22/22, package tests 2/2, and strict types pass. Installed cross-runtime and type acceptance
must be rerun on fresh normal-build artifacts by the root agent.

## Committed-revision validation

The first full `npm test` run completed the shared batch (22,389 passing tests,
2 skips), 303 safe-bash runner checks, and the safe-bash suite (27,410 passing,
86 skips). Its sole failure was the S3/HTTP committed-export guard: selected HEAD
package metadata differed from the edited root/workspace export manifests.
Evidence: `/tmp/poe-689-full-unit.log` and the isolated report
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/poe-689-s3-review-80HjX6/report.json`.
The guard correctly failed before build/pack steps; no harness changes are needed.

Create reviewed local commits, then rerun that guard and the maintained full unit
route against matching committed metadata before pushing. Unavailable/skipped
profiles are not counted as passes. Final package qualification uses a fresh
normal build, 46 public network checks plus 313 retained checks across four
runtimes, conditional public type checks, screenshots, and maintained lint.
