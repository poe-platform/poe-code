# Issue 734: browser-free Playwright CLI discovery

## Implementation

- Share command usage, argument counts and descriptions between parsing and help.
- Accept `--help`, `-h`, `help [command]` and `<command> --help`, including tab
  aliases. Help bypasses browser/session/argument prerequisites, but not unknown
  commands or malformed flags. Preserve literal `--` argument handling.
- Permit controller/plugin creation without an adapter for discovery; require
  an injected adapter before opening a browser. Keep help in the controller so
  CLI and direct SDK calls have the same behavior and cleanup guarantees.
- Describe sessions, lifecycle, tabs, refs, output destinations and unsupported
  commands. Do not imply complete upstream parity or implement new browser actions.

## Focused verification

1. Run the Playwright plugin/controller tests, including help with a configured
   acquisition spy and with no adapter. Assert exit 0, stdout and no acquisitions.
2. Verify command help without required arguments, artifact sinks or a valid
   session environment. Reject unknown help topics and cancelled requests.
3. Confirm quoted/literal help-like text remains ordinary fill/press input, and
   help does not open, close or replace an existing session.
4. Run changed-file lint and focused TypeScript checks.
5. Render the actual plugin help through the screenshot tool and inspect it;
   keep temporary output under `out` and remove it after inspection. The plugin
   is host-injected, not automatically registered by the root Bash CLI.
6. Commit only this issue's changes, push to main, verify remote delivery and
   close the issue. Monitor scoped Safe package and main release publication.

Leave full repository checks to GitHub Actions, per the user's request.
