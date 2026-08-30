# Independent zero-count contract freeze

Frozen before candidate marker/source review; no author new tests or expected
answers consulted. Authority: user assignment, read-only scope memo, and public
types/contracts/exports. Baseline is immutable bdb49bb1c2b2c5646e1ed8666bf53ebf3bb6433c;
initial live HEAD observed 7deed0a2176c24c5c7c7b0562d5c50be59c82366.

`profile.mjs` fixes deterministic response sequences, host caps, CLI caps, bytes,
exit codes and request/authorization/disposal/upload-read denominators. Execute
each case through public direct commands and real Shell.use(networkCommands),
then repeat from a packed, moved, offline-installed package using root and network
subpath imports. Positive-host CLI-zero cases preserve baseline behavior; baseline
host-zero rejection is a configuration limitation, not an authorization bypass or
passing zero execution. No replay/open/read beyond authorized actual requests.

Validator profile: both counts accept 0, -0, 1, MAX_SAFE and defaults; reject -1,
fraction, NaN, infinity, unsafe integer, null, string and explicit undefined.
Every other host limit retains positive minimum; maxTimeMs retains 2147483647
ceiling. All exact defaults are frozen in profile.mjs. Authorization is per actual
request/hop with truthful attempt and redirect provenance. Both zero allows one
initial request per URL, not one request per whole command. Caps are independent.

All cases request status writeout separately from body bytes. Successful 429/503
at zero reports initial status/body; fail variants return 22 with corresponding
body suppression. Followable 307/308 at zero with -L returns 47. Injected generic
transport Error preserves its message/identity where API exposes it and maps to
existing exit 7, without retries even at positive caps. Abort checks cooperative
settlement and response cleanup, not opaque hard preemption. Runtime observations
will record actual public abort representation without inventing a new ABI.

Transport is entirely injected/offline; ambient fetch and native HTTP connection
entrypoints must throw. No native curl, provider credentials, external data or
product subprocesses. Harness build/pack/Node children are bounded and reaped.
Mutation negatives should disable zero validation and independently suppress a
positive retry/redirect to ensure controls reject blanket refusal. Immutable
candidate archive and complete file-namespace hashes must match before/after;
no live overlays, old Sagan prototype or historical gate certification.
