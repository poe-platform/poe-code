# Large terminal Markdown performance QA

Run this timing check separately from unit assertions. Shared host load can invalidate a wall-clock budget even when output is correct. The unit case retains one render of the complete 1,001-line fixture and verifies the final section and styled output.

1. Start a fresh Node process using the maintained tsx loader. Scope FORCE_COLOR=1 and POE_CODE_THEME=dark to that child.
2. Construct a document beginning with `# Large Markdown Fixture`. For each index 1 through 500, append `## Section <index>` and `Paragraph <index> keeps the renderer busy without adding exotic syntax.` Join these 1,001 lines with newlines.
3. Use the package's renderMarkdown at width 120. Render twice to warm up, then time three complete renders independently with performance.now. Verify every output includes Section 500 after stripping ANSI and contains SGR styling.
4. Record all three samples, host load and the minimum. The former budgets were 200ms locally and 500ms in CI. A budget miss remains measured evidence; do not increase the budget or call it a pass. Profile a repeat if the normal-load result misses its budget.
5. For changes to visible rendering, capture and inspect a terminal screenshot using the maintained Markdown demo and check its content/styles independently of timings.

Validated reason for separating timing: the repeated-render unit case took 1,173ms in isolation. Two full design runs under concurrent broad checks and noisy-tool QA measured minimum renders of 235ms and 436ms, failing the local 200ms assertion; isolation passed. Repeated warm-up renders now belong to this agent-executed QA plan, while unit coverage retains complete-document correctness.

Executed fresh-process source render under concurrent maintained broad tests/lint and native timeout QA: samples 197.83 / 258.64 / 149.73ms, minimum 149.73ms. All three outputs retained Section 500 and SGR styling. This satisfies the former minimum-of-three local comparison but does not establish a per-render 200ms maximum. Child-only color/theme settings left the parent environment unchanged.
