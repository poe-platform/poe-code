# Temporal host classification cost

## Read-only observation

Copying the ordinary record `{answer:42}` through deepCopyToSandbox performs
nine Object.getPrototypeOf calls on that same input (f733d1). The copied answer
remains 42. A separate stack-attribution probe (9a3767) identifies one call from
each of the eight Temporal host readers, followed by isPlainObject.

The probes instrument Object.getPrototypeOf only inside separate short-lived
processes and restore it in finally blocks. They do not edit repository sources
or alter the active full-gate candidate. Stack capture is diagnostic overhead;
neither probe provides a meaningful timing benchmark.

## Follow-up constraints

After the frozen gate ends, investigate whether one host classification can
serve these readers without losing native/backend brands, tracked null-prototype
exports, custom-prototype rejection or Proxy safety. Do not cache mutable guest
state, replace brand checks with prototype inference, expose host objects, or
skip budget work. Preserve the ordinary import and structured-clone distinction.

Require behavioral controls and repeatable before/after measurements before
retaining an optimization. The current observation does not establish that this
work dominates copying, explains the full-suite timeouts, or warrants a new
abstraction. Earlier rejected intrinsic/closure optimizations remain rejected.

The full package run in session 36884 is still active. No performance fix,
complete conformance result, push or release is claimed by this observation.
