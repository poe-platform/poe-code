# Agent Human-in-loop QA

## Checklist

- [ ] Approve path: run `npm run dev -- example` after the example task lands, click Approve on the first dialog, and verify the console logs `{ outcome: "approved" }`.
- [ ] Decline without prompt: click Decline on the first dialog of a request that has no `declineInputPrompt`, and verify the console logs `{ outcome: "declined" }`.
- [ ] Decline with reason: click Decline on the first dialog, type `because` in the second dialog, click Submit, and verify the console logs `{ outcome: "declined", reason: "because" }`.
- [ ] Decline with cancel-on-reason: click Decline on the first dialog, click Cancel on the second dialog, and verify the console logs `{ outcome: "declined" }` with no `reason` key.
- [ ] Quote-and-backslash safety: verify visually that a message containing `"` and `\` renders correctly in the dialog.
- [ ] Concurrency: kick off two `requestApproval` calls in the same tick, verify that two dialogs stack in the macOS UI, and verify that answering them in any order resolves the matching Promise.
- [ ] Verify that [README.md](README.md) parses as valid markdown.
- [ ] Verify that this file remains a checklist, not a script.
