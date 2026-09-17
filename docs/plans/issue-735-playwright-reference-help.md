# Issue 735: preserve the official Playwright CLI help

## Scope

Use the actual `@playwright/cli@0.1.20 --help` output as the pinned presentation
reference. Preserve its preamble, both usage lines, all section headings,
command/option spellings, target terminology, descriptions and spacing.

Append `[unsupported]` to unavailable commands and global options, and `[limited]`
to supported commands whose target or optional argument forms are restricted.
Explain these markers before the command sections. Keep detailed restrictions,
session precedence/lifecycle and host limits in separate compatibility notes.
Do not enable unsupported commands or enlarge parser arities just to match help.
Derive displayed command syntax from the pinned reference instead of maintaining
a second set of renamed command descriptions.

Storage, Network and WebMCP remain unavailable in this change. The separate
Storage/Network adapter investigation must not be presented as implemented support.

## Verification and delivery

1. Capture the real pinned upstream executable's browser-free help under `out`.
2. Compare the full normalized public help with an independent committed fixture;
   remove only explicit availability annotations and appended compatibility notes.
3. Assert every unavailable entry is marked and target/button limitations are
   documented while execution of unsupported forms still fails without effects.
4. Run only focused Playwright tests, changed-file lint and focused type checks.
5. Screenshot and inspect the actual plugin help and representative command help.
6. Commit this issue atomically, push to main, verify remote delivery and close
   the issue. Monitor GitHub publication and verify npm visibility/artifact content.
7. Remove temporary captures, dependencies and screenshots after use.
