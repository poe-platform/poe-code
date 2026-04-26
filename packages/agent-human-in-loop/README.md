## Overview

`@poe-code/agent-human-in-loop` is a UI-only package for asking a human "approve this?" before an agent proceeds. The UI is providerized, sync vs async is the caller's choice because the API returns a Promise you can await immediately or hold and resolve later, and the package is approval-only: decline returns a declined outcome and can optionally capture a reason.

## API

```ts
declare function requestApproval(
  args: ApprovalRequest & { provider: HumanInLoopProvider }
): Promise<ApprovalResult>;

declare function osascriptProvider(options?: OsascriptProviderOptions): HumanInLoopProvider;

declare function mockProvider(
  answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>)
): HumanInLoopProvider;
```

## Providers

- `osascriptProvider({ title?, binary? })` — macOS native dialog via `display dialog`. Mac only.
- `mockProvider(answer | thunk)` — fixed or scripted answers for tests.

## Env vars

None in v1.

## AppleScript escaping note

Messages and prompts are passed verbatim through the dialog; the provider escapes `"` and `\` for AppleScript string literals. Do not pass user-supplied AppleScript fragments expecting them to execute.

## Example

```ts
import { requestApproval, osascriptProvider } from "@poe-code/agent-human-in-loop";

const result = await requestApproval({
  message: "Run `rm -rf /tmp/foo`?",
  declineInputPrompt: "Why decline?",
  provider: osascriptProvider({ title: "Claude" })
});
```
