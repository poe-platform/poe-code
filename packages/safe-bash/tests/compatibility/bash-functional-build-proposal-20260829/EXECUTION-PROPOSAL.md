# Proposed execution and approval contract — ALL ACTUAL UNRUN

This document is a proposal, not an implemented launcher. P2 is not resumed.
`PROPOSAL.json` is the machine-readable argv/environment/limit companion. Its
owner executable and additional utility bindings are deliberately unresolved
blockers, not guessed executable identities.

## Fresh physical layout and source handling

Proposed canonical root B is
`/private/tmp/safe-bash-functional-reference-20260829-01`; its possible /tmp alias
is data only until a later lstat/realpath admission. Refuse an existing root or
unexpected ancestor/link. This task created neither location. A later grant must
name B and the exact owned evidence destination
`tests/compatibility/bash-functional-build-proposal-20260829/runs/functional-01`.

B contains source, build, home, tmp, cache/clang-modules, bin and out. Use fresh
0700 directories and umask 077. Preserve the old signed staging tree read-only
by policy; never build in it. Before copying, reauthenticate signed archive/patch
bytes and preserved signature authority against the bound hashes; check full
source membership/types/bytes against the 1,602-entry inventory. Copy only
admitted regular source files/directories, no links/special files/instructions.
Hash the bytes actually copied; check full destination membership and source
poststate. Preserve COPYING and notices; no upstream source enters the product
or a repository shipping dependency. If staging is missing/changed, HOLD: do
not silently re-extract or re-patch. A new decode would require the compressed
size/hash before inflation plus the earlier bounded tar policy and fresh approval.

Restore only original owner-executable bits: 0600 files become 0700 only where
the inventory declares owner x; directories remain 0700. Freeze observed source
mtimes before copying and preserve them; explicitly inspect parse.y/y.tab.c
ordering. Mtimes are not covered by the existing content-inventory hash. No
retimestamp-to-skip, source rewrite, parser regeneration or alternate tools are
implied. This single-user permission setup is not immutable-source containment.

B/bin is an explicit basename-to-pinned-host-target alias table, based on the
41 P2 rows in HOST-TOOLS.json, never the whole /bin:/usr/bin or a user PATH.
Aliases, if symlinks, are limited intentional references to those host paths;
source copies remain regular. Preserve ranlib argv0 and its libtool target.
Do not replace compiler binaries with copied files that break their resource/
loader lookup. Additional source-called absolute tools need a versioned binding
and approval before launch. No guessed alias or installation.

## Complete child environment and commands

Construct a new environment object from empty, with exactly the 26 keys/values
in PROPOSAL.json. HOME/TMPDIR/TMP/TEMP/PWD/PATH point into B; LANG=LC_ALL=C, TZ=UTC,
TERM=dumb, HISTFILE=/dev/null, CONFIG_SITE=/dev/null, CONFIG_SHELL=SHELL=/bin/sh.
XDG_CACHE_HOME and CLANG_MODULE_CACHE_PATH name owned locations. They request
cache locations; they do not prove that every Apple/OS cache honors them.

CC and CC_FOR_BUILD are the following **unchanged proposed** command string:

`/Library/Developer/CommandLineTools/usr/bin/clang -isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk -resource-dir /Library/Developer/CommandLineTools/usr/lib/clang/21 --ld-path=/Library/Developer/CommandLineTools/usr/bin/ld -mmacosx-version-min=26.4`

CFLAGS=CFLAGS_FOR_BUILD=-O2; AR/RANLIB/MAKE and DEVELOPER_DIR/SDKROOT are exact
CLT paths; MACOSX_DEPLOYMENT_TARGET=26.4. The resource directory name does not
prove an executed clang version, flag support or successful deployment. No
BASH_ENV, ENV, exported functions, SHELLOPTS, MAKEFLAGS, ac_cv_* answers, locale
injection, DYLD_*, LD_*, NODE_OPTIONS, user include/library/pkg-config flags,
credentials, proxy variables or ambient developer settings are inherited.
Unexpected platform-added environment must be assessed without dumping secrets,
not silently permitted. No login/interactive shell or user startup is requested.

stdin is /dev/null, no tty; separate stdout/stderr raw collectors are opened by
the outer owner before fallible child admission. Future phase startup is the
fixed trusted wrapper argv documented in PROPOSAL.json: /bin/sh -c sets umask
077, sets core limit zero or exits 125, then execs the literal phase argv. It is
not user-script interpolation. Its exact source/argv and the /bin/sh selector
(/bin/bash) must be freshly authenticated before use. Wrapper startup is UNRUN.

All phase cwd values are B/build. Literal inner argv:

1. `/bin/sh B/source/configure --prefix=B/out --cache-file=/dev/null`
2. `/Library/Developer/CommandLineTools/usr/bin/make -j1 bash`
3. After output authentication only:
   `B/out/bash-5.3.15 --noprofile --norc --version`

B denotes the literal fixed path above, not a shell variable inherited from a
caller. No --disable-* options, install, documentation, test or native observation
suite. Configure's nonempty CONFIG_SHELL avoids its alternate-shell search
branch (configure:120–143); CONFIG_SITE/cache choices suppress site/cache input
(configure:2647–2691). These are source findings, not startup observations.

## Actions actually authorized by a future functional trust decision

Configure reads signed shell/source/templates; runs source config.guess/config.sub
and generated config.status; writes config.log, conftest source/objects/executables,
config.h and Makefiles under build/tmp. It executes shell utilities, the selected
compiler/linker and generated feature probes, including expected failures.
Make runs recursive makes and shell recipes, compiles/archives/links bundled
libraries and shell objects, generates version/signal/syntax/builtin/pipe-size
outputs, and links bash. It may run conditional helpers according to the
configured graph. `bashversion` is the .build helper, not a full Bash oracle.

Approve these generated executions by authenticated-source recipe trust. Their
bytes can be recorded after generation when retained, but repeated deleted
conftests are not retrospectively all authenticated, and no pre-generation hash
is available. Shell inline code and host-tool subprocesses are within this trust,
not protected by an executable-path list. Unknown observed extra dependencies
or outside effects stop the attempt. No prevention of unobserved effects is claimed.

The trusted read domain includes the selected CLT binaries/libraries, SDK
MacOSX26.5.sdk, clang/21 resources and OS loader/system services they ordinarily
need, plus admitted source and owned outputs. This is explicitly not P2's exact
476-file read fence or a closed SDK. No private/user content or network operation
is requested; such effects are forbidden by task policy, not prevented by this
unsandboxed profile. If prevention is required, this profile cannot be approved.

## Supervision and limits to approve, not proven quotas

Request one attempt, no retry, 2,700 s from actual external-owner entry through
retirement/publication: admission 300, owner qualification 240, configure 900,
make 900, output metadata/version 60, cleanup/publication 300. All phases share
the same monotonic remaining deadline; cleanup is reserved. Pre-owner tool
scheduling/startup is outside that measured interval and must be disclosed.

Request <=48 directly enrolled starts and <=3 simultaneous direct owner/phase
processes. Configure/make descendants are **additional, unknown in number and
peak**; do not report 48 ALL starts or peak 3 ALL processes. make -j1 does not
provide those bounds. There is no inherited P2 16,384/peak16 enforcement claim.
If ROOT insists on a hard all-process ceiling, do not launch this profile.

Parent-collected capture: <=128 MiB combined, <=8 MiB per general stream; version
<=64 KiB per stream and 3 s. Collector admission must check before storing bytes,
handle short/zero writes, and record truncation/failure as nonacceptance rather
than silently drop output. Kernel/tool-internal buffers are not this ledger.
Work: 2 GiB logical stop threshold including source/build/cache/captures and
publication copies, monitored by bounded census; possible between-sample growth
is explicitly not a hard disk quota. A cap breach or uncertain capture is STOP.

An independent outer watchdog must be armed before a phase spawn; enroll
returned child and close/error handlers immediately, before fallible publication.
Use a dedicated session/PGID, retain PID/PGID receipts, signal TERM to the known
group, then KILL after 2 s; observe direct close/group outcome for at most 5 s
within reserved teardown. Attempt cleanup independently preserving primary and
secondary faults. The known-group receipt must not be inferred from top-level
exit alone. Do not use a timeout Promise.race that abandons live work.

No claim of arbitrary-transitive discovery, OS pre-fork quota, escaped-group
retirement, whole-tree reap, or hard cleanup completion. If direct close/group
retirement is unknown, preserve ownership/evidence and request intervention;
never publish CLEAN or rerun. If the external owner dies, outer tool custody
must retain the known groups; a plausible watchdog design alone is not proof.
The exact supervisor/launcher and bounded harmless failure controls remain
unimplemented and require independent pre-execution review.

## Output acceptance and closure

Require zero configure/make top-level exits, complete captures, authenticated
source/tool poststate and known-resource retirement. Record actual configured
features and ignored optional diagnostics separately; do not erase them to call
the run clean. Hash and size the regular B/build/bash; bind generated config.h,
Makefiles, config.status/config.log and surviving helpers. Then copy the same
authenticated binary bytes to B/out/bash-5.3.15 and bind load metadata from the
previously pinned llvm-otool under a separately sealed argv. Metadata is not
actual runtime image tracing. Only then admit the one version observation.

Require actual version output identifying GNU Bash 5.3.15 with exit 0; record
the complete observed host tuple/banner rather than invent one. Freeze binary
SHA-256 plus configuration/source/tool records for later oracles. Retain only
the explicitly approved reference output and evidence after archive verification;
remove other owned scratch without following aliases. Unknown live work blocks
cleanup/acceptance. No native37/full-compatibility/P2 rescore follows.
