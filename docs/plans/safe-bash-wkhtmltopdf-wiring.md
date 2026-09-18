# wkhtmltopdf CLI/SDK and artifact wiring

Implement the opt-in adapter in `safe-bash-command-wkhtmltopdf`, preserving its
existing parser, switch matrix, resource engine and researched source controls.
This milestone wires an explicit static renderer capability; it does not build
or qualify the missing HTML/CSS/font/paged-layout/PDF engine.

Canonical command, value, stream, output, plugin, filesystem and error contracts
live in private `safe-bash-contracts`. Existing Safe Bash paths re-export that
owner. The maintained dependency DAG is SafeFS → contracts → command → Safe
Bash. Only Safe Bash composes and exposes `/commands/wkhtmltopdf`; default
registration stays unchanged. String byte accounting is allocation-free UTF-8
and does not require a Node Buffer global.

Guarded build admission uses `poeCode.integration.privateWorkspaces` profiles,
pinned private identities/dependency closures and declarations below `dist`.
It never admits sibling source. The artifact packager rewrites qualified
private runtime and type imports to a canonical relative graph, copied inside
the Safe Bash artifact. Browser/opt-in bundles externalize this same owner
before artifact rewriting to avoid duplicated brands. Unqualified private
runtime specifiers remain errors. No command package is published.

## QA steps

1. Run command/contract unit tests and lint. Check strict UTF-8 byte argv,
   literal SDK Unicode, `--`, object scopes, stdin/stdout, VFS paths containing
   option prefixes and URL punctuation, producer reuse and cross-realm views.
2. Check source single-job 404→2/401→3, batch failure→1, missing renderer,
   unknown flags, output overflow, combined retained-byte budgets, original
   batch operands, exact-once retirement, falsey cancellation, cooperative
   VFS closure and enrolled stdout drain.
3. Run the guarded build and build-runner tests. Reject public packages,
   changed closures, source declarations and declaration symlinks.
4. Run package-safe tests, then package the current artifact under `/out`.
   Install tarballs into an isolated consumer with no private workspaces.
   Import the command subpath and strict NodeNext declarations; exercise a
   real Shell-created byte argument and compare constructor/runtime identity.
   Inspect the complete artifact graph for unpublished bare imports.
5. Capture and inspect command help/error screenshots. Run uncached broad
   workspace tests/build and repository lint because contract ownership and
   packaging infrastructure changed. Keep generated evidence under `/out`
   and purge task-owned evidence after inspection.

Compatibility limits: no qualified renderer/binary/Qt profile, no WebKit parity,
no TOC/XSLT engine, no scripts or implicit external resources. PDF staging is
bounded memory; final provider writes are cooperative and not transactional.

## Verified wiring evidence

The normal workspace build and repository lint pass. Command unit tests pass
69 cases; guarded-build tests pass 356 and package-safe tests pass 143. Installed
tarball controls pass strict NodeNext declarations, shared constructor/runtime
identity and real Shell byte arguments without installing private workspaces.
A browser bundle executes with standard web globals and no Buffer, process,
filesystem or network globals. An AST scan of 1,225 installed runtime/declaration
modules finds no bare imports of either unpublished private workspace. Help and
rejection screenshots were inspected. Renderer controls use mocked PDF bytes;
they do not qualify a rendering engine or PDF fidelity.

Broad-suite archive controls exposed a synthetic S3 fixture inheriting unrelated
private-command profiles. Its manifest now matches its synthetic source closure;
the five positive/declaration and nine drift controls pass again. The extraction
also exposed mixed contract/SafeFS graphs in subprocess test bundles and byte
counting observed by source-line instrumentation. Canonical bundle bindings and
code-point byte accounting repair these without weakening assertions; all 65
resource/closure/source-index/batch controls pass, and the refreshed artifact
passes Node, browser, strict types and the complete import scan again.
The broad `npm test` run failed; focused reruns verify the repaired failures.
Committed-HEAD qualification
remains unavailable while the reviewed build changes are uncommitted. Native
arithmetic controls also reproduce two quoted-operand failures with macOS Bash
3.2, independently of Safe Bash execution. These are not passing verification.

## Current working-tree verification

The candidate based on HEAD `052940a62255aa620236474575b4003a2df76549`
was checked without committing or publishing the existing workspace edits.
An independent admission test reproduced information-only invocations accepting
invalid resource limits. Command admission now checks all resource limits before
information output or conversion. Command tests pass 73 cases, including negative
controls for host-file, network, script and stylesheet authority; command lint and
strict source/test types pass. Contract tests pass; the maintained guarded-build
runner passes 551 controls and package-safe passes 143.

The full `npm run build` passes. The final `npm run lint` passes with zero errors
and four warnings, including root types and workflow lint. Its first run was
incomplete because the overlapping build changed directory identities; that run
is not counted as a pass.

Fresh installed tarballs pass command-subpath imports, strict NodeNext types,
real Shell byte arguments, SDK argument brands, runtime identity, cross-boundary
FsError handling and absence of default registration. Neither private workspace
is installed. An AST scan of 1,222 shipped runtime/declaration modules finds no
bare private-workspace specifiers. Browser and workerd-condition bundles execute
with aligned web byte constructors and no Buffer, process or host I/O globals.
These condition controls are not execution in an actual workerd runtime. The
initial VM harness mixed its byte constructor realm with the injected encoder;
the aligned harness passes. Help and unknown-option screenshots were inspected.

The broad `npm test` run failed with 13 test timeouts and a worker-shutdown timeout,
then aborted before the remaining workspace stages. Exact affected controls pass
in focused reruns with unchanged timeout limits; a larger DOCX rerun also failed
with six timeouts. These results suggest load sensitivity, not a validated code
defect. Focused controls include intentionally skipped unrelated cases and do not
count as a passing broad gate. No renderer, native patched-Qt profile, TOC/XSLT,
actual workerd runtime or checkpoint/replay compatibility is qualified by this
verification. Generated task evidence was kept in repository `/out` and purged
after inspection. No commit, remote-main delivery or release was performed.
