# safety-qpdf: candidate boundary verification

Inspected 2026-09-21 at HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, including the dirty working tree. **Safety qualification is incomplete: the candidate is absent.** No qpdf runtime boundary passes are claimed. Preserve the existing plan edits; a completion flag is not executable evidence.

## Executed prerequisite checks

The following manual Markdown QA steps were executed read-only. Parse manifests as JSON; do not infer manifest fields from text searches.

1. Record `git rev-parse HEAD` and inspect working-tree status.
2. Check existence of `packages/safe-bash-command-qpdf` and `packages/safe-bash/src/commands/qpdf/index.ts`.
3. Parse root and safe-bash manifests and `turbo.json`. Inspect the command dependency, public export, private integration mapping and workspace unit task.
4. Inspect the shared PDF package's manifest, exported source and serializer. Search its source for existing raw-object parser APIs.
5. Read the package pattern, acceptance, compatibility and command/engine prerequisite documents before choosing runtime checks.

| Check | Actual result | Classification |
| --- | --- | --- |
| Candidate identity | HEAD recorded above; unrelated edits present | Inspection completed |
| Private command workspace | Directory absent | Required prerequisite failed |
| Safe-bash composition | Entry directory absent | Required prerequisite failed |
| Public API | `./commands/qpdf` absent from parsed exports | Required prerequisite failed |
| Workspace declarations | Command absent from inspected root development dependencies, safe-bash dependencies, private-workspace mapping and Turbo unit task | Required prerequisite failed |
| Shared parser | No `parsePdf`, `parsePDF`, `PdfParser`, `PDFParser` or `rawObjects` matches in `packages/pdf/src`; index exports a layout renderer | Required raw-object API not found; name search alone does not prove parser correctness |
| Existing writer | `serialization.ts` imports pdf-lib, requires contiguous generation-zero objects, rejects Encrypt/ID and constructs Root/Info-only trailers | Cannot qualify the requested graph writer |
| Existing PDF runtime closure | pdf-lib, @pdf-lib/fontkit and pako in parsed dependencies | Cannot adopt this package as the promised zero-external-dependency engine |

The requested pattern path was deleted in pre-existing edits. The available [archived pattern](archive/safe-bash-command-package-pattern.md) requires real implementations and says “Do not create empty command scaffolds.” The implementation prerequisite is missing; this is not an approval requirement. No unsupported-only command or host executor was substituted.

## Runtime matrix to execute once a candidate exists

Use actual Shell registration of the private command factory and its SDK API, backed exclusively by memory VFS/memfs. Start code repairs with independently failing tests. Record exact candidate source/artifact identity, argv bytes, initial/final VFS identities and bytes, stdout/stderr/status, usage counters and cleanup. Independently author fixtures rather than deriving expected outputs from the candidate writer. All rows below are **UNVERIFIED**, not passes or completed skips.

| Boundary | Independent controls and required observations |
| --- | --- |
| Invocation | Execute direct Shell calls, VFS `.sh` scripts, pipelines and redirects; verify SDK equivalence and canonical byte-argv/error identity. Input `-` must fail according to native semantics; admitted output `-` must preserve bytes through `qpdf input.pdf - \| cat > copy.pdf`. Redirect failures must clean command-owned resources; Shell redirection may itself create/truncate a file before command admission. |
| Chunk ownership | Supply one-byte/unaligned/changing-size chunks, empty chunks and byte views with nonzero offsets; mutate producer buffers after delivery. Compare results against the same independent fixture; no ignored trailing bytes or shared mutable retained storage. Named input still comes from VFS, not pipeline stdin. |
| Cancellation | Abort before acquisition, during parser loops/filter expansion/range expansion/crypto rounds, between writer chunks and while an awaited sink is backpressured. Release the sink deterministically; verify prompt termination, no subsequent writes or retry, and invocation cleanup. Avoid wall-clock-only timing assertions. |
| Disposal | Inject read/write/close failures, including falsey thrown values; repeat calls and concurrent calls. Count live handles, readers, stages, reservations and invocation callbacks, and verify baseline restoration and isolation. Cleanup failure must not turn a failed write into success. |
| Quotas | Exercise each declared budget at exact boundary and boundary+1: input/retained/output/stage bytes, objects, nesting, filters/decoded bytes, pages, expanded ranges/exclusion work, selectors, attachments, crypto attempts/work and deadlines. Reject invalid/overflow budgets before allocation. `--no-default-limits` cannot lift safe-bash ceilings. Measure performance separately from semantic checks. |
| Hostile PDFs | Independent truncated/malformed syntax, bad startxref, recovery loops, incremental/free/generation entries, aliasing/cycles/dangling references, length mismatch, filter bombs, giant containers and unknown filters/objects. Preserve admitted reachable unknown graphs/raw streams; never infer lossless writing from parser success. |
| Source identity | Test literal same path, normalized aliases, symlink chains, destination aliasing source and identity changes during parsing/publication. No ordinary same-file write; explicit replace must use identity-aware conditional publication. Include same bytes in distinct files as a negative control for mistaken content-based identity. |
| Staging/publication | Exclusive bounded stage acquisition; preexisting stage/backup/split/JSON sidecar sentinels; denied permissions; destination created/replaced between preflight and publication; fail every publication step. Preserve third-party identities and sentinels, remove only invocation-owned stages, and prohibit read-then-recursive-delete. Backup collisions must fail safely. |
| Partial versus atomic | Stdout/redirect consumers may receive a prefix before failure. Named single-file publication must meet its documented complete-output contract. Split/JSON multi-file publication requires explicit transactional capability or documented partial-publication effects; preflight alone is not atomicity. Inject failure after the first successful publication. |
| Authority denial | Deny/mock host filesystem, child processes, network, dynamic imports/downloads, native/WASM execution and ambient credential access. Exercise successful and failing admitted modes, unsupported flags and encrypted inputs; denied probes must not be silently swallowed into a fallback. Explicit clock/crypto capabilities only; no production static AES IV. |
| Semantic errors | Clean/error/warning statuses 0/2/3, predicate-specific statuses, warning suppression and warning-exit-0; incompatible preflight settings produce no command-owned published output. Strict bounded selectors must not disclose the whole document for malformed/empty input. Budget/cancellation/structural errors must not trigger password recovery. |
| Original/checkpoint/replay | Map supported Shell execution variants to the candidate and verify bytes/status/VFS effects, authority and quota enforcement independently after replay. Record unsupported variants explicitly; do not assume a direct invocation qualifies replay. |
| Installed artifact/realms | Build and pack through maintained routes; import runtime and declarations without the command workspace. Assert no unpublished/external runtime specifiers and shared contract identity in every advertised Node/browser/workerd profile. Absent runtimes remain unverified. Private command package remains unpublished. |

## Compatibility mapping and gates

Retain the complete 140-option status inventory in [acceptance](safe-bash-qpdf-acceptance.md) and the pinned controls in [compatibility QA](compatibility-qpdf.md). No option is supported by this review. Pin upstream to `54d6053af283bbeb8b325f4886c0f65cc51f2b80`; the supplied native observations are research evidence, not candidate passes. Scope grammar, document/job JSON and writer/encryption/linearization cells remain distinct. Independently structurally check every accepted generated PDF; render/navigation/form/signature fidelity and actual linearization range reads require separate controls.

After implementation, run the narrowest maintained command lint/unit routes and selected workspace build closure. Integration/shared changes require `npm test`, repository-wide lint and `npm run build`; an isolated rerun cannot complete a failed broad gate. Run manual Markdown QA against the exact packed candidate. Inspect screenshots for visible CLI changes and representative PDF transformations. Store temporary evidence in `/out`, transfer reproducible seeds/minimized cases to the responsible test corpus, then purge temporary evidence.

## Delivery ledger

- **Completed:** read-only candidate/prerequisite inspection and this Markdown QA record.
- **Failed prerequisites:** missing command, composition, export and maintained membership; unsuitable existing renderer/writer for this contract.
- **Runtime passes/failures:** none executed; no candidate exists.
- **Unverified:** all resource, cancellation, cleanup, publication, hostile-input, authority, CLI/SDK, installed-artifact, realm and replay cells; all candidate upstream comparisons.
- **Not run:** lint/tests/build, screenshots and native oracle reruns. This change is documentation only; there is no qpdf workspace route to run and no code TDD cycle to claim.
- **Delivery:** no local commit, push, verified remote-main delivery, release or publication. Unrelated edits were preserved.
