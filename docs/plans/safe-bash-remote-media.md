# SafeBash remote media release

Status: implementation under release review.

Provide opt-in FFmpeg, ffprobe and ImageMagick commands through SafeBash,
with the same explicit configuration in the SDK and CLI. Keep portable media
parsers and streaming execution in media-cli; keep the generic protocol,
server and provider declarations in remote-execution. Imports remain inert.

The shell adapter preserves byte argv, environment, cwd, streams, redirections,
process signals, admitted descriptors, exit status and cooperative cleanup.
Remote execution requires an explicitly authenticated service and qualified
host bindings. No local native fallback or automatic file transfer is enabled.

Release work:

1. Finish portable and Node-only export checks, strict declarations and actual
   packed consumers for standalone workspaces and poe-code.
2. Assemble production bootstrap dependencies from maintained declarations;
   qualify the available local native image and service paths.
3. Finish approved package READMEs and remove copied planning reviews from
   runtime schema assets. Preserve required schemas, native oracle data and
   generator inputs with their owning packages.
4. Pass the maintained uncached build, workspace test, lint, package and
   workflow checks; inspect the CLI help screenshot.
5. Commit atomic owned changes on main, verify remote-main delivery, and
   monitor GitHub publication through successful release.

The user declined Cloudflare and Modal deployment setup. Those deployments
will not be provisioned or represented as qualified. Injected filesystem and
isolation interfaces do not establish a stock canonical native backend.
Report available native evidence and these limits in the package documentation.

Local QA:

- Install actual packed workspaces and poe-code in isolated consumers. Import
  public Node APIs, compile strict Node and browser/workerd declarations, bundle
  portable consumers without source aliases, and check server export barriers.
- Build the pinned Dockerfile's service target from emitted package outputs.
  Verify server imports and refusal to start without an explicit operator module.
- Run the disposable native media cases with read-only storage, no network,
  bounded resources and a scratch tmpfs. Check PCM bytes, independent output
  descriptors, retained partial ImageMagick writes and non-UTF8 filenames.
- Run generic remote execution container cases and inspect authenticated HTTPS
  jobs, original argv bytes, stream retirement, signals and cooperative shutdown.
- Capture and inspect `poe-code bash --help` with the maintained screenshot route.
  Report these local observations separately from cloud or canonical live-file
  qualification; unavailable deployments do not count as passing checks.
