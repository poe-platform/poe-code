# Directory Enumeration Admission Specification

Status: Implemented

Implemented Through: `c01227019d07922f7770cddb8be0374c6b605c96`

Purpose: Define optional per-listing entry admission for virtual filesystems and bounded directory consumption by standard shell commands.

The recorded commit implements the optional filesystem admission API and standard
command integration described below. Implementation status does not establish
registry publication. Existing omitted-option behavior is retained explicitly;
global traversal budgets and streaming enumeration are not part of this contract.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`,
`RECOMMENDED`, `MAY`, and `OPTIONAL` are normative requirement levels as described
in RFC 2119. `Implementation-defined` means an adapter selects and documents its
policy; it does not mean callers may assume a universal policy.

## 1. Problem Statement

A directory listing can allocate and sort many entries before its consumer can
reject excessive cardinality. A returned-array check alone cannot prevent those
earlier allocations. Composed filesystems also merge names from backing layers
and synthetic mount points. Admission must occur at those collection boundaries,
with an explicit limit that composes without implying a total traversal quota.

## 2. Goals and Non-Goals

The extension gives callers a per-listing entry bound, rejects overflow instead
of silently truncating, propagates cancellation, and preserves legacy behavior
when the option is omitted. It also bounds the directory arrays consumed by
standard filesystem and `find` commands before command-owned materialization.

This is not a global byte, filesystem-call, traversal-work, wall-clock, CPU-time,
or process-memory quota. It does not preempt synchronous native work, make an
uncooperative host cancellable, isolate concurrent writers, provide snapshots,
or undo effects completed before an error. It introduces no ordering capability
or ordering guarantee beyond each existing filesystem or command contract.

## 3. Domain Model and Public Configuration

`FileSystem.readdir(path, options?)` returns an array of immediate-child
`DirectoryEntry` values. A name identifies a child within that listing; entry
types and path resolution retain their existing meanings.

`ReadDirectoryOptions` extends `FsOptions` with optional readonly
`maxEntries?: number`. The existing `signal` retains cancellation authority.

| Input | Required interpretation |
| --- | --- |
| `maxEntries` absent or `undefined` | Preserve the adapter's existing admission limits and ordering. |
| `0` | Permit an empty listing only. |
| Nonnegative safe integer `N` | Admit no more than `N` entries under the adapter profile below. |
| Negative, fractional, nonfinite, or unsafe integer | Reject with `FsError` code `EINVAL`. |

Adapters MUST validate a supplied limit before directory enumeration. An
already-aborted signal MUST take precedence over invalid-limit validation and
MUST retain the adapter's existing cancellation mapping. Local adapters and
wrapper-owned cancellation checks propagate the original reason, including falsey
reasons; S3 and WebDAV retain their existing typed `ECANCELED` errors. The
extension MUST NOT replace either profile with a universal error shape. A caller
limit MUST NOT relax a stricter existing adapter limit.

## 4. Listing Admission and Cancellation

For a supplied limit `N`, an adapter MUST reject an over-limit listing with
`FsError` code `EFBIG`; it MUST NOT return a successful truncated prefix. The
new admission error MUST identify the `readdir` operation and listing path.
Existing adapter or transport failures retain their existing operation labels,
such as `PROPFIND`; this requirement does not rename those failures. A successful
listing MUST have length at most `N`.

Adapters MUST enforce admission before growing their own directory-entry
collection beyond the limit, or reject from an available cardinality observation
before materialization. Reading the next candidate to detect overflow is allowed.
This requirement does not make an underlying operating-system read, transport
response, or third-party callback allocation entry-bounded.

For a listing with a defined `maxEntries`, adapters and wrappers MUST forward
the supplied signal and limit when delegating the requested listing. After a
delegated listing resolves, a wrapper that
copies, sorts, merges, or otherwise processes the returned array MUST check
cancellation and the returned length before that processing. Transparent
delegation without array processing MUST forward options but need not add a
separate returned-array guard. Cancellation already observed at a guarded
boundary MUST take precedence over the returned-array overflow check. Existing
cooperative cancellation boundaries remain in force; this specification does
not require general preemption.

Omitted limits MUST retain existing delegation and cancellation behavior.
In particular, an uncapped readonly view MUST delegate pre-aborted calls with
their original options and preserve the backend's success or failure rather
than introduce a new post-return cancellation check.

For host/view combinations supported by their existing construction contracts,
readonly and quota views MUST preserve listing admission when delegating. This
does not establish that every arbitrary wrapper composition is constructible.
A custom filesystem is a trust boundary: it can allocate an oversized array or
ignore options before returning. Defensive length checks MUST reject such an
oversized result before further wrapper-owned materialization, but MUST NOT be
described as prevention of the custom host's earlier allocations or work.

## 5. Composed and Remote Filesystem Profiles

### Mount composition

A mount view MUST count unique immediate-child names in its merged result,
including synthetic mount children. Replacing a backing entry with the same
synthetic mount name MUST NOT consume a second merged-entry slot. Multiple deeper
mounts sharing one immediate ancestor MUST count as one child. Delegated backing
listings remain independently subject to the caller's limit and defensive
returned-length checks; deduplication does not waive those checks.

### Overlay composition

An overlay MUST apply `N` independently to each delegated participating layer.
It MUST also cap its distinct merged candidate names at `N` before visibility
resolution. Duplicate names across layers count once in that candidate set.
Names subsequently hidden by whiteouts or other visibility rules MAY still
consume candidate slots. Consequently, an overlay MAY conservatively reject
with `EFBIG` even when the eventual visible listing would contain at most `N`
entries. This is intentional admission behavior, not truncation.

The per-layer limits are not a combined work allowance of `N`: the overlay may
read multiple bounded layers and perform further metadata and visibility checks.
No total-operation or total-layer-allocation limit follows from this profile.

### Remote listings

Remote adapters MUST apply `N` to their admitted immediate-child listing across
pages, rather than restart the accumulated listing allowance on each page.
Where an adapter's existing protocol permits repeated observations, observations
that resolve to one child MUST NOT consume additional output-entry slots. This
does not legalize duplicates rejected by the protocol: WebDAV retains its
duplicate-href `EIO` behavior. Existing pagination and provider error behavior
remains in force; reaching a provider's independent limit may fail even below `N`.

Response bytes, page materialization, XML parsing, and other transport structures
are separate boundaries. Built-in remote HTTP transports and parsers MUST
preserve their independent response and parsing bounds; a custom injected
transport remains a host trust boundary. `maxEntries` MUST NOT be represented as a bound
on XML nodes, page bytes, transport buffers, or all remote work. A page may be
parsed before enough distinct immediate children are known to detect overflow.

## 6. Standard Shell Command Integration

`StandardCommandsOptions`, `AgentCommandsOptions`, and
`BrowserCommandsOptions` expose optional readonly `maxDirectoryEntries?: number`,
defaulting to `10000`. Zero is valid; other values MUST be nonnegative safe
integers. Invalid command configuration MUST raise `RangeError` during command
factory creation or plugin initialization, before command execution. Existing
no-argument factory and plugin calls MUST remain valid.

These factories and plugins MUST forward the configured limit to directory
reads used by `ls`, recursive `cp` preflight and execution, and directory-removal
admission fallback. Standard and agent command sets MUST also forward it to
`find` traversal and directory `-empty` evaluation. This does not add `find` to
the browser command set or govern every other command family.

Covered consumers MUST check cancellation before calling the filesystem and
after it returns, then reject oversized results before their own mapping,
copying, sorting, or traversal. They MUST retain a cooperative checkpoint before
processing admitted results and during long ordering scans, using existing shell
CPU-checkpoint and cancellation semantics. No new global budget is introduced.
At the shell context boundary an aborted command signal MUST remain primary,
with its original reason including falsey values, even when a remote adapter
reports cancellation through its typed error profile.

Commands MUST preserve their existing lexical order for unordered hosts and
SHOULD avoid sorting a listing already ordered by the command's exact comparator.
Consumers MUST NOT mutate an adapter-owned array merely to normalize order.
The `.` and `..` entries generated by `ls -a` are outside the backend-entry cap
and MUST appear in the existing command order, including reverse order.

The limit applies independently to each read, not cumulatively to a recursion,
operand list, or command invocation. Existing preflight retries and partial
effects MUST remain observable. An earlier copied file, created target directory,
printed header, or visited `find` entry is not rolled back when a later listing
fails. A listing overflow MUST NOT be reclassified as evidence that a directory
is empty or nonempty.

## 7. Failure Model and Recovery

`EINVAL` indicates invalid filesystem configuration; callers must correct the
value rather than retry unchanged. `EFBIG` indicates admission refusal; callers
may choose a larger valid limit or reduce the listing, subject to independent
adapter constraints. Retrying is not guaranteed to succeed or observe the same
directory. Cancellation preserves the adapter-specific mapping and shell-context
priority defined above. Existing path,
permission, unsupported-operation, transport, and provider failures remain
possible; admission does not manufacture support for a missing primitive.

No new logging channel is required. Existing filesystem errors and shell status
and diagnostics are the observable failure channels. A consumer MUST NOT report
an overflowed listing as complete or suppress its error to satisfy the cap.

## 8. Test and Validation Matrix

| Boundary | Required evidence |
| --- | --- |
| Options | Omission, zero, exact limit, overflow, invalid values, and cancellation before validation. |
| Local enumeration | Bounded in-memory fixtures prove rejection before owned materialization, correct exact-limit output, and enumeration resource cleanup. |
| Delegation | Controlled backing hosts prove signal/limit forwarding and abort-before-length-check behavior for defined limits, including falsey reasons; omitted-limit readonly calls retain legacy delegation and backend outcomes. |
| Mount | Unique backing and synthetic names, shared ancestor names, and overflow after merge. |
| Overlay | Duplicate layer names, per-layer overflow, candidate-union overflow, and conservative rejection with hidden names. |
| Remote | Across-page admission, duplicate names, exact boundaries, and preservation of independent response/parser limits. |
| Shell routes | Standard, agent, and browser factories/plugins forward explicit values and defaults; public consumer types accept the options. |
| Command behavior | `ls`, recursive `cp`, removal fallback, and both `find` listing paths enforce admission while preserving order and earlier effects. |
| Cooperative work | Instrumented registered checkpoints and real queued cancellation prove checkpoint participation without latency or RSS claims. |
| Observers | Any global test instrumentation has a positive control and restores the original method after the fixture. |

Tests SHOULD use small, bounded in-memory fixtures. A passing after-return guard
test alone is not evidence of backing-adapter allocation admission. Integration
evidence MUST exercise the current adapter implementation and public type route,
not an older generated bundle.

## 9. Conformance Criteria

Extension conformance requires all applicable `MUST` and `MUST NOT` requirements,
the validation matrix for each claimed adapter and command profile, and explicit
documentation of implementation-defined policies and trust boundaries. A
conforming implementation MUST distinguish the per-listing guarantee from
independent transport limits and from unbounded total traversal work.

The implemented-through record identifies the implementation verified against
these profiles. Global traversal budgets and streaming enumeration remain
separate possible extensions, not implied requirements of this contract.
