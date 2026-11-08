# ONE Bash3.2.57 readiness — preexecution protocol

ROOT20min/40ALL/peak3/32MiB capture/128MiB working. This is the sole new fixed builtin program authorized by the latest grant, not F01/D03 replay, the historical log query, native9/40, GNU5.3 or any product execution. Old groups/logs/records are never observed here.

## Source and trusted observer

controller.mjs runs once as an ordinary standalone pinned Node22.22.2 controller, with exact argv and empty execArgv. It imports group-observer.mjs, which explicitly imports kill from node:process; it never relies on the REPL/global process shim. The adapter is NOT imported into the REPL. observer-state.mjs is pure DATA and is the only observer implementation executed for eight presealed synthetic controls. Its bounded primitive error fields preserve presence, absent/accessor/over-limit cases, and present/absent/unknown. No error message/stack/private data is copied. Node is the outside capture controller, not a new Node readiness target.

Parent source/tool authentication precedes controller launch; trusted outer stdout/stderr capture precedes its imports. Controller opens owner events and exclusive regular target stdout/stderr before source/tool admission and Bash launch. The known target and listeners are enrolled before subsequent fallible capture helpers. Timers and signal attempts are target-owned, TERM/KILL are each at most once, and independent finally cleanup retains the primary error while recording secondary failures.

## Exact target and fence

PLAN.json defines sandbox-exec -f with the exact fixed Bash argv, six-key fresh environment, owned empty HOME/TMP/PATH/cwd, no startup variables/functions, and stdin empty. Sole program: builtin printf "%s\n" SAFE_BASH_REFERENCE_READY. Expected stdout26bytes, stderr0, status0; expected bytes are not an observation.

PROFILE.sb.data is a literal-only substitution of historical D03 profile cd24747ce2db626904e4c6c3986e6a303a85dada923a9dc1e6e8496dee9a93a5. PROFILE-DELTA.json lists every changed occurrence. Node/fixture read identity becomes /bin/bash; Node-only home metadata ancestors become /bin; owned case/capture ancestors are rebound. All operation syntax, system-read literals and sysctl names stay identical. Deny default/network/fork stays. No libncurses, Mach, extra library or broad host/home/tmp permission is introduced.

Sagan ff2ebe44's three closure artifacts and19 physical tool/cache/loader identities are reauthenticated. The5,909,077,919 streamed bytes are not copied into working storage; buffer256KiB. Bash declares libncurses.5.4 and libSystem and /usr/lib/dyld. These are load-command names, not actual loaded-image proof; ncurses declaration alone does not establish a required extra filesystem permission. Existing cache hashes are preserved, not falsely upgraded to image-membership proof. Local Bash3.2.57 version comes from prior822e82a70dfebc071d3b6e27bc78967afa40a993; no --version repeat.

## Physical ownership and limits

Fresh target namespace /private/tmp/safe-bash-reference-readiness-v1-abpaov; regular files stdout/stderr preopened O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW0600, one link, path/FD identity checked. Child fd0 is empty pipe,1/2 inherited regular descriptors,3 unused observer pipe. Completion records actual child exit/close, stdin finish and fd3 EOF; regular outputs NEVER claim streamed stdout/stderr EOF. Postclose fsync, bounded readback/hash and owner close are distinct.

Target active3s, TERM2s/KILL1s, hard observation6.5s; independent exceptional-path cleanup can report unknown, never guarantee hard OS retirement. Each regular output64KiB sampled every20ms, expected fixed26bytes, owner events1MiB; these are logical/source/sampled bounds, not kernel filesize/RSS promises. Parent phase deadlines and limits still govern. One outer controller and one intended sandbox-exec→Bash exec target, no declared target fork/Worker; newly registered administrative calls count toward40. Known peak3 includes the persistent coordinator. No kernel-wide descendant census is claimed.

SIGABRT/nonzero/capture/integrity/unknown group or retirement/cap failure terminates this sole diagnostic. No retry or profile widening. A successful return would only establish this one Bash3.2.57 readiness tuple under this profile; further nine-provider/fourty-semantic/GNU5.3 steps require new independent qualification/grants.
