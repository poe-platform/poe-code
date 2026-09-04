# Recursive Filesystem Command Admission Specification

Status: Accepted

Implemented Through: Not applicable

Purpose: Bound recursive `cp` and `ls` directory ancestry while preserving their
existing filesystem and cancellation semantics.

The depth admission below is an accepted extension under implementation for
#598; the baseline `a4149921392f273dfae8a737a82a3c2fa2577f9b` does not implement it.

## Normative Language

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` identify required, prohibited, recommended,
and permitted behavior respectively.

## 1. Problem Statement, Goals and Non-Goals

Per-directory entry admission does not bound the depth of a chain of small
directories. Recursive `cp` and `ls` must bound active directory ancestry without
mistaking two sibling aliases for an active-path cycle.

This contract covers those two command walkers, including `cp` preflight. It
does not impose a global traversal, path-byte, metadata-operation, output, RSS,
or wall-clock budget. Missing-target canonicalization, host operations, and
other recursive commands retain their independent contracts. It does not grant
preemption of uncooperative host work or transactional rollback.

## 2. Domain and Configuration

An operand directory has depth zero. Each entered child directory increases
directory depth by one. A nondirectory child does not consume an additional
directory-recursion level. Active ancestry contains the canonical directories
of the currently entered path, not every directory previously visited.

The fixed maximum directory depth is 1024. This extension adds no public option.
Per-listing admission and its existing configuration remain independent; see
the SafeFS directory-enumeration contract.

## 3. Admission and Processing

Both walkers MUST allow directory depth 1024 and MUST reject entry into a
directory at depth 1025 with `FsError.code` equal to `ELOOP`. The diagnostic MUST
identify the command and the directory depth limit of 1024. Direct files in the
last admitted directory MUST remain processable.

The walkers MUST check cancellation before applying the depth refusal and MUST
preserve the original abort reason, including falsey reasons. Existing earlier
identity, path, type and active-cycle errors retain their precedence. Admission
MUST precede the rejected directory's creation by `cp`, listing, and header
output by `ls`; metadata checks may already have occurred.

Active ancestry MUST be shared along one walk without copying all ancestor
members for every descent. Entry adds a canonical directory; exit MUST remove
it on both success and failure. A directory already in active ancestry MUST
still be rejected as a cycle. A sibling alias to a directory whose earlier
visit has finished MUST remain visitable. Separate operands and preflight or
execution walks MUST NOT leak active ancestry into one another.

The commands MUST retain their existing symlink-following policies, directory
ordering, verbose output order, and cooperative directory-read checkpoints.
Nonrecursive `ls` and nondirectory operands MUST retain existing behavior.

## 4. Failure and Recovery

Depth refusal MUST NOT roll back earlier copied files, created directories or
printed output. `cp` MUST retain its existing preflight error handling and actual
execution retry: a preflight depth refusal is not a new all-or-nothing gate.
An admitted parent listing may already name a child that subsequently fails
depth admission. Existing command diagnostics and exit statuses remain the
failure channels; no new logging channel is required.

## 5. Test and Validation Matrix

| Boundary | Required evidence |
| --- | --- |
| Ancestry cost | Small chain fixtures distinguish ancestor-member copying from active-set reuse, with restored global instrumentation and positive controls. |
| Depth | Controlled memory-only hosts cover exact directory depths 1024 and 1025 and a direct leaf file at the admitted boundary. |
| Refusal effects | No rejected-directory listing, mkdir or header; retained earlier file and output effects. |
| Identity | Real Memory filesystem fixtures retain active-cycle rejection and both sibling-alias visits. |
| Command semantics | Existing symlink modes, lexical/reverse listing order and postorder copy verbosity remain intact. |
| Cancellation | Queued cancellation and admission-boundary controls preserve exact falsey reasons without latency claims. |
| Integration | Current Shell/registry routes exercise the change; maintained discovery and public consumers remain valid. |

## 6. Conformance Criteria

Conformance requires all applicable requirements and the validation matrix.
Synthetic depth fixtures establish walker admission, not arbitrary backing-host
performance. A future aggregate traversal budget would be a separate extension.
