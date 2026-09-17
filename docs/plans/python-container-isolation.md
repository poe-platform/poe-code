# Explicit container-host Python isolation (#750)

## Objective

Provide a concrete, opt-in host implementation rather than declaring arbitrary
injected executors safe. Retain the trusted Node worker as a separate convenience
profile. The container implementation requires a trusted Linux Docker daemon,
an explicitly configured Unix socket, and an immutable, qualified runtime image.
It must refuse hosts that cannot supply the required resource controls.

## Boundary

Each invocation receives a new container with no host mounts, no inherited host
environment, no network, a non-root user, a read-only root, bounded temporary
storage, dropped capabilities and no-new-privileges. Enforce memory and aggregate
CPU rate with cgroups and supervise wall time outside the guest process. CPU rate
is not an instruction counter or a precise cumulative CPU-time allowance.

Expose only a bounded invocation-local stdio protocol to the canonical filesystem
and package dispatcher. Treat every guest frame as untrusted. Docker credentials,
the daemon socket, host files and sibling contexts never enter the container.
The trusted image is an operator-supplied artifact, not an ambient download.

Shared admission uses the host-owned executor pool. Retirement must forcibly
remove the owned container, cover startup races and pending control operations,
and retain admission on unconfirmed cleanup. Shell cancellation must not dispose
the shared host or sibling invocations. Previously acknowledged storage effects
are not rolled back.

## Required evidence

Use TDD for configuration, capability refusal, bounded framing, failed startup,
deadlines, cancellation and cleanup races. Qualify a fresh public artifact with
real Python in a disposable local container: canonical binary files, temporary
directories, CPU loops, allocation pressure, attempted ambient access, siblings,
capacity and post-failure recovery. Container compatibility alone is not security
qualification. Do not close issue 750 until the actual host guarantees and these
adversarial cases have been verified.
