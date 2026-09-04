# Preserve smoke installation diagnostics

Release run 33894746779 failed before executing any CLI smoke commands.
The installer used npm's `--silent` flag, so even the underlying error was
suppressed. Repeating the same packed-package install without that flag
reproduced an npm E404 for the tiny-stdio-mcp-server@0.1.22 tarball.

Registry metadata dates that publication to September 4, 2026 at
16:26:54 UTC. At 16:31:10 UTC the tarball still returned HTTP 404 with
`age: 251` and `cache-control: public, max-age=300`. Metadata availability
therefore did not establish that an installation could succeed. This is
not evidence of a GitHub outage or a reason to disable smoke checks.

Replace `--silent` with `--loglevel=error` only for the consumer install.
Keep successful output captured, install lifecycles enabled, and original
installer failures propagated. Do not alter dependency ranges, bypass the
registry, or retry arbitrary lifecycle failures.

Validate with a red/green mocked installer regression, the existing smoke
tests, and an actual prebuilt packed-package smoke run. Observe registry
recovery and verify GitHub publication separately from successful checks.
