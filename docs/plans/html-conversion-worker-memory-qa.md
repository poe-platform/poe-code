# HTML conversion Worker memory qualification

## Scope and prerequisites

This is a manual QA plan, not a qualification result. The command now uses the
awaited parser event sink to write fixed-size document records into caller-backed
storage. Markdown text uses immutable balanced ropes in the same storage; code
fences, ragged-table widths and output staging no longer require whole output
strings or arrays of every table row. The cache is 256 KiB and spills via the
injected safe-fs retained descriptor in `TMPDIR`, falling back to the command
working directory. A memory backend still retains backing bytes in RAM.

Before qualification, finish the remaining input-size-dependent state: unfinished
tags/attributes and open-element names in the parser, recursive traversal
continuations in the renderer, and URL attribute validation. The existing URL
policy still materializes a destination attribute before validation. Do not
characterize the current command as fully bounded. Preserve output/error ordering,
retained file identity, cleanup and cancellation while migrating these paths;
exercise adversarial depth and attribute size without lowering accepted limits.

The separate htmlq owner is `packages/safe-bash-command-htmlq`: `command.ts`
passes injected filesystem streams to `projectHtmlq` in `behavior.ts`, which
calls `parseHtml` in `tree.ts`. That function concatenates the entire decoded
source before `parseHtmlSync`; tree ownership also retains the original source.
`selectors.ts` traverses this tree, and removal operations snapshot selections
before mutation. Migration must preserve HTML5 recovery, selector behavior and
original-source serialization. It cannot reuse the Markdown subset parser.

## Deterministic prerequisites

- Generate input from repeated/reused chunks rather than retaining fixtures
  proportional to input size. Exercise a single large input chunk too.
- Measure maximum outstanding reader/writer bytes and in-memory indexing state.
  Reject payload-wide reads and concatenation in the migrated execution path.
- Use injected safe-fs spies and explicit backing-storage counters. A memory
  filesystem is a unit-test fixture, never evidence of external spilling.
- Pause the output sink and verify input/index work stops at the documented
  bound. Inject read, write, publication, cleanup and cancellation failures;
  verify primary error identity, once-only cleanup and owned-byte behavior.
- Compare output bytes with the current compatibility corpus, including malformed
  input, Unicode entities, split UTF-8, ragged tables, long fences, adjacent
  emphasis, nested lists, selectors, removals and multi-file output.

## Execute in workerd and Cloudflare

1. Record the exact commit, workerd version, deployed Worker configuration and
   provider limits. Configure a caller-injected external safe-fs backend with
   explicit authority over the backing directory. Record backend capabilities,
   request counts, peak backing bytes and cleanup results.
2. Stream 1, 8, 32, 128 and 512 MiB documents, stopping only at actual platform
   limits. Include repeated paragraphs, one long text node, deeply nested tags,
   large attributes, a table whose final row determines width, code with a late
   longest fence, and htmlq selectors requiring later siblings/document context.
3. Drain output into an incremental byte counter/hash; do not collect it in the
   Worker or test client. Run a fast sink and a throttled sink. Record time to
   first byte, total wall time, platform CPU time and platform-reported memory
   (including peak memory where available). If a platform does not expose a
   measurement, mark it unavailable rather than inferring it from Node heap.
4. Repeat with 1, 4 and 16 concurrent requests. Record per-request correctness,
   combined memory, CPU, backend load and resource-limit failures. Distinguish
   input-size growth from concurrency and backend buffering.
5. Abort during reading, spill writes, formatting and output. Simulate backend
   failure and retained-file replacement. Verify no unauthorized file access,
   unremoved staging objects or output publication after failure.
6. Compare increasing-size results against the implementation's stated memory
   bound. Explain first-byte delays required by global formatting/error semantics.
   A Node heap-only run, a RAM spool, passing unit tests or an unexecuted plan
   does not establish Worker qualification.

Record actual measurements in the execution report only after running this plan.
Store temporary logs under `/out` and purge them after reviewing results.
