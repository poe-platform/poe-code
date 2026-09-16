# Pipeline status footer QA

Use the external fake Codex agent setup in [pipeline dashboard QA](pipeline-dashboard-qa.md), with a fresh temporary plan for each run.

1. Run the actual CLI with `--agent codex --model gpt-5.2 --tui --no-archive`, using the cancelled fixture scenario to keep output streaming.
2. Capture the running CLI with `npm run screenshot-poe-code` at 120×40 and 50×16. Verify the bottom line displays the working directory on the left and `codex · gpt-5.2` on the right, beneath the keyboard hints.
3. Verify clipping preserves borders and both output and hints remain readable in the narrow capture.
4. Confirm automated pipeline callback checks update the footer from the actual stage agent, model, and directory; renderer checks cover unspecified models and Unicode clipping.

Validated on 2026-09-16: actual CLI screenshots inspected at 120×40 (`/private/tmp/pipeline-footer/wide.png`) and 50×16 (`/private/tmp/pipeline-footer/narrow.png`). Both retain readable keyboard hints, the working directory, and `codex · gpt-5.2`; the narrow directory clips without touching the border. Captures used the existing external fake Codex fixture and temporary plans, with no LLM requests.

Failing tests reproduced the missing context before implementation. All 1,872 design package tests and 98 pipeline command tests passed, including dynamic stage agent/model/directory updates. Design package lint, affected CLI ESLint, repository type checks, and the screenshot command's workspace build and bundle passed.
