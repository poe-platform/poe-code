# Recovering hey-gh repository reads

For Chief PR checks, use the supported repository read:

```sh
hey-gh pr list -R poe-platform/poe-code
```

If this fails with `GitHub returned HTTP 404: local API error` and no JSON
envelope, check the local server before diagnosing GitHub credentials. The
installed hey-gh 0.1.0 defaults to `http://127.0.0.1:8787`; another application
can occupy that port and return a valid HTTP response for the wrong API.

```sh
hey-gh --version
hey-gh --help
lsof -nP -iTCP:8787 -sTCP:LISTEN
# Inspect the PID reported by lsof:
ps -p <PID> -o pid,ppid,command
curl --connect-timeout 2 --max-time 5 -i http://127.0.0.1:8787/health
```

On Mac.lan on September 24, 2026, the failing default read returned exit 1
without an envelope. Port 8787 belonged to PID 49680 (parent PID 1), running
`/Users/kjopek/enhance-api/server.py`. Its health response identified Uvicorn
and audio enhancement/transcription capabilities. This is a local port
collision; the 404 is not evidence that the GitHub repository is missing.

A restricted execution sandbox can instead report `GitHub transport error:
error sending request`, even when the listener exists. That result does not
identify the service or establish an upstream GitHub failure. Repeat the same
read from a terminal permitted to access the local daemon, then inspect the
listener and its health response. On September 24, this comparison reproduced
the transport error inside the sandbox and the local API 404 outside it.
Neither response supplied a PR envelope, so neither can advance a saved cursor.

## Use a separate loopback port

Check that the proposed port is free. If it has a listener, inspect that owner
and choose another free port. Do not stop the existing application or assume
that an idle process is safe to kill.

```sh
lsof -nP -iTCP:18787 -sTCP:LISTEN
```

In a persistent terminal, start the daemon and wait for its listening message:

```sh
hey-gh serve --listen 127.0.0.1:18787
```

In the consumer terminal, explicitly select the same address for every read:

```sh
hey-gh --server http://127.0.0.1:18787 pr list -R poe-platform/poe-code
hey-gh --server http://127.0.0.1:18787 watches
```

Starting a daemon on 18787 does not change the CLI default. Keep the daemon
running while using it. If an owned daemon is already listening there, reuse
it. For a durable setup, configure the host's service manager and consumer
commands with the same listen/server address. The daemon uses the existing
`gh` login. Use `hey-gh logs --help` for local diagnostic options.

## Verify the envelope and upstream state

Parse stdout even when the read exits 1. Require a normal command completion,
`complete: true`, and no envelope or row source errors before treating an empty
list as verified. Preserve the cursor only from a parsed response; drain
`hasMore` using the same repository and server selection. Missing JSON or an
incomplete envelope is not a clean PR check.

The alternate-port read on September 24 returned the supported envelope:
`changes`, `complete`, `cursor`, `errors`, `hasMore`, `pullRequests`,
`totalCount`, and `truncated`. It reported `complete: false` with a discovery
error: account-wide GraphQL discovery encountered the `quora-internal`
organization's IP allow list. The CLI reported an incomplete report. This
proves local API recovery, but does not establish a complete repository list.
Retry from a permitted network or have the owning hey-gh implementation
investigate why a repository-selected read depends on account-wide discovery.
Do not discard the discovery error just because `pullRequests` is empty.

An independent repository capability check completed successfully:

```sh
gh api repos/poe-platform/poe-code --jq '{full_name,has_pull_requests}'
```

It returned `full_name: "poe-platform/poe-code"` and
`has_pull_requests: false`. PRs are disabled for this repository. That is
separate from both the local port collision and the upstream discovery error;
do not infer PR readiness from it or enable PRs as part of this recovery.

This runbook resolves issue 7's alternative acceptance criterion: an actionable
daemon/API diagnosis. Changes to hey-gh's default-port diagnostics or discovery
implementation belong in hey-gh, which is not implemented in this checkout.
