# Additional TEST-ONLY proposals

NOT APPLIED. See additional-test-only-proposal.json for immutable accepted-commit file snapshots, exact old assertions, proposed replacements, and evidence hashes. These four are separate from original22 and from the four newly accepted malformed-input labels.

- join-zero-arity and join-two-arity: original43 fixes now emit native multiline compiler context, so the old one-line regex fails. Exact legacy94 native vectors support both replacements.
- split/0: replace the old unsupported-function regex with exact native undefined-function context. Keep the split/2 flags rejection and no-input-acquisition guard unchanged; no flags stub or new regex feature is implemented.
- Host-thrown JqError on stdout: this is NOT a native-backed change. The old author test accepts conversion to status5; latest user requires sink exception identity and no extra writes. The source now rejects with the same exception, with no diagnostic write or replay, as it does for EIO, EPIPE and ordinary Error. This contract-backed proposal requires explicit independent review and is not quietly labeled a stale native expectation.

All four old tests remain read-only and red where their old expectations conflict; native evidence and author controls do not self-approve a TEST-ONLY followup.
