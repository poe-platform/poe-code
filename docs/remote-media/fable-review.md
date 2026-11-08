# Fable review of the remote media plan

Reviewer: Claude Fable 5.1, invoked through the user-requested `poe-code spawn`
command on 2026-09-14. Read-only review of the plan, website, evidence and current
code. No implementation or deployed qualification was performed.

Review session: `2b02d9f7-9f30-4178-ae44-5ce70f2f3d03`.
Spawn log: `/Users/kjopek/.poe-code/spawn-logs/20260914-162348-128-claude-code-9155b31e-a5f8-45d6-8bbd-8cdc7d00e146.jsonl`.

## Verdict and changes

Fable judged the core shim/API architecture feasible but the prior plan not executable
as written: it duplicated native CLI responsibilities, lacked a Worker-host task,
and left the engine interface insufficiently explicit. The revised plan addresses:

- JavaScript parses for dependency discovery and transfer. Stock native executables
  own validation, diagnostics, processing and exit status. Discovery must not trigger
  premature errors, duplicate execution or independent reads of one-use inputs.
- No custom native media-operation ABI or JS-maintained native image state. Runtime
  filesystem mediation supplements the shims and covers dynamically discovered names.
- Explicit streaming MediaCommandEngine contract, shell-accounted filesystem access,
  optional inherited handles and ownership/cleanup rules.
- Dedicated Worker host task: workerd imports, authenticated routes, Sandbox binding,
  canonical filesystem selection, bounded streaming, session ownership and recovery.
- Explicit Linux/native-tool prerequisite for the feasibility proof. Current local
  tooling does not satisfy it. An authorized runtime must exist before that proof.
- Terminal proposals in older evidence are marked rejected. Noninteractive stdin,
  EOF, overwrite responses and cancellation get their own native qualification cases.
- Signal-only termination is distinct from a native signal handler returning a code.
- Explicit execution order while retaining scalar-open, stepless tasks.

## Recommendations not adopted as scope reductions

Fable suggested default close/exit-time publication and excluding advanced filesystem,
network and descriptor behavior. These conflict with the user's requirement that all
noninteractive behavior work correctly. Earlier native probes also establish that
partial effects can precede failure. Those requirements remain open engineering work;
unsupported backends cannot be advertised as fully compatible.

The Worker need not use R2 as its only canonical backend. Object storage alone does
not provide POSIX semantics; an adapter must enforce the required guarantees. Direct
scoped blob transfer is an optimization when supported, not a prohibition on bounded
Worker streaming. Cloudflare-bound and container-only adapters have separate imports.

A generic 128+signal projection must not replace an explicit native exit code. The
local FFmpeg evidence includes native exit behavior differing from that assumption.
The review also described all oracle commands as using -y; the recorded overwrite
refusal case actually removes -y and supplies -n. All seven use -nostdin, so additional
stdin tests are still necessary.

## Remaining proof gates

Custom runtime filesystem mediation in the selected Cloudflare Sandbox image,
backend coherence, binary full-duplex transport, long-job recovery, native ImageMagick
fixtures and provider capability combinations remain unverified. Review and schema
validation do not establish full compatibility. The plan remains draft and planning-only.
