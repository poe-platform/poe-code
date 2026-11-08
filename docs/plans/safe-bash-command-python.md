# Python command workspace

Extract Python command ownership from Safe Bash into the private
`safe-bash-command-python` workspace. Preserve the existing public Python exports,
registration, defaults, limits, cancellation, cleanup, provisioning, and runtime
profiles. Python engines and runtime assets remain supplied by their existing
owners; this extraction does not publish a new package or add a runtime dependency.

Implementation owns invocation, executors/pooling, worker and JSPI transport,
filesystem bridging, package provisioning, and Python host-service adapters.
Import canonical contracts and existing I/O, network, ZIP, and LLM workspaces.
Safe Bash retains static compatibility facades and composes command registration.

Verification:

1. Fail the workspace-boundary characterization before extraction.
2. Move command-only tests without changing assertions; retain shell integration
   tests and inventory entry points in Safe Bash.
3. Build the maintained command and Safe Bash closures; run command lint/types,
   Python regression suites, integration boundary and package-lint gates.
4. Verify packed public imports, strict NodeNext declarations, worker paths, actual
   Shell execution, VFS scripts/pipes, registration, cancellation and error identity
   without installed private workspaces. Check browser/worker profile bundling.
5. Commit, deliver to remote main, and verify delivery before closing the work.
