# @poe-code/runner-e2b

E2B execution environment runner for poe-code.

## Environment Variables

- `E2B_API_KEY` - E2B API key used by default when `runtime.api_key_env` is not configured.

## Runtime Config

- `runtime.api_key_env` - Host environment variable containing the E2B API key. Defaults to `E2B_API_KEY`.
- `runtime.cpu` - CPU count used when building an E2B template.
- `runtime.memory_mb` - Memory in megabytes used when building an E2B template.
- `runtime.timeout_minutes` - Sandbox timeout in minutes.
- `runtime.preserve_after_exit_hours` - Hours to keep a detached sandbox alive after job exit. Defaults to `24`; valid range is `0` to `168`.
