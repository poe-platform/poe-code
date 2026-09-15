# Legacy prompt resource-link conformance

Main-Node QA and the installed official SDK GetPromptResultSchema both prove resource links are legal in 2025-11-25 prompt content. This server rejected them as invalid prompt results. Two red server regressions reproduce rejection and verify connections negotiating 2025-03-26 and 2025-11-25 require separate admission behavior.

Retain the negotiated legacy version on each lifecycle. Permit modern and 2025-11-25 prompt links, preserve 2025-03-26 rejection, and keep version state isolated across message sessions. A maintained invalid-result fixture previously labeled a valid 2025-11-25 link invalid; move its older-protocol rejection check to 2025-03-26 while retaining malformed resource coverage.

Focused result/protocol regressions and the complete server gate follow. No README additions or delivery claims are made. A direct older-schema download was unavailable due DNS failure; the newer official SDK schema and concrete current-server rejection are preserved in /tmp/mcp-legacy-prompt-resource-link-qa-red.log.
