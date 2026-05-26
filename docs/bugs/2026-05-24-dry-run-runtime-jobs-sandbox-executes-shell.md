# Dry-run runtime jobs sandbox executes a sandbox shell

## Summary

Running `runtime jobs sandbox` with root `--dry-run` still invokes the runtime backend to open an interactive shell inside the selected sandbox.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable directories and fake `docker`/`colima` executables

## Reproduction

From the repository root, use fake runtime executables to record commands instead of contacting a real container engine:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home" "$probe/project"

cat > "$probe/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "--version" ]; then
  printf '%s\n' 'Docker version fake'
fi
exit 0
EOF
cat > "$probe/bin/colima" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$probe/bin/docker" "$probe/bin/colima"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_DOCKER_LOG="$probe/docker.log" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run runtime jobs sandbox sandbox-probe --runtime docker
)

cat "$probe/docker.log"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The fake engine records its availability probe, `--version`.
- More importantly, it records `exec -i -t -w /workspace sandbox-probe sh` during root `--dry-run`.
- The command exits successfully because the fake executable replaces the real interactive shell launch.

## Expected Behavior

With root `--dry-run`, `runtime jobs sandbox` must not execute a runtime shell or contact a container engine beyond any explicitly previewed non-mutating inspection. It should report the command that would be launched.

## Impact

- A purported preview can enter an interactive sandbox session and allow arbitrary user or shell-startup activity in that environment.
- Invoking a real runtime backend can generate logs, consume resources, or alter container state.
- Users cannot safely validate sandbox-selection arguments with dry-run mode.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/runtime/jobs/sandbox.ts`, the command does not accept or inspect the root command flags: it immediately calls `factory.attach(envId)`, then `env.shell()`. For the Docker execution environment, `packages/process-runner/src/docker/docker-execution-env.ts` implements `shell()` via a runtime `exec` invocation.

## Suspected Area

Runtime job execution commands need a dry-run guard before attaching to a runtime or launching interactive commands.
