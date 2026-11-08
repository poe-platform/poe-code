# Deferred YQ Executor Preparation Specification v1

Status: Accepted preparation specification; candidate execution not authorized

Implemented Through: `d77e8714e9e6a97d689045f6dd66afafd5842a2d`

Purpose: Provide the checker-compatible authoritative entry for the immutable
presealed executor protocol, without changing any behavioral requirement.

## Normative Language

MUST and MUST NOT have the meanings declared in `PROTOCOL.md`. Every normative
requirement in that file, exactly as committed at
`0f138190073cb5419aa86c63e0a10075fe67f88f`, is incorporated here by reference.
That immutable file remains the complete protocol body. This entry supersedes
only its heading as the specification-checker entry point; it adds no policy.

## Problem Statement, Goals and Non-Goals

The first checker run rejected the original H1 because it said “Protocol”
rather than “Specification”. The original bytes and failed result remain
preserved. The goal is an explicit additive metadata correction, not a silent
rewrite of an executed fixture/protocol seal or a competing behavioral spec.

## System Boundary and Configuration

The executor MUST follow the original protocol's domain model, explicit
authorization, source/import/recipe binding, scope guards, evidence boundaries,
child admission state machine, capture and reap obligations. `AUTHORIZATION.md`
documents its implemented deferred interface and pending consumer binding.
No product, private adapter, native oracle, build or typecheck is authorized.

## Failure Model and Recovery

Original nonzero/signal/timeout, receipt, integrity and reap rules remain
mandatory. A passing synthetic control does not turn its deliberately failing
child cohort into a PASS. No unsupported/source-only record becomes executable.
The original heading-check failure MUST remain in `PREPARATION-NOTES.md`.

## Test and Validation Matrix

| Scope | Evidence |
| --- | --- |
| Original specification heading | One checker failure, preserved; no behavioral defect inferred |
| Corrected entry | Run the write-spec checker on this file |
| 194 records / eight overlays | `check-static.mjs`, source-sealed inventory and references |
| Bounded child host | Fifteen presealed synthetic controls; all known children reaped |
| Product semantics and consumer integration | Pending explicit candidate and routed consumer handoffs |

## Conformance Criteria and Open Questions

Conformance is unchanged from the original protocol. This implemented-through
SHA identifies the inspected source harness used for the first 15-control run,
not a verified product candidate. Later recipe/evidence seals are recorded in
the preparation handoff. Remaining product-policy questions: none. Candidate
authorization, consumer integration and designated missing proof adapters remain
bounded execution prerequisites, not permission to broaden the task.
