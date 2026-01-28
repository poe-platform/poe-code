# Development

## Run locally

- Run `npm run dev -- <command>` to invoke the CLI without rebuilding:

## Integration testing

Needs docker compose and maybe some other things

`./scripts/test_runner.py`

## Use different base_url

`POE_BASE_URL=<http://localhost:8000/__proxy__/poe/v1> npx poe-code@latest configure claude`
