# MCP final verification

Scope: latest verified specification 2026-07-28; core stdio and HTTP servers, client, OAuth client/server, Toolcraft schema/CLI/SDK/MCP adapters, SafeJS managed transports, harnesses, memory, Poe tooling, and terminal MCP entries. Preserve earlier atomic plans and regression evidence.

Individual issue plans preserve red/green findings and historical checkpoints. The gates below record the current final verification state.

## Current verified state

| Gate | Evidence |
| --- | --- |
| Final frozen protocol and OAuth source/import gate | 2,356 tests, 111 files passed; /tmp/mcp-final-frozen-protocol-oauth-gate.log |
| Final frozen consumers | 15,638 tests, 430 files passed; /tmp/mcp-final-frozen-consumer-gate.log; Toolcraft namespaces/schema, managed MCP, all named harness families, configuration, memory/Poe and terminal/root MCP consumers |
| Final maintained consumer closures | agent-code-review 29 builds, agent-harness 24 builds (including eight SafeJS built-import checks), terminal-pilot-mcp 23 builds passed; /tmp/mcp-final-frozen-{code-review,harness,terminal-pilot}-build.log; closure membership derived by the maintained runner |
| Repository types and public runtime contracts | Passed after final artifact refresh; /tmp/mcp-final-frozen-repository-types.log |
| Final affected-source ESLint | Passed; explicit discovery, URI brackets, redirect/body/client settlement, SafeJS settlement/admission logs in /tmp/mcp-*-eslint.log |
| Workflow lint | Passed; /tmp/mcp-final-workflows-lint.log |
| Package lint after final root bundle refresh | All 17 rules passed across 73 packages; /tmp/mcp-final-frozen-package-lint.log; direct node --import tsx runner |
| Final repository ESLint | 14,070 files passed, zero errors/warnings; /tmp/mcp-final-frozen-all-source-eslint.log |
| Earlier broad consumer/schema checkpoint | 15,172 tests, 418 files passed; /tmp/mcp-current-wide-consumer-schema-gate.log; predates final format assertions and network admission changes |
| Real exhaustive harness QA | Complete coverage-demo fixture and every snapshot passed through built public assertReplayEquivalent, no LLM calls; final repeat 6,340 ms; /tmp/mcp-final-frozen-exhaustive-replay-qa.log |
| Final built managed HTTP QA | Public built makeMcpModule rejects reported redirects, buffered invalid UTF-8 and aborts; upstream reader locks release and close settles before intentionally stalled cancellation completes; /tmp/mcp-final-frozen-built-managed-http-qa.log |
| Terminal CLI QA | Both final built npm-style symlink aliases pass stderr-only help/error admission and modern/legacy protocol calls; /tmp/mcp-final-terminal-alias-protocol-qa.log; actual PNG output and help screenshots inspected |
| Root Markdown-reader CLI QA | Modern and legacy reads pass through built dist/bin.cjs; two tools, maintained frontmatter fixture, clean EOF exits; /tmp/mcp-final-root-markdown-composition-qa.log |
| Core package lifecycle | Final isolated maintained prepack/postpack succeeded with writable task-local npm cache; /tmp/mcp-final-frozen-core-pack.log; SHA-1 e9db7fa8efbcd30237b651c256fa246af4d8404c |
| Final maintained PNG closure | Four builds passed; /tmp/mcp-final-frozen-terminal-png-build.log |
| Final declared root bundle stage | Passed; /tmp/mcp-final-frozen-root-bundle.log; not a full npm run build pass |
| Offline-installed core runtime | Final artifact installs offline; bracket URI/resource and extension admission passed; /tmp/mcp-final-frozen-core-offline-install.log and /tmp/mcp-final-frozen-installed-core-qa.log. Earlier installed-artifact checks covered modern discovery/cache, scalar/null/array outputs and legacy output projection |
| Diff formatting | git diff --check passed |

## Remaining gates and limits

The maintained npm test route reported Safe Python codec/dictionary failures and stopped making progress. It was interrupted with SIGINT and exited 1: /tmp/mcp-final-delivery-maintained-npm-test.log. This is not a pass. Unrelated concurrent Python changes were preserved.

A broader affected-consumer run was interrupted after runtime QA exposed additional cleanup fixes: /tmp/mcp-final-all-affected-consumer-gate.log. It picked up in-flight red tests and also reported three five-second SafeJS checkpoint timeouts. Those checkpoint suites passed all 33 tests in a separate isolated run without code changes: /tmp/mcp-final-checkpoint-timeout-reproduction.log. The mixed-state broader run is not a final passing gate. The frozen consumer gate above supersedes its MCP verification; it does not claim complete SafeJS interpreter coverage.

The final maintained repository npm test route reported Safe Python codec/allocation failures, then remained active without a terminal summary despite extended observation. It was interrupted with SIGINT and exited 1 before delivery: /tmp/mcp-final-frozen-maintained-npm-test.log. No passing full-repository test claim is made. No MCP-specific failure reports were found in that log; the separate frozen protocol/consumer gates passed all 17,994 tests. Final repository ESLint passed as recorded above.

Full npm run build previously failed at the github-workflows tsx IPC socket sandbox restriction. Successful selected closures and the declared root bundle stage do not constitute a full build pass. Fresh external dependency installation remains blocked by registry DNS; the self-contained bundled core did install offline successfully.

The external Inspector smoke suite is opt-in and requires the published Inspector plus an HTTP listener. It was not enabled or counted as a passing case. Inspector interoperability and real TCP deployment remain unqualified in this sandbox. Historical root mcp serve references do not describe the current CLI: current entries include standalone memory and Markdown-reader services plus agent MCP spawn configuration.

Redirect admission forbids implicit fetch redirects and rejects reported redirected responses. It does not implement DNS/address-range policy or prove that an injected adapter is honest. Metadata deadlines require fetch adapters to honor their supplied signals; body cancellation is enforced by the bounded reader.

Proposed format documentation is prepared in mcp-metadata-key-format-conformance.md. README additions remain unauthorized and were not made.

The user subsequently approved the tiny-mcp-client HttpTransportOptions maxResponseBytes configuration row. That single README addition was applied and passed git diff --check; other README proposals remain unapproved.

## Delivery

Existing local MCP commits run from faa3b62df through 7271be8fd. Additional validated improvements remain in the working tree. Automatic approval review rejected Git commit escalation and elevated localhost testing; do not retry or bypass those blocks. No push was requested. Remote main delivery and release publication have not been verified.

The goal timer exceeded nine hours (32,403 seconds at the final timing check) before delivery. All validated MCP fixes have final focused verification and the qualified artifact/build evidence above. Additional fixes remain uncommitted because Git escalation was rejected; README additions are prepared in mcp-readme-updates-proposal.md awaiting permission. This document records evidence, not a certification of unrestricted production readiness.

## Authorized release continuation

The user requested release and enabled unrestricted filesystem and network access. GitHub access and Git writes now work. Remote main was fetched and merged cleanly, preserving unrelated working-tree changes. Maintained npm test and npm run lint were started again with the current remote quarantine/CI fixes. Evidence is recorded in /tmp/mcp-release-npm-test.log and /tmp/mcp-release-lint.log. Local delivery commits, remote-main verification, and publication remain separate gates until each finishes.

### Release pre-push verification

Remote main advanced again to e3e205260 and merged cleanly. No overlapping MCP source changes were imported. The normal npm run build then passed, including every workspace and root bundle/schema suffix stage: /tmp/mcp-release-normal-build.log. Repository npm run lint passed on the merged tree: 14,116 files, zero ESLint errors/warnings, types, public contracts, and workflow lint; /tmp/mcp-release-merged-lint.log.

The first maintained npm test passed 115,578 shared tests, Safe Python's 851 native tests, and Python-spawn's 29 tests, then reproduced one Darwin raw-path oracle mismatch. The existing trailing-directory filesystem contract was preserved by correcting that test expectation, documented in release-native-traversal-oracle.md. The isolated traversal suite passed all 20 cases. The subsequent maintained virtual-bash workspace unit run passed 31,684 tests, zero failures/cancellations, and 86 declared skips: /tmp/mcp-release-virtual-bash-final.log.

A final maintained npm test after the merged-tree build passed 115,788 shared tests but reported eight timeouts in Python codec files and a Git fixture command, exiting 1 before subsequent native workspace tasks. The Git configuration command took 63 seconds in that run but passed in 651 ms in isolation; two codec cases passed in 156/361 ms. All eight complete affected files then passed all 2,078 tests using one worker and unchanged time limits: /tmp/mcp-release-affected-timeout-suites.log. These results do not claim a single successful final full npm test command; the final broad log remains /tmp/mcp-release-final-maintained-test.log.

Actual TCP QA with the built client and server passed 80 concurrent-batch calls for each protocol, 2026-07-28 and 2025-03-26, checking every payload and closing clients/listener. The installed official MCP SDK separately passed 20 real TCP calls and clean shutdown. A real disconnect reached the server handler AbortSignal and a following request succeeded. Evidence: /tmp/mcp-release-real-tcp-qa.log, /tmp/mcp-release-official-sdk-tcp-qa.log, /tmp/mcp-release-tcp-disconnect-qa.log. This qualifies these loopback TCP/interoperability scenarios; external Inspector and real deployment remain separate qualifications.

The maintained CLI screenshot command passed separately after tests ended; screenshots/help.png was inspected for layout/readability. Its first overlapping-build attempt failed and is not counted as a pass. Final screenshot evidence: /tmp/mcp-release-cli-screenshot-final.log. Package lint must run after this screenshot build replaces dist artifacts; an overlapping attempt reported a missing in-progress SafeJS dist directory and is not counted as a pass.

The remaining MCP implementation and authorized README addition were committed as separate focused commits. Git history merges preserve existing local and remote commits and unrelated working-tree files. Push and publication are still pending at this checkpoint.

Final package lint after the separate screenshot build exposed a cross-package private store import in the newly merged agent-spawn test. The six-case callback regression was simplified to use the public stream contract and stable preview IDs; its maintained workspace unit command passed all 561 tests in 24 files, and changed-file ESLint passed. Package lint now passes all 17 rules across 73 packages: /tmp/mcp-release-final-package-lint.log. See release-dashboard-test-package-boundary.md and /tmp/mcp-release-agent-spawn-unit.log. The normal build and repository lint were completed before these test-only corrections; production source is unchanged afterward.
