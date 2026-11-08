# Known phase roles

This is an administrative command ledger, not a reconstructed OS-wide census.
Exec replacement is a role transition, not an extra child PID. No speculative
background process discovery or historical process probes were run.

| Call | Explicit roles |
|---|---|
| A01 | shell exec-replaced by startup Node; PID83152, START.json and direct-file collectors |
| A02 | shell; cat AGENTS context-only; cat START; find scoped instructions |
| A03 | shell; three sed reads; date; scoped git status |
| A04 | shell exec-replaced by sh; three sed reads; date |
| A05 | shell; two rg reads; two sed reads |
| A06 | shell; five sed reads |
| A07 | shell and apply_patch utility; first owner/preseal files |
| A08 | shell and apply_patch utility; owner correction/controller |
| A09 | shell; mkdir; cp; subshell and shasum; git add; shell exec-replaced by git commit |
| A10 | shell exec-replaced by controller Node93608; actual children93768 and93795, both closed |
| A11 | shell builtins only: bounded result display and clock |
| A12 | shell and apply_patch utility; this evidence handoff |
| A13 | publication shell; apply_patch for this literal census clarification; exact raw-file cp; exact owned git add; shell exec-replaced by exact owned git commit |

The enumerated command/exec ledger gives 47 explicitly identifiable process
launch roles after not double-counting exec replacement. Patch utilities may
have interpreter/wrapper descendants that were not recorded by PID; this is a
qualification, not permission to fabricate a complete <=48 census. Actual
controller/child telemetry is separate in RESULT.json and children.jsonl.
There were no asynchronous exec sessions, compilers, npm, Workers, loaders,
product imports, native oracles, network or private engines.

External startup capture exists for A01 and the actual PURE controller A10.
Other administrative tool responses were captured by the tool interface, not a
newly invented external file collector. That distinction is retained explicitly.
Phase-wide capture bytes/storage were not independently metered; the actual
owner controller enforced 64KiB child capture and its 60s total through local
result publication, inside START.json's finite total deadline. Source/owner
sealed files were reauthenticated after both harmless children. No global
resource, process-subtree, hard-preemption or product ownership claim follows.
