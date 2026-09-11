# Issue 708: bounded portable grep match extraction

## Required behavior

Extend the package-owned bounded provider so `grep -o` extracts matches for its
supported fixed-string, BRE, and ERE profiles. Preserve original bytes and
offsets, leftmost-longest non-overlapping output, selected-line exit status,
empty-match behavior, and existing command flags. Keep unsupported dialects
explicitly rejected; this issue does not implement case folding or extend BRE.

The current provider explicitly refuses every `all: true` row. Reproduce that
refusal with direct provider and real portable-shell tests before implementation.
Include the literal giraffe and ERE URL examples from the issue.

The direct provider and shell regressions reproduce the refusal on current
source. The maintained public browser fixture also fails against a fresh
registry install of 0.1.510 with exit 2 and the explicit all-match refusal;
native C-locale grep extracts the issue's literal and URL examples successfully.

## Resource and lifecycle requirements

Admit explicit per-line and aggregate request match limits before retaining
ranges. Retain independent result-byte, work, allocation, input, pattern, and
state bounds. Charge all enumeration work to the existing request ledger; no
budget reset per match, unbounded repeated scanning, or native RegExp fallback.
Budget exhaustion must fail rather than silently truncate matches. Preserve
cooperative cancellation, owned input snapshots, awaited retirement, exact
error identity, and output backpressure.

Cover the dense-match allocation and enumeration-cost failure described in
issue 596, including refusal before oversized result construction. Test empty
matches, repeated matches, multiple patterns, boundaries, byte offsets, no-match
status, limits, and cancellation against concrete native-oracle controls.

## Implementation ownership and validation

The provider worker owns matching implementation and direct regressions. The
command worker owns shell integration regressions and any necessary command
wiring. An independent reviewer checks semantics, accounting, and adversarial
cases. Root owns this plan, maintained documentation, test inventory, integration
checks, Git delivery, and release verification.

Run focused regression and strict type checks, then maintained package/workspace
checks appropriate to the final change. Build the normal workspace outputs and
run guarded root lint serially after source edits and other checks finish.
Inspect a CLI screenshot where output changes are visible. Verify installed
package consumers on Node, Bun, browser, and actual workerd. Commit explicit
paths, push main, monitor every triggered release, verify fresh registry installs,
and close the issue only after successful publication.

## Implemented design and focused evidence

Fixed matching retains KMP failure links. Each pattern caches its next candidate
or completed no-match search, avoiding repeated scans of an unchanged suffix.
ERE extraction binds a validated immutable subject to a cursor matcher, preserves
original anchors, and returns spans without materializing unused capture strings.
All searches share the existing request ledger. Default per-row and per-request
match counts are 128; the existing 2,048-byte result default also permits 128
pairs. Independent hard ceilings and allocation admission remain enforced.

Count, quiet, filename-only, and inverted-selection flags now request selection
when no extracted ranges will be printed. This fixes concrete limit failures in
those combinations without changing the existing output branches.

Provider, portable executor, and ERE accounting checks pass 110 tests with strict
TypeScript validation. Independent review passes 92 ERE accounting and shell
security tests, including ordinary captures and BASH_REMATCH. Review confirmed
authentication before subject processing and charged every literal candidate,
including candidates discarded during cross-pattern selection. Broader gates
and installed-runtime verification remain separate required evidence.

The broader suite exposed an existing public Node-worker test that used `-oc`
to trigger the 100,000-match enumeration ceiling. Count mode now intentionally
requests only selection. Move that public boundary check to actual `-o` output,
validate its bytes incrementally, and add `-oc` above the enumeration boundary
as a passing selection control. Preserve all direct worker row/reply boundary
tests and every worker/client cap. This changes the old test's trigger to match
the operation whose resource bound it verifies.

## Candidate validation

The full maintained `npm test` run passes after the two documented test
corrections: 20,366 shared tests, 29 Python tests, 303 Safe Bash runner tests,
22,841 Safe Bash tests, 21,657 SafeJS tests, 288 terminal tests, and two post-test
lint stress tests. Existing skips remain reported separately by their runners.
The earlier overlap-cancelled run and failing runs remain separate evidence.

Three packaged candidate artifacts at 0.0.0-issue708 pass 22 checks each on Node,
Bun, browser, and actual workerd, plus strict Node/browser/workerd type profiles.
The maintained public browser fixture also passes against installed artifacts.
An inspected terminal screenshot verifies literal/ERE/UTF-8 extraction, line
prefixes, resource refusal, and count-only behavior. These candidate results do
not establish registry publication; release verification remains required.
