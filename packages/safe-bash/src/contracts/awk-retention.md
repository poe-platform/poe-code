# Awk Retained Text Specification

Status: Implemented

Implemented Through: `87d83aa1d3927ad42c4d5938b984554133889e6c`

Purpose: Bound invocation-owned retained awk text without changing stream or
array semantics.

This is the #597 extension, verified through the implementation commit above.
The inspected baseline `4b98f235760e98adaff331d17847cb09ab2c0487` did not
implement aggregate admission.

## Normative Language

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` specify required, prohibited, recommended,
and permitted behavior respectively.

## 1. Problem Statement

Per-value limits and a cursor-count limit do not bound the total text kept in
arrays, variable frames and unread input. An awk invocation needs one shared
retention budget with explicit ownership and release rules.

## Goals and Non-Goals

The goal is bounded retained text and faithful byte/stream semantics, not a
process-memory limit. Object overhead, parsed program/compiled-regex storage,
temporary expression or conversion storage, host producers, transport buffers,
and process RSS are outside this ledger. Their independent limits remain in
effect. Cooperative cleanup is required; opaque host work is not preempted.

## 2. Domain and Configuration

Each invocation has a fixed budget of 33,554,432 bytes (32 MiB). No new public
option is introduced. Existing `maxBufferBytes` remains the individual text or
reader-buffer limit, independent of aggregate admission. Existing step limits
and other command-family limits remain independent.

Awk byte strings represent raw bytes, not UTF-8 character counts or UTF-16 memory
estimates. String and numeric-text scalar values charge their byte-string length;
number-only and unset values contain no text payload to charge.

The charged domains are:

| Owner | Charged storage |
| --- | --- |
| Global/frame bindings | Each stored scalar's text, including defaults, initialization, assignments and function arguments. |
| Arrays | Each retained key and scalar text value, once per underlying array cell. |
| Current record/fields | Each retained record and field text slot. |
| Named input/output tracking | Each retained cursor or output-target name. |
| Main/named readers | Owned input-block capacity until its allocation is released, including consumed prefixes that still share that allocation. |

Distinct scalar slots charge separately even when they refer to equal or shared
immutable values. Passing an array by reference MUST NOT charge all its cells
again. A legal per-value size does not imply that several copies fit the aggregate.

## 3. Admission and State Transitions

The runtime MUST apply the existing per-value length check to all stored array
values and scalar bindings, including initialization and function parameters.
Aggregate admission MUST happen before retaining or copying new owned payload
and before publishing the corresponding state change. Retained byte strings
MUST preserve raw bytes and numeric-text classification.

A refused replacement MUST preserve the previous binding/cell/record state and
its accounting. Successful overwrite, deletion, array clear or replacement, and
frame retirement MUST release the text no longer owned. Frame cleanup MUST NOT
release cells in an aliased caller/global array. Invocation termination MUST
release all invocation-owned retention charges.

The runtime MUST account incrementally; a whole-state recount for each mutation
is not a conforming substitute. Counts MUST NOT become negative or be released
twice. New independent invocations MUST NOT inherit prior charges.

## 4. Input and Cleanup Semantics

Main input and named getline readers MUST use the same invocation budget. Reader
admission MUST precede copying incoming views into owned blocks. A block remains
charged while any unread bytes require it; fully consumed blocks MUST release
their charge. Unread bytes MUST survive changes between supported RS modes.

The reader MUST NOT discard suffixes, assume seekability, or reopen input to
reduce retention. EOF cursors remain at EOF until explicit close/reopen. Main
`nextfile` behavior and named-input independence MUST remain intact.

Closing a reader MUST be idempotent, close admission to late publication, and
release its owned storage even if the producer's return fails. Invocation
settlement MUST wait for every admitted cooperative reader close, not merely the
first rejection. Once cleanup settles, outcome priority is caller cancellation,
then an already-selected execution failure, then the first cleanup failure in
stable reader order. Falsey failures MUST retain their identity.

Normal completion and record-phase `exit` MUST NOT serially await terminal
reader closes when one cooperative return can depend on another starting.
The runtime MUST release terminal main-reader storage before executing `END`,
while named readers MUST remain usable by `END` with their existing positions.
Producer-return settlement MAY be deferred through `END` so terminal closes can
be joined together. Such deferral MUST observe early rejections and apply the
same cancellation, execution-failure and cleanup-failure priority. Per-file and
explicit `nextfile` transitions still close the main reader they retire.

## 5. Failure Model

Retention refusal is a ProgramError reported through the existing awk diagnostic
and status-2 channel. No new log channel is required. Earlier completed output
or filesystem effects are not rolled back. Budget admission does not imply that
an arbitrary backing producer can be interrupted or that its own allocations
are counted.

## 6. Test and Validation Matrix

| Requirement | Required evidence |
| --- | --- |
| Existing value cap | Scalar/array/ENVIRON/ARGV/function-argument contrasts at exact and over-limit values. |
| Aggregate | Small injected internal budgets plus public factory/Shell evidence for the fixed invocation policy. |
| Replacement | Refused replacement preserves state; overwrite/delete/split/clear release exactly their owned text. |
| Frames and aliases | Fresh locals retire, caller arrays remain live, nested aliases do not duplicate cell charges. |
| Record/fields | `$0`, field mutation, NF changes and numeric-text/byte identity retain coherent charges. |
| Readers | Multiple named readers and main input share admission; owned-block capacity and admission-before-copy are observable. |
| Stream semantics | RS changes, EOF, close/reopen, nextfile and nonseekable input preserve bytes and offsets. |
| Cleanup | Falsey cancellation/return failures, concurrent closes, late reads and multiple cooperative pending closes retain ownership and failure priority. |
| Normal exit and END | Main return depending on named return settles; `END` retains named cursor positions but not terminal main-buffer charges; early close rejections remain observed. |
| Integration | Maintained discovery, rebuilt public consumers and scoped adjacent command suites pass without relying on uncommitted helper APIs. |

## 7. Conformance Criteria

All applicable requirements and the validation matrix must hold for conformance.
Passing a counter test alone does not prove integration or physical memory use.
Configurable aggregate policy and broader allocation accounting would be separate
future extensions, not implied current guarantees.
