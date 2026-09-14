# Built playground user edge check

September 14, 2026; source main `63dc77190`. Python integration remains
blocked: the developed shared executor is absent from this checkout. No
product or README changes were made. Preserve unrelated work.

## Procedure executed

Read root and safe-bash AGENTS.md; no playground-scoped instructions exist.
Inspect engine registration/declarations/build integration, execution worker,
supervisor, filesystem RPC, protocol, samples, help, limits and maintained tests.
Follow the existing `safe-bash-playground-python-qa.md` procedure's prerequisite
and baseline checks; do not treat unavailable Python behavior as passes.

1. Build with `npm run build:workspaces -- --workspace=safe-bash-playground`.
   Serve `dist` locally and open `/site/`, exercising nested asset resolution.
2. In installed Chrome headless, submit script, inline, python3 alias, pipeline
   stdin, stdin program, module redirection, CPU loop and Python file-write
   commands. Record terminal output and timing.
3. Run sort pipeline, rg, ERE condition and Unicode shell sample. Create
   `edge.txt`, select it in the explorer, edit/save it, read it through shell,
   and download it. Compare downloaded bytes and hash.
4. Run an unbounded shell loop and then a recovery pipeline. Inspect help.
5. Reset a modified workspace and verify the transient file is absent and the
   shell sample remains runnable. Block the execution-worker asset, submit a
   command, restore asset access and verify subsequent shell recovery.
6. Capture and inspect screenshots. Keep the acceptance evidence separate from
   executable tests; browser automation was invoked ad hoc, not added as a QA
   script or screenshot test.

## Results and evidence

Chrome `152.0.7977.84`, macOS, 1440 × 1000. JSPI is available;
`crossOriginIsolated` is false. No Stop button exists. The initial browser
session recorded no console errors or page exceptions. The asset-failure
session deliberately blocks worker loading; its diagnostic is recorded
separately in the transcript.

All direct Python attempts return 127, including the purported CPU loop;
Python does not execute. The attempted guest file is absent. Combining that
failure with `cat guest.txt` returns 1 from cat. The shell module redirection
does not establish Python-generated output. A source public-API probe also
returns `ERR_PACKAGE_PATH_NOT_EXPORTED` for `virtual-bash/commands/python`,
127 for both Python aliases, and exact `recovered` from the subsequent pipeline.
Source has no Python family, injection option, pinned Pyodide runtime or shared
filesystem/executor contract. Integration cannot invent a second implementation
and still meet the requirement to share the developed executor.

Shell/regex commands and editor-to-shell visibility pass. Downloaded `edge.txt`
contains exact `edited in browser\n`, 18 bytes, SHA-256
`2ca798faf0783618319fc5c72d4780e4b5b28cbf1d4eb729f48e9f5e4a937b0f`.
The loop hits `maxCommands` in 3714 ms and subsequent shell execution succeeds.
This is a command-limit check, not external CPU preemption acceptance.
Reset removes the transient file and the restored Unicode shell sample runs.
Blocking the execution-worker asset returns `Execution worker failed`, exit 1,
in 14 ms; restoring access allows the next pipeline to return `recovered`.
The reset check waits for the visible fresh-sandbox status before submission;
an earlier automation attempt submitted before reset had finished and was
discarded as invalid evidence. An ambiguous dialog selector was also corrected
in the ad hoc browser procedure, without changing product code.

- [Command transcripts, capabilities, headers and artifact evidence](playground-user-edge-check-63dc77190/results.json)
- [Initial page](playground-user-edge-check-63dc77190/initial.png)
- [Editor visibility](playground-user-edge-check-63dc77190/editor-visible.png)
- [Editor save and download](playground-user-edge-check-63dc77190/editor-download.png)
- [Command inventory](playground-user-edge-check-63dc77190/commands.png)
- [Worker asset failure and recovery](playground-user-edge-check-63dc77190/failure-recovery.png)
- [Downloaded shell artifact](playground-user-edge-check-63dc77190/edge.txt)

Maintained playground unit route passes: 8 files, 223 tests.
Maintained workspace build closure passes with circular-chunk and large-chunk
warnings. No safe-bash code was changed; the public-API availability probe is
prerequisite evidence, not qualification of a Python implementation.

## Production and release acceptance

| Browser | Python | Shell/regex |
| --- | --- | --- |
| Chrome 152.0.7977.84 | Blocked: absent executor | Baseline verified |
| Firefox | Unmeasured, not accepted | Unmeasured |
| Safari/WebKit | Unmeasured, not accepted | Unmeasured |

Cold/warm interpreter loading, document generation/download, Python quota and
descriptor cleanup, Stop, active reset, navigation, unsupported-capability
diagnostics, interpreter asset failure and Python CPU termination remain
unaccepted. Actual hosted runtime headers, CSP, WASM MIME and URLs remain
unqualified; local document headers cannot establish hosting acceptance.
No Cloudflare adapter or service changes were made, and no Cloudflare
preemption guarantee is established. Missing required behavior blocks final
production acceptance. Execute the full existing Python procedure once the
shared implementation is provided, then include those results in production
review and repeat the required checks on actual hosting during release smoke.
Local evidence commit only; push/publication is deferred to final teardown.
