# PPTX command ownership

The command workspace owns the virtual-shell adapter, argument parsing, command
schemas, discovery, execution and their existing regression tests. Preserve the
current default inventory, optional registration, replacement policy, lazy default
engine, unlimited defaults and explicit resource limits.

`safe-bash-presentation-engine` owns shared presentation models, OPC, byte IO,
selection and document transformations. Pandoc consumes this lower layer directly.
Drawing and selector schemas remain shared because model operations use them.
The publication request type belongs below commands because Presentation uses it.
`safe-bash-pptx-engine` retains its existing index and bytes compatibility facades.
All three workspaces remain private and are bundled into the existing parent
artifact, with no standalone publication or consumer dependency on private names.

Verification:

- Characterize command-owned discovery before extraction; preserve moved tests.
- Build the maintained selected workspace closures and run command, shared-engine,
  compatibility, Pandoc conversion, Safe Bash PPTX, lint and package boundary checks.
- Exercise isolated packed public imports and strict NodeNext declarations; check
  real default-engine discovery, registration/collisions, explicit argument limits,
  distinct byte arguments, VFS scripts, pipes and cancellation identity.
- Exercise the existing browser/workerd profiles without host capabilities.
- Verify remote-main delivery before closing; release publication is separate.

No output/help text or command behavior is intentionally changed.
