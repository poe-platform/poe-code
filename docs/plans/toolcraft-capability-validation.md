# Toolcraft invocation capability validation

Validate issue 254 through the native one-line `shell.use(toolcraftCommands(library))` registration.

1. Run the maintained workspace build and full test/lint routes. The capability regression suite uses memory filesystems and recording providers; it must pass alongside the parser/plugin suite.
2. With a rooted real filesystem under `out/issue254`, create a separate host sentinel outside that root and a symlink from the root to it. Invoke library handlers to read, write, rename and delete virtual files. Attempt symlink escape reads and writes; both must fail and the outside host sentinel must remain unchanged.
3. Check asynchronous stdin and byte sinks, streaming backpressure, cancellation cleanup and shell limits through the real plugin. Check a borrowed regex provider and its normalized execution limits; rejection must retain its reason without host regex fallback.
4. Capture and inspect a CLI help screenshot with the maintained screenshot command.
5. Commit only the changes for this issue and push main. Verify the remote commit, close the issue once remote main contains the fix, and monitor the GitHub release through successful publication.
6. Install the published release into an isolated directory under `out/issue254` and verify public imports, the one-line plugin and its capabilities. Record the commit, checks, workflow/release and installation results on issue 254 before removing generated evidence.

Native plugins support in-process CLI-visible Toolcraft handlers and stream handlers. MCP proxy discovery needs the standalone CLI; HTTP/MCP transport serving and standalone terminal interactions are outside native command execution. HandlerFs supports virtual text encodings and `w`, `wx`, `a` write flags; unsupported filesystem operations/flags fail explicitly. Binary flows use base64/hex encodings or invocation byte streams. Dry-run mutation/readback requires an explicitly supplied mock/overlay filesystem. Missing network and approval capabilities never acquire ambient host defaults. Caller-owned filesystem, service and regex provider resources remain borrowed.
