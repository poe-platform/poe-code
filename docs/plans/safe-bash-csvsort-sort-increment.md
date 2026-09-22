# csvsort admitted-record sorting increment

Status: partial implementation; behavior-csvsort remains open.

The private `safe-bash-command-csvsort` workspace now contains an original,
synchronous sorting stage. It accepts already serialized byte payloads and
already admitted text, canonical integer and null keys. This is not a CSV
parser, inference engine, executable command or native compatibility profile.
It does not use the integration-held XAN implementation.

## Reviewed cells

- Composite ordering and global reverse semantics preserve input ties using
  iterative merge sort, including non-power-of-two record counts.
- Nulls sort last ascending and first reverse; null ties remain stable.
- Canonical signed integer strings compare exactly without JS Number,
  arbitrary BigInt arithmetic, exponent expansion or numeric inference.
- Text compares Unicode code points, including BMP/supplementary ordering.
  Ignore-case and pinned uppercase tables are not implemented.
- Output record bytes are copied. Input order and bytes are not mutated.
- Explicit record, key, logical retained-byte and algorithm/comparator work
  quotas produce structured QUOTA errors before any result is returned.
- Cancellation preserves the supplied reason, including false. There are no
  asynchronous acquisitions, VFS effects, output sinks or spill files to clean
  up in this stage. Failed invocation-owned record lists are discarded.

Review caught missing accounting for null/key/type slots. A failing exact-boundary
test and all-null slot test preceded that correction. The logical retained-byte
model accounts payloads, UTF-16 key storage, two index slots per record and
type/key slots. It does not measure engine-specific object overhead or GC.
It cannot qualify end-to-end invocation retained memory by itself.

## Verification performed

1. Before implementation, run the original edge-case tests. They fail because
   the requested sorting module does not exist.
2. Run `npm run test:unit --workspace=safe-bash-command-csvsort`: all ten tests
   pass. The independent hand-ranked signed-integer control exhausts 120
   permutations in both directions; there is no random seed or native oracle.
3. Run `npm run build:workspaces -- --workspace=safe-bash-command-csvsort --no-cache`:
   passes for the selected workspace closure and emits ESM and declarations.
4. Run `npm run lint --workspace=safe-bash-command-csvsort`: ESLint and source/test
   typechecking must pass for this increment.

Tests allocate memory only and do not invoke an LLM or native executable.
No visible CLI changed, so screenshot inspection is not applicable to this
stage. Broad repository gates, upstream native controls, performance measurements
and installed-consumer gates were not executed; focused checks do not count as
those gates.

## Open cells and integration gates

All end-to-end product acceptance cells in `safe-bash-csvsort-acceptance.md`
remain open. Sorting-stage checks alone do not qualify their CSV fixtures.
Required next increments are the admitted shared byte-stream parser/selector/
writer, typed whole-column inference (Decimal/Boolean/duration/date/datetime),
explicit temporal/locale/Unicode profiles, header and dialect preservation,
chunk ownership, cancellation during acquisition/blocked sinks, invocation
cleanup and full input/decoded/retained/output/work accounting.

The core currently requires trusted internal record objects; hostile producer
objects, shared-memory payloads and realm authority boundaries remain
unqualified. No SDK/CLI equivalence, checkpoint/replay equivalence, default
registration or safe-bash export is claimed. Composition and the bundled
`@poe-platform/safe-bash/commands/csvsort` runtime/declaration export remain open,
including installation without the unpublished workspace. No placeholder command
is registered in their place.

Local commits, verified remote-main delivery and releases: none. No private
command publication was attempted. Unrelated edits were preserved.
