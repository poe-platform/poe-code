# OAuth body failures must settle independently of cancellation

Review of the redirect cleanup defect found the same awaited-cancellation pattern in readBoundedResponseText. Four fast in-memory cases reproduced stalled admission errors for a pre-aborted signal, an oversized declared length, actual oversized bytes and invalid UTF-8. A fifth mid-read abort case already passed and remains covered.

Cancellation now starts without being awaited in those failure paths. Reader bookkeeping and locks are released promptly, while eventual cancellation rejection remains handled. The stream adapter owns its underlying cleanup completion; malformed or cancelled reads must not wait for that completion to report failure.

Red evidence: /tmp/mcp-body-cancellation-deadlock-red.log (four failures). Green reader, redirect, token lifecycle and discovery ownership evidence: /tmp/mcp-body-cancellation-deadlock-green.log. Repeat the complete protocol/OAuth gate, types, affected maintained builds and real artifact QA before delivery.
