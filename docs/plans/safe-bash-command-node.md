# Node command workspace extraction

Move the existing Node provider, Worker-L lifecycle, host protocol and SafeJS adapter into the existing private `safe-bash-command-node` workspace. Preserve the existing QuickJS root route and all public Safe Bash exports. Safe Bash retains static compatibility facades and composition; Node owns its shared SafeJS invocation helpers and bridges. Canonical contracts and existing IO/query engines remain lower-level dependencies.

Keep the current default SafeJS runtime, opt-in registration, limits and platform entrypoints unchanged. No new external dependencies or publication jobs. Bundle private implementations, declarations and worker assets into the existing shipping packages.

Validation: failing ownership characterization before extraction; relocated pure unit tests; existing Shell integration and retirement regressions; selected workspace builds, lint/types and package-lint; isolated packed runtime and NodeNext consumers, including browser exports. Deliver one refactor commit to remote main and close only after verification.
