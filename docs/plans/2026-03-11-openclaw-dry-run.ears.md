# OpenClaw Configure Dry Run — EARS-Improved Plan

> **Original plan:** docs/plans/2026-03-11-openclaw-dry-run.md
> **Improved with:** EARS requirements syntax
> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Verify that `poe-code --dry-run configure openclaw --yes` completes without mutating the filesystem or invoking OpenClaw CLI commands.
**Architecture:** The `configure` command builds a payload via `buildConfigurePayload` (which resolves models, defaults, etc.) then conditionally skips mutation when `--dry-run` is set. The e2e test validates this end-to-end by running the real CLI process and asserting on exit code and absence of side effects.
**System(s) under change:** `e2e/openclaw.test.ts`

---

## Preconditions

- **P1:** `buildConfigurePayload` executes fully during dry run (resolves models, computes defaults). This is existing, tested behavior and is NOT changed by this plan.
- **P2:** `configure()` returns early when `--dry-run` is set, skipping `runOpenClawCommand` and file writes. This is existing behavior introduced in commit `97c11d6`.
- **P3:** `buildConfigurePayload` can fail if network/model resolution fails; the e2e test inherits this environmental dependency.

---

## Requirements

R1: **When** `poe-code --dry-run configure openclaw --yes` is executed, **then** the process SHALL exit with code 0.

R2: **When** `poe-code --dry-run configure openclaw --yes` is executed, **then** the OpenClaw configuration file SHALL not be modified.

R3: **An** e2e test SHALL exist that validates R1 and R2 by spawning the CLI process.

---

## Implementation

S1 (R1, R2, R3): Add dry-run e2e test case to the OpenClaw configure test suite.
  - Files: `e2e/openclaw.test.ts`
  - Action: Add a test case that spawns `poe-code --dry-run configure openclaw --yes`, asserts exit code 0, and asserts the config file remains unchanged.

CHECKPOINT: Run `npm run e2e:verbose` — all tests pass including the new dry-run test.

---

## Verification

V1 (R1, R2, R3): Run `npm run e2e:verbose` and confirm the new dry-run test passes.
  Expected: Test spawns CLI with `--dry-run`, process exits 0, OpenClaw config file is not modified.

---

## Traceability Matrix

| Req | Implementation Steps | Verification |
|-----|---------------------|-------------|
| R1  | S1                  | V1          |
| R2  | S1                  | V1          |
| R3  | S1                  | V1          |

---

## Known Gaps / Future Work

- **`--dry-run` without `--yes` (interactive mode):** Not tested by this plan. Interactive dry-run would require prompt simulation in e2e tests; deferred until interactive testing infrastructure exists.
- **`unconfigure --dry-run`:** Not covered. Out of scope for this plan.
- **Environmental flakiness:** `buildConfigurePayload` depends on network/model resolution (P3). If this becomes flaky, the e2e test may need environment stubbing in the future.
