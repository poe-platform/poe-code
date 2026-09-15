# Native Zsh dependency in release validation

Release run 34929339186 passed the shared unit stage: 110,866 passing tests across
2,074 passing files. The OP native task then failed its two Zsh completion tests
while spawning `/bin/zsh`, returning a null process status within milliseconds.
The same OP task passes locally where `/bin/zsh` is available.

The Ubuntu 24.04 fresh-unit job did not provision Zsh. Install the native shell
and verify `/bin/zsh` is executable before testing. Run the maintained OP native
unit task immediately after installation to validate this blocker before the
long shared gate. Keep both completion tests enabled and retain the full fresh
unit task afterward.

Validate the workflow configuration with `npm run lint:workflows`, run
`npm run test:unit --workspace=@poe-platform/op`, and monitor the next GitHub
release through native shell verification, full validation, and publication.
No workflow unit tests are introduced.
