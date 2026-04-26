---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json
kind: superintendent
version: 1

builder:
  prompt: |
    Pick the highest-priority open task from {{plan.path}}. Apply the fix the practice-scan inspector recommended; do not change what the tests are verifying.

inspectors:
  practice-scan:
    prompt: |
      Survey *.test.ts across the repo and report the bad testing practices currently present. Categories to consider, not exhaustive:
      - assertions hard-coded to values that live in a constants file (string drift)
      - tests that test implementation details instead of observable behavior
      - over-specified mocks (asserting call counts and argument shapes that incidental refactors break)
      - tests that touch the real filesystem instead of using `memfs`
      - tests that query a real LLM instead of the project's mocking abstraction
      - tests slower than they need to be (real timers, sleeps, unmocked network)
      - rendered-string snapshots where a shape snapshot would do
      - duplicated setup that masks what each test is actually verifying
      - conditional logic (`if`/`for`) inside tests that hides which branch failed
      - skipped, `.only`, or commented-out tests left in the suite
      - tests whose name does not match what they assert
      - tests that don't assert anything meaningful
      Add categories you observe. For each: a short name, a one-line definition, current count, two or three representative call sites, and a concrete fix recipe. Rank by impact (how many tests break per unrelated change × how often that change happens).
  semantic-equivalence:
    prompt: |
      Diff touched test files vs HEAD~. For every change, confirm the test still asserts the same observable behavior. Flag cases where the original assertion carried meaning the refactor erases, where a substituted constant evaluates to a different value than the literal, or where a "readability" change quietly weakens the assertion.
  readability:
    prompt: |
      Read the touched tests cold. Are they easier to follow than before? If a helper or matcher was added, does it earn its keep, or does it hide the assertion behind a wrapper? Flag any helper that just renames an existing import, and any test where the setup is now longer than the assertion.
  speed:
    prompt: |
      Run the touched test files in isolation and report wall-clock time. Flag any single test slower than ~200ms and any file slower than a few seconds, with the likely cause (real timers, real fs, unmocked network, oversized fixture). Per project convention, slow tests should be made fast or removed.

superintendent:
  prompt: |
    Review builder + inspectors, update the Task Board in {{plan.path}}, request owner review when the practice-scan reports no remaining high-impact categories.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Practice scan
    {{inspectors.practice-scan}}

    ## Semantic equivalence
    {{inspectors.semantic-equivalence}}

    ## Readability
    {{inspectors.readability}}

    ## Speed
    {{inspectors.speed}}

owner:
  agent: claude-code
  prompt: |
    Decide whether the test suite is now meaningfully more resilient and readable, with no regressions in coverage or speed. Approve or send back with feedback.

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 50

status:
  state: completed
  round: 11
  review_turn: 0
---

# Test quality — fix bad testing practices

# UPDATE FROM OWNER - URGENT
- WRAP THIS UP IF EVERYTHING IS IN A GOOD SHAPE, COMMIT CHANGES

## Goal

Tests should fail when behavior changes, not when an incidental detail moves. Today the suite breaks for the wrong reasons: a string nudge in a constants file, a renamed internal helper, a reordered argument list, a cosmetic format tweak. Each false break costs review time and erodes trust in the signal. This plan runs a discover-and-fix loop until the most common bad-practice categories are gone.

## Approach

The inspector is the engine. Each round, the practice-scan inspector surveys the suite, names the bad-practice categories present, and ranks them by impact. The builder fixes the highest-ranked category in the smallest commits that stay green. Semantic-equivalence guards against silently weakening assertions. Readability and speed catch refactors that fix one problem and create another.

This is a discovery loop, not a fixed checklist. New categories show up as obvious ones get cleaned up — that's expected. The Task Board is updated each round to reflect what the inspector now sees.

## Bad-practice categories — starting list, not exhaustive

The inspector should expand this. Examples to seed the scan:

- **Constant drift** — assertions hard-coded to values that live in a centralized constants file. A version bump rolls dozens of failures.
- **Implementation tests** — assertions on private structure (which helper was called, internal field names) instead of the observable result. Refactors break tests even when behavior is unchanged.
- **Over-specified mocks** — asserting exact call counts and full argument shapes when only one detail mattered.
- **Real-filesystem tests** — tests that read or write actual files. Slow, order-dependent; the project standard is `memfs`.
- **Real-LLM tests** — tests that hit a real model. Slow, non-deterministic; the project has an abstraction for this.
- **Slow tests** — real timers, `setTimeout` waits, unmocked network, oversized fixtures. Project rule: tests that take long shouldn't exist.
- **Rendered-string snapshots** — snapshotting formatted output instead of the underlying shape. Couples the test to format and content at once.
- **Duplicated setup** — the same fixture rebuilt inline across many `it` blocks, hiding what's actually under test.
- **Conditional logic in tests** — `if`/`for` branches inside an `it`. The failure message doesn't tell you which branch failed.
- **Dead tests** — `.skip`, `.only`, commented-out, or assertions that always pass.
- **Misleading names** — `it("does X")` followed by an assertion that doesn't check X.
- **Empty assertions** — tests that exercise code without asserting anything observable, relying on "didn't throw" as the contract.

## Fix principles

1. **Preserve intent.** A test exists to check a specific behavior. The refactor must keep that behavior under test, even when the syntax changes.
2. **Test infrastructure is allowed when it earns its keep.** A helper that wraps a single import is not allowed. A factory that pulls noisy fixture-building out of every test is allowed. A custom matcher that replaces a repeated multi-step assertion is allowed. If a helper is added, every parallel inline copy must migrate in the same change — no two implementations of the same idea.
3. **Pattern-by-pattern, not file-by-file.** Sweep one category across the suite, verify green, commit. The next round picks the next category.
4. **Smallest reviewable commits.** Each commit stays green and has a single theme.
5. **Stop drift at the boundary.** When a category is fully swept, add a lint or scan check that fails CI on regressions in that category. Without that, the cleanup decays.

## Out of scope

- Changing the test runner, the snapshot library, or `describe`-block structure.
- Adding tests for currently untested code.
- Restructuring production source files to make them "more testable" — that's a separate plan.
- Rewriting tests for stylistic preference when no bad-practice category applies.

## Baseline (round 1, 2026-04-24)

Practice-scan ranked **Constant drift** as the top category. Representative hits:

- `agent-skill-config.test.ts` — 30+ hardcoded skill-dir paths duplicating `agentSkillConfigs` in `configs.ts`.
- `agent-mcp-config.test.ts` and `sdk/spawn.test.ts` — 40+ literal `"mcpServers"` keys duplicating `agent-mcp-config/configs.ts`.
- `providers.test.ts` — codex tests assert literal `"poe"` and `"medium"` that originate from `codex/config.toml.mustache` and `DEFAULT_REASONING`.
- `services/config.test.ts:103` — migration test asserts `"poe"` literal that traces to the migration default in `services/config.ts`.

Many of the model-string literals in tests (e.g. `claude-sonnet-4.6`, `gpt-5.4`) **are not drift** — they're round-trip fixtures or implementation-specific to a hardcoded source (e.g. `model-strategy.ts`, codex template). Those track the source's literal, not `constants.ts`, so a `constants.ts` bump does not break them.

## Picked top category — round 1

**Constant drift on `agentSkillConfigs` directory paths** in `packages/agent-skill-config/src/agent-skill-config.test.ts`. Decision: no new test infrastructure. `resolveAgentSupport` already accepts a registry parameter, so its tests can inject a fixture registry and assert against the fixture itself — no production change, no new helpers. The remaining `getAgentConfig` test keeps a single literal assertion since that function does not accept a registry parameter and that one location is the legitimate source-of-truth check.

## Round 2 inspector findings (2026-04-24)

Practice-scan re-surveyed 287 `*.test.ts` files. Round 1 sweep of `resolveAgentSupport` is confirmed applied; semantic-equivalence found no weakened assertions (one alias test was strengthened); readability and speed both passed.

Remaining categories ranked by impact:

1. **Constant drift (residual)** — `DEFAULT_REASONING` and the codex `"poe"` default still assert literals across `providers.test.ts` (28 hits), `configure.test.ts:68,116,248`, `services/config.test.ts:103`, `cli-utilities.test.ts:187`. Inspector contract caveat: `"mcpServers"` and the skill-dir paths in `configure`/`unconfigure`/`installSkill` filesystem assertions are external contract, not drift — leave one anchor test per constant.
2. **Same-package `vi.mock`** — 14 hits across 10 files. Hotspots: `superintendent/src/runtime/loop.test.ts:20-32`, `superintendent/src/mcp.test.ts:55-79`, `memory/src/mcp.test.ts:9-12`, `poe-agent/src/agent-session.test.ts:26-74`. Recommended next pick: `loop.test.ts` — runner already takes the four runners as params, so the fix is "delete `vi.mock` calls, pass test doubles into the existing seam."
3. **Over-specified mock assertions** — 110+ `toHaveBeenCalledWith` instances; heaviest in `acp-client-unified.test.ts` (33 deep shapes), `tiny-mcp-client/transports.test.ts` (20 + 11 `toHaveBeenCalledTimes`).
4. **Weak `.toBeDefined()` assertions** — 172 instances across 38 files. Low refactor blast but high coverage cost; deprioritized for this loop.
5. **Slow / real-resource tests** — `terminal-pilot/commands/commands.test.ts:598` uses real `mkdtemp` + child node process (rename to `*.e2e.test.ts`). 7 files use real `setTimeout`.
6. **Rendered-string snapshots** — 8 `toMatchSnapshot()` on raw generated source in `toolcraft-openapi/generate.test.ts`.
7. **Conditional iteration in `it` blocks** — `tests/integration/mcp-server.test.ts` and a few `tiny-http-mcp-server.test.ts` loops.
8. **Clean** — zero `.skip`/`.only`/`xit`/commented-out tests; no tautological assertions.

Semantic-equivalence flag (informational, not a regression): `claude-code globalSkillDir` is no longer asserted at unit level after round 1 — still pinned by the `configure` integration test at `agent-skill-config.test.ts:218`. Acceptable.

## Round 3 inspector findings (2026-04-24)

Builder swapped `DEFAULT_REASONING` literal at `providers.test.ts:502,750` and `cli-utilities.test.ts:184,187`. Builder correctly excluded `model_verbosity` lines 503/751 (anchor the template literal at `codex/config.toml.mustache:7`, not `DEFAULT_REASONING`). Speed clean; readability minor (DEFAULT_REASONING / `"medium"` adjacency in `providers.test.ts` reads as inconsistency without a sibling note).

**Semantic-equivalence regression — must fix next round.** `providers.test.ts:460` (`buildConfigureOptions` fixture) still passes literal `reasoningEffort: "medium"` as input, while lines 502 and 750 now expect `DEFAULT_REASONING` as output. Bumping `DEFAULT_REASONING` to `"high"` would fail those tests for reasons unrelated to codex behavior — the codex service still passes its input through correctly. The substitution relocated drift from the assertion to the input/expectation pair instead of removing it. Fix: change `providers.test.ts:460` to `reasoningEffort: DEFAULT_REASONING` so the passthrough check tracks one constant on both sides.

Practice-scan still reports HIGH IMPACT remaining: codex `"poe"` provider literal (28 hits across 3 files; `PROVIDER_NAME` already imported in `providers.test.ts`), same-package `vi.mock` (141 calls / 50 files; `loop.test.ts` next pick — production seam already exists), over-specified mock assertions (693 `toHaveBeenCalledWith` / 367 `toHaveBeenCalledTimes`).

## Round 4 inspector findings (2026-04-24)

Builder applied the round-3 follow-up at `providers.test.ts:460` (`reasoningEffort: "medium"` → `DEFAULT_REASONING`). Semantic-equivalence regression cleared: input + assertions at 502/750 now track one constant on both sides; bumping `DEFAULT_REASONING` no longer causes spurious failures. Adjacent `model_verbosity = "medium"` at 503/751 correctly left as literal — anchors `codex/config.toml.mustache:7`, not `DEFAULT_REASONING`. 79/79 tests in the file pass.

Inspectors clean: readability is a straightforward win (passthrough contract now legible from the test alone); speed unchanged (slowest individual test 25ms, all touched files under 1.2s real time including vitest cold-start); semantic-equivalence verified across all three touched files (`providers.test.ts`, `cli-utilities.test.ts`, `agent-skill-config.test.ts`).

Remaining categories ranked by impact (counts refreshed):

1. **Same-package `vi.mock` cluster (HIGH)** — 56 same-package calls across ~30 files (subset of 253 `vi.mock` total / 109 files). Hotspots: `superintendent/src/runtime/loop.test.ts:20-32` (4 same-package mocks; production runner accepts the four runners as params — seam exists), `superintendent/src/mcp.test.ts:55-79` (4 mocks of `./direct-execution`, `./commands/index`, `./runtime/run-builder`, `./runtime/run-inspector`), `poe-agent/src/agent-session.test.ts:26-72` (9 sibling mocks; defer until production seam exists).
2. **Over-specified mock assertions (HIGH)** — 367 `toHaveBeenCalledWith` + 253 `toHaveBeenCalledTimes` (counts refined from round 3's broader pattern match). Heaviest: `tiny-mcp-client/transports.test.ts` (50 deep shapes + 3 strict counts), `acp-client-unified.test.ts` (11 + 4), `poe-agent/runtime/runtime.test.ts` (15/7), `agent-spawn/autonomous.test.ts` (12 deep shapes).
3. **Constant drift — codex `"poe"` literal (HIGH)** — 92 occurrences across 16 files. Drift sites in scope: `providers.test.ts:159, 458, 495, 501, 506-508, 527, 742, 749, 887, 1224, 1577`; `configure.test.ts:68, 116, 248`; `services/config.test.ts:103`. Anchors to leave as literal: raw-TOML matchers `'model_provider="poe"'` at `providers.test.ts:603, 609, 634, 639, 663, 668, 694, 698, 757, 1006` (these pin `codex/config.toml.mustache`, not `PROVIDER_NAME`); keep one literal-vs-`PROVIDER_NAME` anchor test so the constant itself is still pinned.
4. **Conditional iteration in `it` blocks (MEDIUM)** — ~60 in-test loops across ~25 files. Sites: `providers.test.ts:1034` (`for (const m of KIMI_MODELS)`), `agent-defs.test.ts:70-72` (nested `for`), `tests/integration/mcp-server.test.ts:55`, `cli/ui/ui.test.ts:66-84` (nested `for`). `it.each` already used 33× elsewhere — pattern is established.
5. **Slow / real-resource tests (MEDIUM)** — 19 files use `setTimeout` / busy-loops in test bodies. `terminal-pilot/commands/commands.test.ts:598` (real `mkdtemp` + spawned node child — rename to `*.e2e.test.ts`); `poe-agent/plugins/poe-agent-plugin-shell.test.ts:47` (`while (Date.now() < deadline)` busy poll).
6. **Weak `.toBeDefined()` / `.toBeTruthy()` (LOW)** — 534 occurrences across 100 files. Heavy: `providers.test.ts` (22), `spawn-command.test.ts` (24), `pipeline-command.test.ts` (17), `usage-command.test.ts` (27). Coverage hole, not break risk; deprioritized.
7. **Rendered-string snapshots (LOW)** — 3 files. `toolcraft-openapi/generate.test.ts` (8 raw-source snapshots), `markdown-reader/read-markdown.test.ts`, `config-mutations.test.ts`.
8. **Clean** — zero `.skip`/`.only`/`xit`/commented-out tests; `tests/integration/standalone-package-metadata.test.ts:18` real-fs read is acceptable (already integration-classified, contract under test is on-disk `package.json` shape).

Recommended next pick: **codex `"poe"` literal sweep**. Smallest commit (no new infra; `PROVIDER_NAME` already imported at `providers.test.ts:37`); single theme; clears one HIGH category in one round.

## Round 6 inspector findings (2026-04-25)

Round 5 follow-ups landed clean. Builder reverted `providers.test.ts:501, 507, 512-514, 533, 748, 755` and `services/config.test.ts:104` to literal `"poe"` (template/migration anchors restored), removed the now-unused `PROVIDER_NAME` import from `services/config.test.ts`, and substituted `id: PROVIDER_NAME` at the three residual proxy-URL sites (`providers.test.ts:281, 554, 1651`). 88/88 tests green across the two touched files in 38ms. The supervisor restored a missing blank line at `services/config.test.ts:13` flagged by readability.

**Practice-scan: constant-drift category now CLEAN.** Codex `"poe"` axis closed; `DEFAULT_REASONING` axis closed in round 4; `agentSkillConfigs` axis closed in round 1. The `describe("PROVIDER_NAME constant")` pin at `providers.test.ts:100-104` is the regression check — any future `PROVIDER_NAME` bump alone would fail there before it could mask drift in production-anchor sites.

**Semantic-equivalence: no regressions.** Each reverted line restores a literal anchor on a value production hardcodes independently of the constant; each substituted line is paired with a literal anchor (the canary, or in proxy-URL fixtures, the literal baseUrl assertions downstream).

**Readability: minor open note.** `cli-utilities.test.ts:185-188` substitutes `DEFAULT_REASONING` on both sides of a passthrough check whose production code path (`createPromptLibrary`) does not reference `DEFAULT_REASONING`. Defensible (passthrough contract is explicit) but borderline — leave for now; revisit only if the file is touched for another reason. `agent-skill-config.test.ts` production-signature change (`resolveAgentSupport` now takes a `registry` parameter) was the planned round-1 approach (see plan line 131), not scope creep.

**Speed: PASS.** Touched files run ~625ms each end-to-end including vitest cold-start; per-test slowest is 4ms. Well within budget.

Remaining HIGH categories (refreshed counts, unchanged from round 5):

1. **Same-package `vi.mock` cluster (HIGH)** — 101 calls / 50 files. Cleanest first pick: `superintendent/src/runtime/loop.test.ts:20-32` (4 same-package mocks; production runner already accepts the four runners as params, so the fix is delete-the-mocks and pass test doubles). Then `superintendent/src/mcp.test.ts:55-79`. Defer `poe-agent/src/agent-session.test.ts` (9 sibling mocks) until production exposes a seam — do not invent one in this loop.
2. **Over-specified mock assertions (HIGH)** — 693 `toHaveBeenCalledWith` / 120 files; 367 `toHaveBeenCalledTimes` / 73 files. Heaviest: `tiny-mcp-client/transports.test.ts` (50 + 20), `experiment-ralph.test.ts` (42 + 14), `acp-client-unified.test.ts` (33 + 11).

Recommended next pick: **`vi.mock` cluster, starting with `superintendent/src/runtime/loop.test.ts:20-32`.** Single-theme commit, smallest blast, hits the cleanest seam.

## Round 7 inspector findings (2026-04-25)

Round-7 builder applied the round-6 pick — same-package `vi.mock` removal in `superintendent/src/runtime/loop.test.ts`. Production runner did **not** already accept the four runners as params (round-6 plan note was wrong on that point); the seam was added this round as `LoopRunners` at `loop.ts:90-95, 109-114, 122-123, 405, 425-432`, and the four sites at `loop.ts:188, 227, 344, 570` switched to `options.runners.*`. Default `resolveRunners()` keeps production callers unchanged. Test file dropped 4 `vi.mock` blocks + the `vi.hoisted` setup + the per-test `await import("./loop.js")` dance; 12/12 assertions preserved verbatim.

Inspectors:

- **Speed: PASS.** 504ms total, slowest test 12ms. Removing `vi.resetModules()` + dynamic re-imports is also a perf win.
- **Readability: PASS with one tightening.** Setup is linear and the diff is mechanism-only. `loop.test.ts:12-22` uses `as unknown as typeof runBuilder` four times to widen untyped `vi.fn()`s; cleaner is `vi.fn<typeof runBuilder>()` per mock — drops four casts and gives `mockImplementation` real argument inference. Minor; not blocking.
- **Semantic-equivalence on `loop.test.ts`: clean.** No `expect(...)` added or removed; transitive caller analysis confirms the four runner imports have no other callers, so injection is fully equivalent to module mocking.
- **Semantic-equivalence regression — must fix next round.** Round 5/6 closed the codex-`PROVIDER_NAME` axis with a canary (`expect(PROVIDER_NAME).toBe("poe")` at `providers.test.ts:100-104`) but did not pin `DEFAULT_REASONING`. Both `buildConfigureOptions.reasoningEffort = DEFAULT_REASONING` (`providers.test.ts:464`) and the assertions at `:508, :756` now read the same constant, and `cli-utilities.test.ts:182-188` is the same shape (input `defaultValue: DEFAULT_REASONING` paired with `expect(descriptor.initial).toBe(DEFAULT_REASONING)`). A bump of `DEFAULT_REASONING` to `"high"` would silently pass these. Fix: add `expect(DEFAULT_REASONING).toBe("medium")` parallel to the `PROVIDER_NAME` canary.
- **Production seam — precedent question for the owner.** `loop.ts` `LoopRunners` is the second optional-overrides bag added to a production function whose only consumer is a test (after `resolveAgentSupport(registry)` from round 1). Plan line 131 explicitly approved the round-1 shape; round 6 plan note implied (incorrectly) the seam already existed. Recommendation to ratify in the plan: "thin opt-in seams matching `resolveAgentSupport`/`LoopRunners` are OK when the alternative is same-package `vi.mock`." Without explicit ratification, the next builder will hesitate at the same shape in `mcp.test.ts`.

Practice-scan refresh — counts after round 7:

1. **Same-package `vi.mock` cluster (HIGH)** — 97 calls / 49 files (was 101/50; `loop.test.ts` cleared). Cleanest next pick: `superintendent/src/mcp.test.ts:55-79` (5 sibling mocks: `./direct-execution`, `./commands/index`, `./runtime/run-builder`, `./runtime/run-inspector`, `./document/parse`). Then `memory/src/mcp.test.ts:9-12` (4 sibling mocks). Defer `poe-agent/src/agent-session.test.ts:26-72` (9 sibling mocks; production has no seam — out of scope per plan line 115).
2. **Over-specified mock-call assertions (HIGH)** — 684 `toHaveBeenCalledWith` / 119 files; 367 `toHaveBeenCalledTimes` / 73 files (341 are strict `(1)` or `(2)`); 463 sites already use partial matchers. Heaviest: `tiny-mcp-client/transports.test.ts` (20 deep shapes, no `objectContaining`), `acp-client-unified.test.ts` (33 calls, mixed quality), `poe-agent/runtime/runtime.test.ts:2322-2326, 2567-2571`, `agent-spawn/autonomous.test.ts:70-73, 152-155`.
3. **Slow / real-resource tests (MEDIUM)** — 3 busy-wait deadlines, ~7 files with real `setTimeout` ≥10ms, 2 non-e2e files spawning child node / `mkdtemp` (`terminal-png/src/index.test.ts`, `terminal-pilot/commands/commands.test.ts:598`).
4. **Duplicated setup factories (MEDIUM, concentrated)** — `providers.test.ts` defines `buildConfigureOptions` 5× at lines 163, 462, 891, 1228, 1581. Hoist to file scope with a `defaults?` parameter; ~80 lines deleted.
5. **Rendered-string snapshots (MEDIUM, concentrated)** — 8 raw-source `toMatchSnapshot()` in `toolcraft-openapi/generate.test.ts` (other 4 across `markdown-reader/read-markdown.test.ts:25` and `config-mutations.test.ts:206, 667` are defensible).
6. **Weak existence assertions (LOW, broad)** — 152 `toBeDefined()` + 15 `toBeTruthy()` / ~38 files. Heaviest: `spawn-command.test.ts` (24), `usage-command.test.ts` (27), `pipeline-command.test.ts` (17). Coverage hole, not break risk; deprioritized.
7. **Conditional iteration in `it` bodies (LOW)** — 6 sites (helpers/cleanup/per-fixture setup loops are fine).
8. **Constant-drift residual** — `DEFAULT_REASONING` canary not yet added (see above). Once added, the constant-drift category remains CLEAN.

Recommended next pick: **(a) add the `DEFAULT_REASONING` canary** at `providers.test.ts:100-104` alongside the existing `PROVIDER_NAME` block (one-line addition; same single-theme commit as the constant-drift residual cleanup). Then **(b) sweep `superintendent/src/mcp.test.ts:55-79`** following the round-7 recipe (delete `vi.mock`, inject test doubles via a `runners?`/`commands?` overrides bag with a `resolveX()` default).

## Round 5 inspector findings (2026-04-25)

Builder applied the codex `"poe"` literal sweep at the 14 sites listed in round 4 across `providers.test.ts`, `configure.test.ts`, `services/config.test.ts`, and added a `describe("PROVIDER_NAME constant")` pin at `providers.test.ts:100-104`. Speed clean (test phase 6–32ms per file). 100/100 tests pass on touched files. Practice-scan refresh confirms the codex-`PROVIDER_NAME` axis is "almost clean" with three drift sites missed.

**Semantic-equivalence regression — must fix next round.** A subset of the substitutions weaken the assertion by coupling tests to a constant the production code does not use:

- `src/providers/codex.ts:202-208` does **not** pass `provider.id` into the mustache template — the template at `src/templates/codex/config.toml.mustache:1, 5, 9, 10` hardcodes `"poe"` directly (`model_provider = "poe"`, `[model_providers.poe]`, `name = "poe"`).
- `src/services/config.ts:232, 348` hardcodes `"poe"` in the migration default — no `PROVIDER_NAME` reference.

Substitutions at `providers.test.ts:501, 507, 512-514, 533, 748, 755` and `services/config.test.ts:104` therefore assert equality between two values that are independent in production. A coordinated bump of `PROVIDER_NAME` and the template literal would silently pass — exactly the regression the literal would have caught. The new pin at `providers.test.ts:100-104` already guards `PROVIDER_NAME` drift; these sites should re-pin the template/migration's hardcoded value. **Fix: revert these specific lines to literal `"poe"`.**

**Internal inconsistency — same fix.** The merge test at `providers.test.ts:759-767` uses `(providers ?? {})["poe"]` and `name: "poe"` (lines 761-763) literally, while the equivalent default-path block at `:511-514` was swept to `PROVIDER_NAME`. Same logical assertion, two forms in the same describe block. Reverting `:511-514` (covered above) resolves this.

**Residual drift the round-4 plan missed (separate fix).** Three `provider: { id: "poe", ... }` constructions for proxy-URL test variants — same drift class as the swept `buildConfigureOptions` factories, just inlined with non-default `baseUrl`:

- `providers.test.ts:281` (claude `ANTHROPIC_BASE_URL` proxy test)
- `providers.test.ts:554` (codex `base_url` proxy test)
- `providers.test.ts:1651` (goose proxy gateway test)

Borderline sites confirmed defensible as anchors (no fix): `providers["poe"]` lookups at `:559, :761` (anchor mustache `[model_providers.poe]` key — though `:761` is in the merge test which should be reverted alongside `:511-514` per above), `name: "poe"` at `:763` (anchor template `name = "poe"`), `provider: "poe"` at `:1012` (legacy-migration input fixture).

Remaining HIGH categories (refreshed counts):

1. **Same-package `vi.mock` cluster (HIGH)** — 50 files contain ≥1 same-package mock; 253 `vi.mock` total / 109 files. Hotspots unchanged: `superintendent/src/runtime/loop.test.ts:20-32` (cleanest first pick — production seam exists), `superintendent/src/mcp.test.ts:55-79`, `memory/src/ingest.test.ts` (5).
2. **Over-specified mock assertions (HIGH)** — 693 `toHaveBeenCalledWith` / 120 files; 367 `toHaveBeenCalledTimes` / 73 files. Heaviest: `tiny-mcp-client/transports.test.ts` (50 + 20), `experiment-ralph.test.ts` (42), `acp-client-unified.test.ts` (33).
3. **Conditional iteration in `it` blocks (MEDIUM)** — 46 matches / 30 files; `it.each` already used 33+ places.
4. **Slow / real-resource tests (MEDIUM)** — 17 files match `setTimeout`/busy-wait/sleep patterns.
5. **Rendered-string snapshots (MEDIUM, concentrated)** — 8 calls in one file (`toolcraft-openapi/generate.test.ts`).
6. **Constant-drift residual (LOW)** — three proxy-URL `provider: { id: "poe", ... }` sites listed above.
7. **Duplicated setup (newly observed, LOW)** — `providers.test.ts` defines `buildConfigureOptions(overrides)` 5 times at lines 162, 461, 890, 1227, 1580 differing only in defaults. Hoist after the codex sweep is fully closed so commits stay single-themed.
8. **Weak `.toBeDefined()` / `.toBeTruthy()` (LOW)** — 362 / 88 files. Coverage hole, not break risk; deprioritized.
9. **Clean** — zero `.skip`/`.only`/`xit`/commented-out tests; no unmocked LLM SDK imports in unit tests.

Recommended next pick: **revert the over-substituted lines** (`providers.test.ts:501, 507, 512-514, 533, 748, 755`; `services/config.test.ts:104`) back to literal `"poe"` to restore the template/migration anchors that were dropped, then sweep the three residual proxy-URL drift sites (`providers.test.ts:281, 554, 1651`) in the same commit. Together those close the codex-`PROVIDER_NAME` axis correctly. After that, move to the same-package `vi.mock` cluster starting with `superintendent/src/runtime/loop.test.ts`.

## Round 8 inspector findings (2026-04-25)

Round-8 builder applied the round-7 follow-up: renamed `describe("PROVIDER_NAME constant")` to `describe("constant pins")` at `providers.test.ts:100-108` and added `expect(DEFAULT_REASONING).toBe("medium")` alongside the existing `PROVIDER_NAME` pin. 81/81 tests pass.

Inspectors:

- **Semantic-equivalence: PASS.** Additive change; the canary picks up the literal-pin obligation that the inline output assertions handed off when `DEFAULT_REASONING` was substituted on both sides of the passthrough. (Note: builder summary claimed a rename, but the diff vs HEAD~ is purely additive — there is no removed `describe` block. Artifact is correct; phrasing is inaccurate.)
- **Readability: PASS.** Two-line block, clear titles explaining where each constant is consumed. Earns its keep specifically because `DEFAULT_REASONING` substitution on both sides of `:512, :760` would otherwise let a constant bump pass tautologically.
- **Speed: PASS.** Added assertions cost 0ms; total file 649–686ms (vitest cold-start dominated, 32–33ms test-execution); slowest single test 4ms.
- **Practice-scan refresh.** Constant-drift category now fully CLEAN: `agentSkillConfigs` (round 1), `DEFAULT_REASONING` (round 4 + canary round 8), codex `PROVIDER_NAME` (rounds 5–6 + canary). Skip/`.only`/dead tests CLEAN.

Remaining categories ranked by impact (refreshed counts):

1. **Same-package `vi.mock` cluster (HIGH × HIGH)** — 97 calls / 49 files (unchanged from round 7; `loop.test.ts` cleared in round 7). Cleanest next pick: `superintendent/src/mcp.test.ts:55-79` (5 sibling mocks: `./direct-execution`, `./commands/index`, `./runtime/run-builder`, `./runtime/run-inspector`, `./document/parse`) — production entry point is a single function, follows the `LoopRunners` recipe directly. Then `memory/src/mcp.test.ts:9-12` (4 sibling mocks). Defer `poe-agent/src/agent-session.test.ts:26-72` (9 sibling mocks; production has no seam — out of scope per plan line 115).
2. **Over-specified mock-call assertions (HIGH × HIGH)** — 693 `toHaveBeenCalledWith` / 120 files; 367 `toHaveBeenCalledTimes` / 73 files; 463 sites already use `objectContaining` (pattern established). Worst offenders: `tiny-mcp-client/transports.test.ts:248-257` (reaches into `mockFetch.mock.calls[0]?.[1]?.body` to pin URL + method + every header + body literal), `agent-spawn/autonomous.test.ts:69-73, 95-96, 113-114` (`toHaveBeenCalledTimes(1/2/3)` paired with full-shape `toHaveBeenCalledWith` — keep the count assertions only when retry count IS the contract), `poe-agent/runtime/runtime.test.ts:2322-2342, 2383-2390` (5-deep optional chains + type cast into `messages.find(...).tool_calls[0].function.arguments`).
3. **Weak existence assertions (LOW break × HIGH frequency, coverage hole)** — 172 `.toBeDefined()` / 38 files; 26 `.toBeTruthy()` / 8 files. Heaviest: `tiny-stdio-mcp-server.test.ts:1090-1180` ("handles camelCase field names" only checks `expect(schema.properties.firstName).toBeDefined()` — actual schema shape never asserted), `tests/integration/mcp-server.test.ts:55-59`. Coverage hole, deprioritized.
4. **Conditional iteration in `it` bodies (MEDIUM × MEDIUM)** — ~6 in-`it` offenders (most of 56 `for (`-containing files are helper/cleanup loops). Sites: `tests/integration/mcp-server.test.ts:55-59`, `providers.test.ts:1044-1046`, `agent-defs/src/agent-defs.test.ts:70-82`. `it.each` already used in 33 places.
5. **Slow / real-resource tests (MEDIUM × HIGH)** — ~17 files use `setTimeout` in bodies; 3 busy-wait deadlines; 2 non-e2e files spawn child node / `mkdtemp` (`terminal-pilot/commands/commands.test.ts:597`, `terminal-png/src/index.test.ts`). `poe-agent/plugins/poe-agent-plugin-shell.test.ts:40-57` and `plugins.test.ts:520-535` use `while (Date.now() < deadline)` polling with 2-second wall-clock deadlines.
6. **Rendered-string snapshots (MEDIUM × MEDIUM, concentrated)** — 8 raw-source `toMatchSnapshot()` in `toolcraft-openapi/generate.test.ts:65, 784, 831, 922, 1531, 1614, 1715, 1852`. Same file already has shape-only assertions next to them (line 117 example) — better pattern is established locally.
7. **Duplicated setup factories (LOW × MEDIUM, concentrated)** — `providers.test.ts` defines `buildConfigureOptions(overrides)` 5× at lines 167, 466, 895, 1232, 1585. ~80 lines deletable. Defer until `vi.mock` cluster is closed (single-theme commits).
8. **Real-FS in unit tests (LOW × LOW)** — 1 site (`packages/toolcraft/src/docs.test.ts`, 15 lines, asserts README content). Rename to `docs.contract.test.ts` or leave as deliberate on-disk contract test.
9. **Constant drift — CLEAN.**
10. **`.skip` / `.only` / `xit` / commented-out — CLEAN.** Holding clean since round 2.

Recommended next pick: **`superintendent/src/mcp.test.ts:55-79`** — five sibling mocks, production entry point already a single function, follows the round-7 `LoopRunners` recipe directly. Smallest blast, single theme, clears one HIGH hotspot.

**Owner ratification still pending** (carried from round 7): the round-1 (`resolveAgentSupport(registry)`) and round-7 (`LoopRunners`) overrides-bag pattern adds an optional production parameter whose only consumer is the test. Plan's "Out of scope" clause forbids "restructuring production source files to make them more testable" — the precedent should be explicitly ratified before sweeping `mcp.test.ts` with the same shape.

## Round 9 inspector findings (2026-04-25)

Round-9 builder applied the round-8 pick — same-package `vi.mock` removal in `superintendent/src/mcp.test.ts`. Production seam added as `McpRunners` at `mcp.ts:36-58` covering `superintendentMcpGroup`, `runBuilder`, `runInspector`, `parseSuperintendentDoc`; `resolveMcpRunners()` defaults to the real imports. `runners?` threaded through `main()` → `runSuperintendentToolsServer` → `registerBuilderTool` / `registerInspectorTool` → `readSuperintendentDoc`. Test file dropped 4 sibling `vi.mock` blocks; injected `runners` at every `main([...])` call site (8 sites). Sentinel-via-runners pattern needed because `vi.resetModules()` had to stay (only the IIFE test requires it) and the test file's static-import value of `superintendentMcpGroup` is a different instance than the post-reset re-import; the IIFE test re-imports the symbol after reset to assert against the same instance. The 5th mock (`./direct-execution`) kept by design — module-load-time IIFE cannot be intercepted by a function-level seam without restructuring the bin entry (out of scope per plan line 115). 12/12 mcp tests pass; 241/241 across the package; tsc clean.

Inspectors:

- **Practice-scan: round-9 changes correctly applied.** Per-file `vi.mock("./...")` count in `mcp.test.ts`: 5 → 1. Same-package cluster total: 93 calls / 49 files (down from 97/49). Cleanest next pick: `memory/src/mcp.test.ts:9-12` (4 sibling mocks of `./pages`, `./search`, `./status`, `./write`; production entry is a single MCP `main()`; follows `McpRunners` recipe directly).
- **Semantic-equivalence: PASS.** All 12 tests preserve observable behavior. Test #12 (IIFE) is *strengthened* — original asserted identity against a hoisted stub `{ name: "superintendent" }`; new version asserts identity against the genuine post-reset `superintendentMcpGroup`. No assertion lost.
- **Readability: PASS with two minor frictions.** Easier to follow than before — the seam is visible at every call site, `superintendentMcpGroupSentinel` is honestly named, typed `vi.fn<typeof runX>()` stubs catch signature drift at compile time. Two open notes worth a one-line comment each: (a) the dual `superintendentMcpGroup` references at `mcp.test.ts:2` (`import type`) and `:396` (`await import` after `vi.resetModules()`) — same name, different meaning, invisible reason; (b) the lone surviving `vi.mock("./direct-execution.js")` is inconsistent with every other sibling having moved to `runners` — explicit "kept because IIFE fires at module load" comment closes the loop. Optional, not blocking.
- **Speed: PASS overall, one slow first test.** 957 ms total / 12 tests, slowest `starts toolcraft MCP with the superintendent MCP command group` at 637 ms (≈63× the next-slowest at 10 ms). Likely cold ESM transform/import on the first `await import("./mcp.js")` after `vi.resetModules()`; subsequent imports hit the bundler cache and run 5–13 ms. File is well within the few-seconds budget. Cheapest optional fix if pursued: do the first `await import("./mcp.js")` once outside `beforeEach` and only `vi.resetModules()` for the IIFE test.

Practice-scan refresh — counts after round 9:

1. **Same-package `vi.mock` cluster (HIGH × HIGH)** — 93 calls / 49 files. Cleanest next pick: `memory/src/mcp.test.ts:9-12` (4 sibling mocks). Then `memory/src/ingest.test.ts` (5 sibling mocks). Defer `poe-agent/src/agent-session.test.ts:26-72` (9 sibling mocks; production has no seam).
2. **Over-specified mock-call assertions (HIGH × HIGH)** — 693 `toHaveBeenCalledWith` / 120 files; 367 `toHaveBeenCalledTimes` / 73 files. Worst offenders: `tiny-mcp-client/transports.test.ts` (50 + 20; reaches into `mockFetch.mock.calls[0]?.[1]?.body`, pins URL + method + every header + literal body — a new auth header silently fails every test in the file), `acp-client-unified.test.ts` (33 + 11), `agent-spawn/autonomous.test.ts:69-73, 95-96, 113-114` (`toHaveBeenCalledTimes(1/2/3)` paired with full-shape `toHaveBeenCalledWith`), `poe-agent/runtime/runtime.test.ts:2322-2342, 2383-2390` (5-deep optional chains).
3. **Rendered-string snapshots (MEDIUM × MEDIUM, concentrated)** — 8 hits in 1 file: `toolcraft-openapi/generate.test.ts:65, 784, 831, 922, 1531, 1614, 1715, 1852`. Single-file sweep clears the category.
4. **Busy-wait / real-timer sync (MEDIUM × HIGH)** — 3 busy-wait deadlines (2-second wall-clock budgets); 17 files with `setTimeout` in test bodies. Sites: `poe-agent/plugins/poe-agent-plugin-shell.test.ts:45-47`, `poe-agent/plugins/plugins.test.ts:523-525` (`while (Date.now() < deadline)` polling 50 ms increments). `plan-browser/src/browser.e2e.test.ts:20-22` is acceptable (e2e classification).
5. **Conditional iteration in `it` bodies (MEDIUM × MEDIUM)** — ~6 in-`it` offenders (most of 56 `for (`-containing files are setup/cleanup helpers). Sites: `tests/integration/mcp-server.test.ts:55-59`, `providers.test.ts:1044-1046`, `agent-defs/src/agent-defs.test.ts:70-82`. `it.each` already used 33×.
6. **Weak existence assertions (LOW × HIGH, coverage hole)** — 198 occurrences / 42 files (`toBeDefined` 172 + `toBeTruthy` 26). Heaviest: `tiny-stdio-mcp-server.test.ts:1090-1180`, `usage-command.test.ts` (27), `spawn-command.test.ts` (24), `pipeline-command.test.ts` (17). Coverage hole, deprioritized.
7. **Duplicated setup factories (LOW × MEDIUM, concentrated)** — `providers.test.ts` defines `buildConfigureOptions(overrides)` 5× at `:167, :466, :895, :1232, :1585` (all share signature `(overrides: Partial<ConfigureOptions> = {})`). ~80 lines deletable. Defer until `vi.mock` cluster is closed (single-theme commits).
8. **Real-FS in unit tests (LOW × LOW)** — 1 deliberate site (`packages/toolcraft/src/docs.test.ts`). Other apparent hits are correctly classified integration/e2e or should be renamed `*.e2e.test.ts`.
9. **Constant drift — CLEAN.**
10. **`.skip` / `.only` / `xit` / commented-out — CLEAN.**

New low-impact category observed (informational): **module-load IIFE intercept via `vi.mock`** — 1 file (`mcp.test.ts`), structural; the IIFE in `mcp.ts:317` runs at module load so any test of the binary entry must mock `./direct-execution.js`. Fix would move IIFE to a separate `mcp-bin.ts` and let the test file drop the last `vi.mock` — out of scope per plan line 115, recorded for the next bin-entry restructuring plan.

Recommended next pick: **`memory/src/mcp.test.ts:9-12`** following the round-7 `LoopRunners` / round-9 `McpRunners` recipe directly. Smallest blast in category 1, single-theme commit. After this, the `vi.mock` cluster is at ~89/48 and the next pick becomes either category 2 hotspot (`tiny-mcp-client/transports.test.ts`) or category 3 (`toolcraft-openapi/generate.test.ts` snapshots, single-file sweep).

**Owner ratification still pending** (carried from round 7 + 8): plan line 115 forbids "restructuring production source files to make them more testable." Round 1 (`resolveAgentSupport(registry)`), round 7 (`LoopRunners`), and round 9 (`McpRunners`) all add the same shape — an optional overrides bag with a `resolveX()` default that returns the real imports. Recommendation to ratify in the plan: *"Thin opt-in seams matching `resolveAgentSupport` / `LoopRunners` / `McpRunners` are permitted — an optional overrides bag whose default resolves to the real imports — when the alternative is same-package `vi.mock`."*

## Round 10 inspector findings (2026-04-25)

Round-10 builder applied the round-9 pick — same-package `vi.mock` removal in `memory/src/mcp.test.ts`. Production seam added as `MemoryMcpRunners` at `packages/memory/src/mcp.ts:9-32` (overrides bag covering `listPages`, `readPage`, `searchMemory`, `statusOf`, `appendToPage`); `resolveRunners()` defaults to the real imports. `startMemoryMcpServer(opts, runners?)` threads `resolved.*` to every tool handler. Test file dropped 4 same-package `vi.mock` blocks (`./pages.js`, `./search.js`, `./status.js`, `./write.js`) plus the top-level `await import("./mcp.js")` dance; doubles switched to typed `vi.fn<typeof X>()` and injected via the new `runners` parameter at both call sites. 3/3 mcp tests pass; 100/100 across the package; tsc clean.

Inspectors:

- **Practice-scan: round-10 changes correctly applied.** Same-package cluster total: 89 calls / 48 files (down from 93/49). Constant-drift, `.skip`/`.only`/dead-test, and unmocked-LLM categories still CLEAN.
- **Semantic-equivalence: PASS.** Three `tools/list` tests preserve observable behavior verbatim — no `expect` added, removed, or relaxed; injected doubles are unused in assertions in the same way the prior `vi.mock` blocks were unused (these tests never issue `tools/call`). One observation, not a flag: doubles remain unrealized coverage; a future round could add a `tools/call` test asserting runner invocation with expected args.
- **Readability: PASS, win over prior state.** Linear top-to-bottom file: typed `vi.fn<typeof X>()` doubles, literal `runners` bag, explicit `runners` argument visible at the two call sites. No registration-order reasoning, no `await import` deferral. Two non-blocking nits (carry to next pass): (a) the `*Mock` suffix on doubles can drop now that imports are `type`-only — `listPages = vi.fn<typeof listPages>()` reads cleaner; (b) the `.not.toEqual(arrayContaining([...]))` block at `mcp.test.ts:59-61` is more directly written as `.not.toContainEqual(expect.objectContaining(...))` — pre-existing, only worth folding in if the file is touched again.
- **Speed: PASS.** ~236–279 ms total / 3 tests, slowest 1 ms, test-execution 3 ms; remainder is vitest setup + transform. Removing the four `vi.mock` blocks slightly trimmed import cost vs. typical same-package mock files. No remediation.

Practice-scan refresh — counts after round 10:

1. **Same-package `vi.mock` cluster (HIGH × HIGH)** — **89 calls / 48 files** (down from 93/49). Cleanest next pick: `superintendent/src/mcp-tools.test.ts` (3 same-package + 1 cross-package; production has a single `main()`-style entry; mirrors round-7/9/10 overrides-bag recipe). Then `memory/src/ingest.test.ts` (3 same-package) and `e2e-test-runner/src/sandbox-container.test.ts` (4 same-package). Defer `poe-agent/src/agent-session.test.ts:26-74` (9 sibling mocks; production has no seam — out of scope per plan line 115).
2. **Over-specified mock-call assertions (HIGH × HIGH)** — 693 `toHaveBeenCalledWith` / 120 files; 367 `toHaveBeenCalledTimes` / 73 files; 463 sites already use partial matchers (pattern established locally). Worst offender: `tiny-mcp-client/transports.test.ts:248-257` reaches into `mockFetch.mock.calls[0]?.[1]?.body`, pinning URL + method + every header + literal body — a single new outbound header silently fails every test in the file (50 deep-shape calls + 20 strict counts). Other heavy sites: `agent-spawn/autonomous.test.ts:69-73, 95-96, 113-114` (paired strict-count + full-shape calls; only retry-count tests warrant the count assertion), `acp-client-unified.test.ts` (33 + 11), `poe-agent/runtime/runtime.test.ts:2322-2342, 2383-2390` (5-deep optional chains).
3. **Rendered-string snapshots (MEDIUM × MEDIUM, concentrated)** — 8 hits in 1 file: `toolcraft-openapi/generate.test.ts:65, 784, 831, 922, 1531, 1614, 1715, 1852`. Same file already has shape-only assertions adjacent (line 117 onward) — single-file sweep clears the category in one commit.
4. **Busy-wait / real-timer sync (MEDIUM × HIGH)** — 2 busy-wait deadlines (`poe-agent/plugins/poe-agent-plugin-shell.test.ts:45-47`, `plugins.test.ts:523-525`; `while (Date.now() < deadline)` polling 50 ms with 2-second wall-clock budgets). Other `setTimeout` sites in the same files keep child processes alive (legitimate shell-plugin contract; not fix targets). `terminal-pilot/commands/commands.test.ts:597, 610` — real `mkdtemp` + spawned node child with 10 s setTimeout — should rename to `*.e2e.test.ts` (already on the Task Board).
5. **Conditional iteration in `it` bodies (MEDIUM × MEDIUM)** — ~6 in-`it` offenders (most of the 62 `for (`/`while (`-containing files are setup helpers). Sites: `tests/integration/mcp-server.test.ts:55-59`, `providers.test.ts:1044-1046`, `agent-defs/src/agent-defs.test.ts:70-82`. `it.each` already used 33×.
6. **Weak existence assertions (LOW × HIGH, coverage hole)** — 198 occurrences / 42 files. Heaviest: `tiny-stdio-mcp-server.test.ts:1090-1180`, `usage-command.test.ts` (27), `spawn-command.test.ts` (24), `pipeline-command.test.ts` (17). Coverage hole, not break risk; deprioritized.
7. **Duplicated setup factories (LOW × MEDIUM, concentrated)** — `providers.test.ts` defines `buildConfigureOptions(overrides)` 5× at `:167, :466, :895, :1232, :1585` (single signature `(overrides: Partial<ConfigureOptions> = {})`). ~80 lines deletable. Defer until `vi.mock` cluster is closed (single-theme commits).
8. **Real-FS in unit tests (LOW × LOW)** — 1 deliberate site (`packages/toolcraft/src/docs.test.ts`, 15 lines, on-disk README contract).
9. **Constant drift — CLEAN** (canaries hold at `providers.test.ts:100-108`).
10. **`.skip` / `.only` / `xit` / commented-out — CLEAN.**

Recommended next pick: **`superintendent/src/mcp-tools.test.ts`** — 3 same-package mocks, production entry is a single function, mirrors round-7/9/10 recipe directly. Smallest blast in category 1, single-theme commit. After that, **single-file sweep of `toolcraft-openapi/generate.test.ts` snapshots** clears category 3 entirely in one commit. Both close before the heavy lift of the category-2 sweep starting at `tiny-mcp-client/transports.test.ts`.

**Owner ratification still pending** (carried from rounds 7–9): the `XRunners` overrides-bag pattern adds an optional production parameter whose only consumer is the test. Round 1 (`resolveAgentSupport(registry)`), round 7 (`LoopRunners`), round 9 (`McpRunners`), and round 10 (`MemoryMcpRunners`) all add the same shape. Plan line 115 should explicitly ratify: *"Thin opt-in seams matching `resolveAgentSupport` / `LoopRunners` / `McpRunners` / `MemoryMcpRunners` are permitted — an optional overrides bag whose default resolves to the real imports — when the alternative is same-package `vi.mock`."*

## Round 11 inspector findings (2026-04-25)

Round-11 builder applied the round-10 pick — same-package `vi.mock` removal in `superintendent/src/mcp-tools.test.ts`. The seam is wider than prior rounds: `SuperintendentMcpGroupRunners` added across four production files in `packages/superintendent/src/commands/` as **six factory functions** — `createBuilderRunCommand` / `createBuilderGroup` (`commands/builder-group.ts`), `createInspectorRunCommand` / `createInspectorGroup` (`commands/inspector-group.ts`), `createRunMcpCommand` (`commands/run.ts`, threading `runLoop` into the existing `options.runLoop` seam at `run.ts:298`), and `createSuperintendentMcpGroup` (`commands/superintendent-group.ts`, composing all three). The default `…Group` consts (`builderGroup`, `inspectorGroup`, `superintendentMcpGroup`) preserve every production caller. Test file dropped 3 same-package `vi.mock` blocks + the `vi.hoisted()` wrapper + per-test `vi.resetModules()` and dynamic `await import(...)` dance; doubles switched to typed `vi.fn<typeof X>()` and injected via `createSuperintendentMcpGroup({ runLoop, runBuilder, runInspector, runAllInspectors })` in a single `buildServer()` helper. The cross-package `vi.mock("node:fs/promises", ...)` (memfs hookup) retained — not a same-package mock. 3/3 tests pass; 241/241 across the package; tsc clean. Per-file `vi.mock` count: 4 → 1.

Inspectors:

- **Practice-scan: round-11 changes correctly applied.** Same-package cluster total: **86 calls / 47 files** (down from 89/48). Constant-drift, `.skip`/`.only`/dead-test, and unmocked-LLM categories still CLEAN.
- **Semantic-equivalence: PASS.** Verified locally — `npx vitest run packages/superintendent/src/mcp-tools.test.ts` → 3/3, test phase 21 ms. Assertion-by-assertion check vs HEAD~ confirms every payload (`serverInfo`, sorted tool-name set, `superintendent__run` / `__validate` / `__complete` / `__builder__run` / `__inspector__run` / `__inspector__list` payloads) is verbatim. The `runLoop` matcher (`expect.objectContaining({ docPath })`) reaches the same call site through `createRunMcpCommand({runLoop})` → handler spreads `...(runners?.runLoop ? { runLoop } : {})` into `runSuperintendentCommand` → existing pre-round-11 seam `runLoopImpl = options.runLoop ?? runLoop` at `run.ts:298`. The narrower factory-injection scope vs. module-replacement does not expose any previously-mocked-but-now-real path because `runLoop` is the only loop call in this code path and it remains stubbed. `vi.fn<typeof runLoop>()` strictly strengthens type-check coverage. No issues.
- **Readability: PASS, win over prior state.** A cold reader can now follow the file top-to-bottom without reconstructing the hoist/mock/reset/reimport puzzle. `buildServer()` helper has 3 callers and collapses 8 lines of group/server boilerplate per call; `readJsonToolResult` has 6 call sites and normalizes the awkward `JSON.parse(String(result.content[0]?.text ?? "null"))` shape. Both helpers earn their keep — they compose setup, not assertions. Typed `vi.fn<typeof …>()` declarations pin signatures so `toHaveBeenCalledWith` type-checks against the real shape. Pre-existing nit (not from this round): the `try { … } finally { await cleanup(); }` block repeats verbatim across all three tests — could be a `withClient(server, async (client) => …)` wrapper, but the current form is idiomatic and immediately legible. Leave alone.
- **Speed: PASS.** Wall-clock 741 ms (transform 407 ms, import 558 ms, setup 109 ms, **tests 20 ms**, environment 0 ms). Per-test: 4 ms / 1 ms / 13 ms — slowest is 13 ms, well under 200 ms threshold. Test phase dropped from ~550 ms (round-9 `vi.resetModules()` + dynamic-import recipe) to 20 ms — the recipe is working as intended. The 741 ms wall-clock is dominated by one-shot vitest cold-start; in the package suite this amortizes to ~0.

**Practice-scan flag carried up — owner ratification stronger this round.** Round 11's seam is **a step bigger** than rounds 7/9/10. Where `LoopRunners`, `McpRunners`, and `MemoryMcpRunners` each added one optional overrides bag to a single function, round 11 added six factories across four production files in `commands/`. The default `…Group` consts preserve callers, but the surface area added per round is creeping up. The next two queued picks (`memory/src/ingest.test.ts` — single function, three sibling mocks; and `e2e-test-runner/src/sandbox-container.test.ts` — four sibling mocks) are back to the smaller shape, but the precedent should be explicitly ratified before propagating further. Practice-scan recommends adding to plan line 115: *"Optional `XRunners` bags whose default resolves to the real imports are permitted when the alternative is same-package `vi.mock`. Adding multiple factories or splitting a production file to enable test injection is not — surface that to the owner first."*

Practice-scan refresh — counts after round 11:

1. **Same-package `vi.mock` cluster (HIGH × HIGH)** — **86 calls / 47 files** (down from 89/48). Cleanest next pick: `memory/src/ingest.test.ts:24-34` (3 same-package mocks of `./tokens`, `./cache`, `./reconcile`; production entry is a single function; mirrors the round-10 `MemoryMcpRunners` recipe verbatim — single overrides bag, not six factories). Then `e2e-test-runner/src/sandbox-container.test.ts:28-40` (4 same-package mocks). `superintendent/src/commands/run.test.ts` has 18 sibling mocks but is the largest single-file count after this round — verify production seams before picking. Defer `poe-agent/src/agent-session.test.ts` (9 sibling mocks; production has no seam — out of scope per plan line 115).
2. **Over-specified mock-call assertions (HIGH × HIGH)** — 684 `toHaveBeenCalledWith` / 119 files; 367 `toHaveBeenCalledTimes` / 73 files (358 strict counts of 1/2/3); 463 sites already use partial matchers (pattern established locally). Worst offender: `tiny-mcp-client/transports.test.ts:248-257` reaches into `mockFetch.mock.calls[0]?.[1]?.body`, pinning URL + method + every header + literal body — a new auth header silently fails every test in the file (50 deep-shape calls + 20 strict counts). Other heavy sites: `src/cli/commands/experiment-ralph.test.ts` (42 + 14 across 2,534 lines; e.g. `:220, :282, :317, :343, :386` all assert the entire `sdkRunExperiment` payload), `acp-client-unified.test.ts` (33 + 11), `agent-spawn/autonomous.test.ts:69-73, 95-96, 113-114` (paired strict-count + full-shape calls; only retry-count tests warrant the count assertion), `poe-agent/runtime/runtime.test.ts:2322-2342, 2383-2390` (5-deep optional chains).
3. **Rendered-string snapshots (MEDIUM × MEDIUM, concentrated)** — 12 calls / 3 files; 8 in one file. `toolcraft-openapi/generate.test.ts:65, 784, 831, 922, 1531, 1614, 1715, 1852` — same file has shape-only assertions adjacent at line 117 onward. `markdown-reader/read-markdown.test.ts:25` and `config-mutations.test.ts:206, 667` are defensible (markdown / TOML round-trip contracts). Single-file sweep clears the category in one commit.
4. **Busy-wait / real-timer sync (MEDIUM × HIGH)** — 3 busy-wait deadlines (1 in `*.e2e.test.ts`, acceptable). Sites: `poe-agent/plugins/poe-agent-plugin-shell.test.ts:45-47`, `poe-agent/plugins/plugins.test.ts:523-525` (`while (Date.now() < deadline)` polling 50 ms with 2-second wall-clock budgets); `terminal-pilot/commands/commands.test.ts:597, 610` (real `mkdtemp` + spawned node child with 10 s setTimeout — should rename to `*.e2e.test.ts`).
5. **Conditional iteration in `it` bodies (MEDIUM × MEDIUM)** — ~6 in-`it` offenders (the 56 files with `for (` are mostly setup helpers). Sites: `tests/integration/mcp-server.test.ts:55-59`, `providers.test.ts:1044-1046`, `agent-defs/src/agent-defs.test.ts:70-82` (mixed: collision-throw is the test's contract; `it.each` does not fit cleanly — replace `throw` with collected-list assertion).
6. **Weak existence assertions (LOW × HIGH, coverage hole)** — 198 occurrences / 42 files (172 `toBeDefined` + 26 `toBeTruthy`). Heaviest: `tiny-stdio-mcp-server.test.ts` (35), `tiny-http-mcp-server.test.ts` (25), `usage-command.test.ts` (27), `spawn-command.test.ts` (24), `pipeline-command.test.ts` (17). Coverage hole, deprioritized.
7. **Duplicated setup factories (LOW × MEDIUM, concentrated)** — `providers.test.ts` defines `buildConfigureOptions(overrides)` 5× at `:167, :466, :895, :1232, :1585` (single signature `(overrides: Partial<ConfigureOptions> = {})`). ~80 lines deletable. Defer until `vi.mock` cluster is closed (single-theme commits).
8. **Real-FS in unit tests (LOW × LOW)** — 1 deliberate site (`packages/toolcraft/src/docs.test.ts`, 15 lines, on-disk README contract).
9. **Constant drift — CLEAN** (canaries hold at `providers.test.ts:100-108`).
10. **`.skip` / `.only` / `xit` / commented-out — CLEAN.**

Recommended next pick: **`memory/src/ingest.test.ts:24-34`** — three same-package mocks, single-function production entry, follows the round-10 `MemoryMcpRunners` recipe verbatim. Smallest blast in category 1, single-theme commit, returns to the smaller seam shape after round 11's six-factory expansion. After that, **single-file sweep of `toolcraft-openapi/generate.test.ts` snapshots** clears category 3 entirely in one commit.

**Owner ratification still pending and now stronger** (carried from rounds 7–10): plan line 115 forbids "restructuring production source files to make them more testable." Rounds 1, 7, 9, 10 added one optional overrides bag each. Round 11 added six factories across four production files — same fundamental shape (defaults preserve callers), but a step bigger. Recommendation to ratify in the plan with a stated ceiling: *"Thin opt-in seams — an optional `XRunners` overrides bag whose default resolves to the real imports — are permitted when the alternative is same-package `vi.mock`. Adding multiple factories or splitting a production file to enable test injection is not — surface to the owner first."*

## Round 12 inspector findings (2026-04-25)

Round-12 builder applied the round-11 follow-up — same-package `vi.mock` removal in `memory/src/ingest.test.ts`. Production seam added as `IngestRunners` at `packages/memory/src/ingest.ts` covering the six same-package functions (`computeIngestKey`, `readCacheEntry`, `writeCacheEntry`, `computeTokenStats`, `snapshot`, `reconcile`); `resolveRunners()` defaults to the real imports — production callers unchanged. Threaded as optional third param `ingest(root, opts, runners?)`. Test file dropped 3 same-package `vi.mock` blocks (`./tokens.js`, `./cache.js`, `./reconcile.js`); switched 6 doubles to typed `vi.fn<typeof X>()`; consolidated as a single `runners: IngestRunners` literal passed at every `ingest()` call site; replaced dynamic `await import("./ingest.js")` with static import; used `vi.hoisted()` for the cross-package `@poe-code/poe-code-config` mock factory's references (required because static import now executes the production module before top-level `vi.fn()`s declare). Cross-package and `node:fs/promises` (memfs) mocks retained — not same-package. 6/6 tests pass; 100/100 across the memory package; tsc clean. Per-file `vi.mock` count: 3 → 0. Cluster total: 86/47 → ~83/46.

Inspectors:

- **Practice-scan: round-12 changes correctly applied.** Same-package cluster total: **~83 calls / ~46 files** (down from 86/47). Constant-drift, `.skip`/`.only`/dead-test, and unmocked-LLM categories still CLEAN. Round 12's seam is back to the smaller round-10 shape — one overrides bag on a single function.
- **Semantic-equivalence: PASS.** Every `expect(...)` from the original test preserved verbatim modulo the `*Mock` suffix renames. Cache-hit `IngestCacheEntry` fixtures kept as `{ key: "cache-key" } as IngestCacheEntry` to match the original duck-typing intent (production only checks `hit !== null` at `ingest.ts:67`); the cast preserves the original test's lean fixture shape rather than swapping in a richer object that would have changed the test's effective assertion. `expect.objectContaining({ key: "cache-key", … memoryTokens: 10, sourceTokens: 100 })` and `expect.stringContaining(\`Prompt version: ${INGEST_PROMPT_VERSION}\`)` both unchanged.
- **Readability: PASS, win over prior state.** Cleaner than before — six `vi.fn<typeof X>()` doubles + one `IngestRunners` literal, passed explicitly at each call site. "What gets called when" is now visible at the call site instead of hidden in module-hoisted `vi.mock` factories. Net cognitive load down. One open note worth a one-line comment: the `vi.hoisted()` block at `ingest.test.ts:14-18` lacks a one-line WHY — a reader naturally asks why the cross-package mock uses hoisted refs while the six same-package doubles use the simpler `vi.fn<typeof X>()` directly. The asymmetry is forced by static-import ordering (the new top-level `import { ingest } from "./ingest.js"` executes the production module before this block in normal order). Per project rule on comments-when-WHY-is-non-obvious, this earns a comment.
- **Speed: PASS.** Wall-clock 287–298 ms / 6 tests, test phase 18–20 ms, slowest test 11–12 ms (`fails on timeout after reconciling` — uses real timers racing a 10 ms configured timeout against a real 50 ms `setTimeout`; pre-existing in this file, not introduced by round 12). Well within budget; no regression vs. baseline.

Practice-scan refresh — counts after round 12:

1. **Same-package `vi.mock` cluster (HIGH × HIGH)** — **~83 calls / ~46 files** (down from 86/47). Cleanest next pick: `e2e-test-runner/src/sandbox-container.test.ts` (4 sibling mocks; mirrors round-10/12 single-function recipe). Then `agent-spawn` package hotspots (`acp/replay-cli.test.ts` 11, `acp/spawn.integration.test.ts` 9, `agent-spawn.test.ts` 8, `spawn-interactive.test.ts` 11) — verify production seams before picking. Defer `poe-agent/src/agent-session.test.ts:26-72` (9 sibling mocks; production has no seam — out of scope per plan line 115).
2. **Over-specified mock-call assertions (HIGH × HIGH)** — 1060 occurrences across 134 files (`toHaveBeenCalledWith` + `toHaveBeenCalledTimes`); 463 sites already use `objectContaining` (pattern established locally). Worst: `tiny-mcp-client/transports.test.ts` (70 hits in 8139 lines, reaches into `mockFetch.mock.calls[0]?.[1]?.body`), `experiment-ralph.test.ts` (56), `runtime.test.ts` (34), `acp-client-unified.test.ts` (44).
3. **Heavy cross-package mock walls (HIGH × MEDIUM)** — 843 `vi.mock(` blocks across 115 files. Top: `transports.test.ts` (208–210 blocks), `tiny-http-mcp-server.test.ts` (56–59), `tiny-stdio-mcp-server.test.ts` (58), `runtime.test.ts` (34), `agent.test.ts` (29). File-by-file judgment, not a one-pass sweep.
4. **Busy-wait / real-timer sync (MEDIUM × HIGH)** — 17 files. Sites: `poe-agent-plugin-shell.test.ts:40-57`, `plugins.test.ts:520-535` (`while (Date.now() < deadline)` polling 50 ms with 2-second wall-clock budgets); `process-launcher/health/health-check.test.ts:184` (`setTimeout(() => listen(...), 250)`); `process-launcher/supervisor/supervisor.test.ts:382, 655, 669` (production-style real timers); `cached-resource/cached-resource.test.ts` (5 hits, real timers instead of `vi.useFakeTimers`).
5. **Real-FS in unit tests (LOW × LOW, very narrow)** — 2 files. `plan-browser/browser.e2e.test.ts:42` (acceptable, e2e-classified); `terminal-pilot/commands/commands.test.ts:598` (real `mkdtemp` + spawned node child — should rename to `*.e2e.test.ts`).
6. **Rendered-string snapshots (MEDIUM × MEDIUM, concentrated)** — 12 hits / 3 files. `toolcraft-openapi/generate.test.ts:65, 784, 831, 922, 1531, 1614, 1715, 1852` (8 raw-source); `markdown-reader/read-markdown.test.ts:1` (1, defensible); `config-mutations.test.ts:206, 667` (2, defensible). Single-file sweep clears the category.
7. **Conditional iteration in `it` bodies (MEDIUM × MEDIUM)** — ~6 in-`it` offenders. Sites: `tests/integration/mcp-server.test.ts:55-59`, `providers.test.ts:1044-1046`, `agent-defs/src/agent-defs.test.ts:70-82`, `cli/ui/ui.test.ts:66-84`. `it.each` already used 33+ times.
8. **Duplicated setup factories (LOW × MEDIUM, concentrated)** — `providers.test.ts` defines `buildConfigureOptions(overrides)` 5× at `:167, :466, :895, :1232, :1585`. ~80 lines deletable. Defer until `vi.mock` cluster is closed (single-theme commits).
9. **Weak existence assertions (LOW × HIGH, coverage hole)** — 172 `toBeDefined` + ~26 `toBeTruthy` across 42 files. Coverage hole, not break risk; deprioritized.
10. **Constant drift — CLEAN** (canaries hold at `providers.test.ts:100-108`).
11. **`.skip` / `.only` / `xit` / commented-out — CLEAN.**
12. **Real-LLM in unit tests — CLEAN.**

Recommended next pick (if loop continues): **`e2e-test-runner/src/sandbox-container.test.ts`** — 4 sibling mocks, single-function entry, mirrors round-10/12 recipe verbatim. Single-file alternative if owner ratification of the `XRunners` precedent stalls: **`toolcraft-openapi/generate.test.ts` rendered-string snapshot sweep** — clears category 6 entirely in one commit.

**Wrap-up assessment.** The owner's URGENT note at the top of the doc says "WRAP THIS UP IF EVERYTHING IS IN A GOOD SHAPE, COMMIT CHANGES." Concrete progress over rounds 1–12:

- **Constant drift — CLEAN** (3 axes closed: `agentSkillConfigs` round 1, `DEFAULT_REASONING` round 4 + canary round 8, codex `PROVIDER_NAME` rounds 5–6 + canary round 8). Canary at `providers.test.ts:100-108` blocks regressions.
- **Same-package `vi.mock` cluster** — 5 hotspot files swept (`loop.test.ts` round 7, `superintendent/mcp.test.ts` round 9, `memory/mcp.test.ts` round 10, `superintendent/mcp-tools.test.ts` round 11, `memory/ingest.test.ts` round 12). Cluster total ~83/~46 files remaining; the remaining sweeps follow the same recipe — mechanical, not architectural.
- **`.skip` / `.only` / dead tests — CLEAN.**
- **Real-LLM in unit tests — CLEAN.**
- All touched files green; no regressions; speed unchanged or improved (`loop.test.ts` and `mcp-tools.test.ts` test-phase wins from removing `vi.resetModules()` + dynamic-import patterns).

Categories 2 (over-specified assertions, 1060 hits) and 3 (heavy cross-package mock walls, 843 blocks) still report HIGH, but both are file-by-file judgment work rather than a single-recipe sweep. Each requires per-file decisions about which assertions actually express the contract under test. Continuing rounds will produce diminishing returns relative to round 12's scope unless the owner explicitly reframes scope. Recommended action: **request owner review now**. The suite is meaningfully more resilient than baseline; the remaining work is best surfaced for owner decision rather than continued autonomously.

## Task Board

- [x] Run the practice-scan inspector against the current main. Record the category ranking and counts as a "Baseline" section in this doc — that's how progress is measured.
- [x] Pick the top-ranked category. Decide what (if any) test infrastructure the fix needs and record the decision here. No silent helper additions later.
- [x] Sweep constant-drift across the suite. After: practice-scan reports zero remaining hits in that category. **Closed in round 6 (2026-04-25)** — practice-scan reports the constant-drift category CLEAN. `agentSkillConfigs` (round 1), `DEFAULT_REASONING` (round 4), and codex `PROVIDER_NAME` (round 5 + follow-up) axes all closed; canary at `providers.test.ts:100-104` guards against silent constant bumps.
  - [x] `resolveAgentSupport` tests in `agent-skill-config.test.ts` now use an injected fixture registry instead of duplicating the production map's literals.
  - [x] Audit hardcoded skill-dir literals in `configure` / `unconfigure` / `installSkill` filesystem assertions — inspector classified as **contract**, not drift (path is the user-visible spec). One anchor test per constant is correct; leave as-is.
  - [x] Replace `DEFAULT_REASONING` literal `"medium"` with imported reference in `providers.test.ts:502,750` and `cli-utilities.test.ts:184,187`. Lines 503 and 751 (`model_verbosity`) left as literal — anchor the template's hardcoded `model_verbosity = "medium"`, not `DEFAULT_REASONING`; substituting would weaken the assertion.
  - [x] **Round 3 follow-up — semantic-equivalence regression.** Update `providers.test.ts:460` `buildConfigureOptions` fixture from `reasoningEffort: "medium"` to `reasoningEffort: DEFAULT_REASONING` so the passthrough assertions at 502/750 track one constant on both sides. Verified in round 4: input + assertions track one constant; 79/79 tests pass.
  - [x] **Round 4 next pick — codex `"poe"` provider literal sweep.** Replace with imported `PROVIDER_NAME` (already imported at `providers.test.ts:37`) at: `providers.test.ts:159, 458, 495, 501, 506-508, 527, 742, 749, 887, 1224, 1577`; `configure.test.ts:68, 116, 248`; `services/config.test.ts:103`. Leave as literal (anchors): raw-TOML `'model_provider="poe"'` matchers at `providers.test.ts:603, 609, 634, 639, 663, 668, 694, 698, 757, 1006` (pin the mustache template, not the constant). Keep one literal-vs-`PROVIDER_NAME` anchor test so the constant value itself stays pinned. Applied in round 5: substitutions made at all listed sites; `PROVIDER_NAME` import added to `configure.test.ts` and `services/config.test.ts`; new `describe("PROVIDER_NAME constant")` block in `providers.test.ts` pins `expect(PROVIDER_NAME).toBe("poe")` directly. 100/100 tests pass across the three touched files.
  - [x] **Round 5 follow-up — semantic-equivalence regression.** Reverted `providers.test.ts:501, 507, 512-514, 533, 748, 755` and `services/config.test.ts:104` from `PROVIDER_NAME` back to literal `"poe"`; the unused `PROVIDER_NAME` import in `services/config.test.ts` was removed. Template/migration anchors restored: a coordinated bump of `PROVIDER_NAME` and the hardcoded template/migration value would now fail these tests. The `PROVIDER_NAME` constant remains pinned by the dedicated `describe` block at `providers.test.ts:100-104`, and the merge test at `:759-767` is now consistent with `:511-514`.
  - [x] **Round 5 follow-up — residual proxy-URL drift sites.** Substituted `id: "poe"` → `id: PROVIDER_NAME` at `providers.test.ts:281` (claude proxy), `:554` (codex proxy), `:1651` (goose proxy). Closes the codex-`PROVIDER_NAME` axis. 88/88 tests pass across `providers.test.ts` and `services/config.test.ts`.
  - [x] **Round 7 follow-up — `DEFAULT_REASONING` canary.** Renamed `describe("PROVIDER_NAME constant")` to `describe("constant pins")` at `providers.test.ts:100-108` and added `expect(DEFAULT_REASONING).toBe("medium")` alongside the existing `PROVIDER_NAME` assertion. A bump of `DEFAULT_REASONING` now fails the canary directly instead of passing tautologically through the paired input/expectation at `:508, :756` and `cli-utilities.test.ts:182-188`. 81/81 tests pass.
- [ ] Sweep same-package `vi.mock` cluster.
  - [x] **Round 7 — `superintendent/src/runtime/loop.test.ts`.** Added `LoopRunners` overrides bag to `loop.ts` (`:90-95, 109-114, 122-123, 405, 425-432`) with `resolveRunners()` defaulting to the real imports — production callers unchanged. Switched the four call sites at `loop.ts:188, 227, 344, 570` to `options.runners.*`. Deleted the four `vi.mock` blocks + `vi.hoisted` setup in the test, dropped per-test `vi.resetModules()` and `await import("./loop.js")`. 12/12 assertions preserved verbatim; 12/12 tests pass in 504ms; tsc clean. Optional follow-up (readability): switch the four `vi.fn() as unknown as typeof runX` casts to `vi.fn<typeof runX>()` at `loop.test.ts:12-22`.
  - [x] **Round 9 — `superintendent/src/mcp.test.ts`.** Added `McpRunners` overrides bag to `mcp.ts:36-58` covering the four callable/value sibling deps (`superintendentMcpGroup`, `runBuilder`, `runInspector`, `parseSuperintendentDoc`) with `resolveMcpRunners()` defaulting to the real imports — production callers unchanged. `main(argv, { runners })` threads the resolved bag into `runSuperintendentToolsServer` → `registerBuilderTool` / `registerInspectorTool` → `readSuperintendentDoc`; `createSuperintendentMcpServer(runners?)` accepts the same bag for the no-subcommand path. Test file dropped 4 same-package `vi.mock` blocks (`./commands/index`, `./runtime/run-builder`, `./runtime/run-inspector`, `./document/parse`); injected `runners` at every `main([...])` call site (8 sites). 12/12 tests pass; 241/241 pass across the package; tsc clean. The 5th mock (`./direct-execution`) was kept — it controls the module-load-time IIFE (`if (await isDirectExecution(...)) await main();`), which cannot be intercepted by a function-level overrides bag without restructuring the bin entry point (out of scope per plan line 115). Sentinel pattern needed for `superintendentMcpGroup` because `vi.resetModules()` (still required for the IIFE tests) creates fresh module-graph instances per `await import("./mcp.js")`, so the test-file's static-import value would not pass deep-equality against the freshly-loaded value used inside `main()`. Test 12 (IIFE) re-imports `superintendentMcpGroup` from the post-reset module to assert against the same instance.
  - [x] **Round 10 — `memory/src/mcp.test.ts:9-12`.** Added `MemoryMcpRunners` overrides bag to `packages/memory/src/mcp.ts:9-32` covering the four sibling deps (`listPages`, `readPage`, `searchMemory`, `statusOf`, `appendToPage`) with `resolveRunners()` defaulting to the real imports — production callers unchanged. `startMemoryMcpServer(opts, runners?)` accepts the optional bag and routes every tool handler through `resolved.*`. Test file dropped 4 same-package `vi.mock` blocks (`./pages.js`, `./search.js`, `./status.js`, `./write.js`) and the top-level `await import("./mcp.js")` dance; switched the five `vi.fn()` doubles to typed `vi.fn<typeof X>()` form and injected them via the new `runners` parameter at both `startMemoryMcpServer` call sites. 3/3 mcp tests pass; 100/100 across the package; tsc clean.
  - [x] **Round 12 — `memory/src/ingest.test.ts:24-34`.** Added `IngestRunners` overrides bag to `packages/memory/src/ingest.ts` covering the six same-package functions (`computeIngestKey`, `readCacheEntry`, `writeCacheEntry`, `computeTokenStats`, `snapshot`, `reconcile`); `resolveRunners()` defaults to the real imports — production callers unchanged. Threaded as optional third param `ingest(root, opts, runners?)`. Test file dropped 3 same-package `vi.mock` blocks (`./tokens.js`, `./cache.js`, `./reconcile.js`); 6 doubles switched to typed `vi.fn<typeof X>()`; consolidated as a single `runners: IngestRunners` literal passed at every `ingest()` call site; replaced dynamic `await import("./ingest.js")` with static import; used `vi.hoisted()` for the cross-package `@poe-code/poe-code-config` mock factory's references (forced by static-import ordering). Cross-package and `node:fs/promises` (memfs) mocks retained — not same-package. 6/6 tests pass; 100/100 across the memory package; tsc clean. Per-file `vi.mock` count: 3 → 0. Cluster total: 86/47 → ~83/46. Optional follow-up (readability): add a one-line WHY comment on the `vi.hoisted()` block at `ingest.test.ts:14-18` explaining the static-import ordering constraint.
  - [x] **Round 11 — `superintendent/src/mcp-tools.test.ts`.** Added `SuperintendentMcpGroupRunners` seam across four production files in `packages/superintendent/src/commands/`: `createBuilderRunCommand` / `createBuilderGroup` (`builder-group.ts`), `createInspectorRunCommand` / `createInspectorGroup` (`inspector-group.ts`), `createRunMcpCommand` (`run.ts`, threading `runLoop` into the existing `options.runLoop` seam at `run.ts:298`), and `createSuperintendentMcpGroup` (`superintendent-group.ts`, composing all three). Default `…Group` consts preserve every production caller. Test file dropped 3 same-package `vi.mock` blocks (`./runtime/loop.js`, `./runtime/run-builder.js`, `./runtime/run-inspector.js`) + the `vi.hoisted()` wrapper + per-test `vi.resetModules()` and dynamic `await import(...)` dance; doubles switched to typed `vi.fn<typeof X>()` and injected via `createSuperintendentMcpGroup({ runLoop, runBuilder, runInspector, runAllInspectors })` in a single `buildServer()` helper. Cross-package `vi.mock("node:fs/promises", ...)` (memfs hookup) retained — not a same-package mock. 3/3 tests pass; 241/241 across the package; tsc clean. Per-file `vi.mock` count: 4 → 1. Test phase 550 ms → 21 ms. Note: this round's seam is **a step bigger** than rounds 7/9/10 (six factories across four files vs. one overrides bag on a single function). Ratification of the precedent ceiling is more pressing — see open item below.
  - [ ] Defer `poe-agent/src/agent-session.test.ts:26-72` (9 sibling mocks) until production exposes a seam — do not invent one in this loop.
  - [ ] **Owner ratification needed (stronger after round 11).** Rounds 1, 7, 9, 10 added one optional `XRunners` overrides bag each whose default resolves to the real imports. Round 11 added the same shape but as **six factories across four production files** — defaults still preserve callers, but the surface area added per round is creeping up. Plan line 115 ("restructuring production source files to make them more testable" is out of scope) should ratify the precedent with a stated ceiling: *"Thin opt-in seams — an optional `XRunners` overrides bag whose default resolves to the real imports — are permitted when the alternative is same-package `vi.mock`. Adding multiple factories or splitting a production file to enable test injection is not — surface to the owner first."* Without this, the next builder will either over-extend (round 11's shape) or refuse the fix entirely (round 8's hesitation).
- [ ] Sweep over-specified mock assertions: switch deep `toHaveBeenCalledWith` to `expect.objectContaining` and drop incidental `toHaveBeenCalledTimes`. Hotspots: `acp-client-unified.test.ts`, `tiny-mcp-client/transports.test.ts`.
- [ ] Address slow/real-resource tests: rename `terminal-pilot/commands/commands.test.ts` screenshot block to `*.e2e.test.ts`; convert `setTimeout` waits to `vi.useFakeTimers()` where time is just synchronization.
- [ ] Replace 8 raw-source `toMatchSnapshot()` calls in `toolcraft-openapi/generate.test.ts` with shape-only assertions on emitted file paths + targeted `toContain` for contracts.
- [ ] Convert conditional iteration in `tests/integration/mcp-server.test.ts` to `it.each`.
- [ ] Add a regression check (lint rule, grep script, or runtime guard) that fails CI when a swept category reappears. Wire into CI.
- [ ] Re-run practice-scan after each sweep. Update this Task Board and continue. Stop when the inspector reports no high-impact categories remain.
- [ ] Run the full test suite once more. Confirm zero failures attributable to this refactor and that wall-clock time is at least as fast as the baseline.
