# Remote MCP persisted transaction QA

Execute these steps as an agent after building the selected native client closure.
Temporary fixture modules, synthetic encrypted credentials and results belong in
`out/remote-mcp-lock-qa`; remove them after inspection. No production credentials
or services are used.

1. Run a local synthetic token endpoint with a single-use rotating refresh token.
   Seed an expired grant through the public native session-store API.
2. Start two independent Node processes with separate native provider/store
   instances targeting the same encrypted backing identity. Both must authorize
   with the persisted winning access token; the endpoint must report exactly one
   refresh redemption. Inspect the resulting encrypted file and claim directory.
3. Hold one file transaction in another process. A contender for that identity
   must time out without entering. A different file identity must enter while
   the original owner remains active.
4. Terminate the holding process, then acquire its identity from a fresh process.
   The dead owner's unique claim must be recovered. Live-owner claims must never
   be stolen because their age exceeds a timeout.
5. Deliver a delayed 401 for the old grant from a fresh provider. It must reuse
   the persisted winner without a second refresh redemption.
6. Inspect claim names and contents: only PID, random identity and numeric ticket
   metadata may appear; no token or client credentials. Record observed results
   in the main remote MCP progress ledger and purge the fixture directory.
7. Repeat with the synthetic endpoint holding its response after recording a
   redemption. Kill the requesting process before it receives the response.
   A fresh process must recover the dead filesystem claim but refuse to replay
   the pending refresh. Check that the endpoint still reports one redemption
   and the stored tokenless session retains the original client and pending
   refresh marker, even when the new provider also receives the initial grant.
