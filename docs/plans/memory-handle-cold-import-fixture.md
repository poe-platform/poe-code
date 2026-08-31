# Memory handle cold-import fixture repair

Date: August 31, 2026

## Release blocker

Release run `33380895053` for `d0495894bc886e456430df3d08dc0b4415b856bf`
passes the repaired Maestro workspace, then fails the memory fixture
`returns an object with the full memory handle API` at its unchanged
five-second test deadline. Memory reports 206 passed and one failed;
schema run `33380895043` succeeds. Publishing is not reached.

## Causal evidence

The unchanged handle file passes 8/8 in an ordinary cold process, with
840 milliseconds in its first test. The full memory baseline passes all
207 cases in 29 files. The first test imports the real handle and its
dependency graph within its timed body.

A private Vite transform observer delays only the unchanged handle module
by 6.5 seconds and returns no replacement code. The original file then
reports the exact CI failure: the first test times out at 5000 milliseconds,
while the other seven tests pass. This is a controlled causal reproduction,
not a claim that every millisecond of the remote runner was profiled.

## Minimal setup change and isolation

Add a `beforeAll` hook that imports the genuine handle graph once. It uses
the existing configured hook deadline, with no timeout argument or config
change. The installed Vitest 3.2.6 Node defaults remain 10000 milliseconds
for hooks and 5000 milliseconds for tests.

Keep the complete existing `beforeEach`: volume reset, mock restoration,
`vi.resetModules`, and every `vi.doUnmock`. Keep every per-test dynamic
handle import after its own `vi.doMock` registrations. No static handle
binding is shared across tests. The warm-up prepares transforms; the
original resets still require fresh module evaluation for each test.

The existing binding test must still observe all nine mocked dependency
groups, followed by real two-root filesystem isolation and the three
independent agent-default/override mock cases. All original test bodies,
API assertions, mock factories, inputs and case identities remain intact.

## Required qualification

Require the same delayed-import reproduction to pass on Node 18.18.2,
22.22.2 and 24.14.0 under the unchanged hook/test deadlines. Repeat the
complete 207-case memory cohort in fresh processes with no cache and
compare all identities to the unchanged baseline. Verify AST preservation,
formatting, root types and normal commit/push hooks. No production, package,
concurrency, exclusion or deadline changes are authorized by this repair.

Keep original CI and controlled red logs. Actual publication and installed
artifact verification remain pending until the release workflow succeeds.

## Matched local results

The same 6.5-second delayed import passes 8/8 with normal exit on all three
Node versions. The original 5000-millisecond test and 10000-millisecond
hook deadlines remain unchanged. The entire ordinary 207-case cohort
passes in three fresh Node 22 processes and one each on Node 18 and 24,
with all 29 files, case identities and zero skips preserved.

AST comparison preserves the eight original handle test bodies, all 36
expectations, every mock registration and the complete per-test reset.
The formatter also requires whitespace-only normalization of the existing
`auditClaims` argument assertion; its AST, values and assertion are unchanged.
The earlier byte-identical-body checkpoint and initial formatting failure
are retained separately rather than overwritten.

The change is limited to this fixture and plan. Normal hooks, CI and actual
published-artifact verification still determine release success.
