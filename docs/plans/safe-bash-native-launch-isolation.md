# Metadata native-launch isolation

Release 33453431739 completed its Darwin build/provisioning, but six metadata
cases received `Error: $HOME must be set to run brew.` in native stderr.
The two umask wrappers invoked `/bin/bash -c` without startup-file suppression
or a private HOME. No native tool identity or product assertion needs changing.

Both wrappers now use `--noprofile --norc` and HOME equal to the existing owned
fixture cwd. The umask, command arguments, locale, timeout, exit status and raw
output remain unchanged. No startup output is filtered or accepted as native output.

Two mocked-launch regressions failed before the fix and pass afterward; they
create no files and retain exact result propagation. The five-file focused run
passes 21/21 tests with zero skips, including the six affected native cases on
local Darwin. Release 33459404825 subsequently passed all 843 required Darwin
semantic cases, including the six affected cases, with zero skips.

The mocked launcher regression originally resolved a real mktemp identity,
which the Linux tar/diff/patch profile does not provide. Inject an authenticated
memfs identity through the helper's existing identity resolver instead. Native
callers retain their default resolution; no native assertion or profile changes.
Both launcher regressions fail before this injection and pass afterward. The
launcher and binding checks pass 8/8 with zero skips, and scoped types pass.
Release publication remains pending the separate Linux GNU patch build mismatch.
