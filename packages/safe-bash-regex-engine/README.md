# Bounded data matching

The internal regex engine supplies the shared text/query matcher and ERE
algorithms used by Safe Bash commands. It preserves capture behavior, explicit
work limits and cooperative cancellation without executing host utilities.

Use commands through `@poe-platform/safe-bash` and its existing command exports. This
private workspace is bundled into Safe Bash and is not independently published.
