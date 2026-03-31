# Snapshot Testing

Record and replay LLM API responses for deterministic tests.

## Environment Variables

| Variable            | Values                         | Default    | Description                             |
| ------------------- | ------------------------------ | ---------- | --------------------------------------- |
| `POE_SNAPSHOT_MODE` | `record`, `playback`           | `playback` | Record new or replay existing snapshots |
| `POE_SNAPSHOT_MISS` | `error`, `warn`, `passthrough`, `record` | `error`    | Behavior when snapshot missing          |

### `POE_SNAPSHOT_MISS` Behaviors

| Value         | Action on miss                              |
| ------------- | ------------------------------------------- |
| `error`       | Fail the test (default)                     |
| `warn`        | Log warning, forward to upstream            |
| `passthrough` | Silently forward to upstream                |
| `record`      | Forward to upstream and save new snapshot   |

The `record` miss behavior enables hybrid mode: existing snapshots play back, missing ones are recorded on-the-fly. This is useful when adding new tests to an existing suite.

Snapshots are stored in the `.snapshots` directory.

## Usage

| Task                   | Command                                                     |
| ---------------------- | ----------------------------------------------------------- |
| Run tests (playback)   | `bun run test`                                              |
| Record all snapshots   | `POE_SNAPSHOT_MODE=record bun run test`                     |
| Record specific test   | `POE_SNAPSHOT_MODE=record bun run test -- tests/my.test.ts` |
| List snapshots         | `bun run snapshots:list`                                    |
| Refresh snapshots      | `bun run snapshots:refresh`                                 |
| Delete all snapshots   | `bun run snapshots:delete`                                  |
| Delete stale snapshots | `bun run snapshots:delete-stale`                            |

## Writing a New Test

1. **Write the test** - Create your test file using the snapshot client

2. **Record snapshots** - Run with record mode to capture LLM responses:

   ```bash
   POE_SNAPSHOT_MODE=record bun run test -- tests/my.test.ts
   ```

3. **Verify playback** - Run normally to confirm snapshots replay correctly:

   ```bash
   bun run test -- tests/my.test.ts
   ```

4. **Delete stale snapshots** - Remove unused snapshots after refactoring:

Check for sanity

```bash
bun run snapshots:list:stale - list stale snapshots
bun run snapshots:delete:stale - delete stale snapshots (no confirmation)
```

## E2E Proxy Snapshots

E2E tests use the same `POE_SNAPSHOT_MODE` and `POE_SNAPSHOT_MISS` env vars. The proxy server intercepts HTTP requests inside Docker containers and replays recorded snapshots.

E2E snapshots are stored in `.snapshots/<testName>/` directories (e.g. `.snapshots/poe-agent-mcp/`).

| Task                    | Command                                                |
| ----------------------- | ------------------------------------------------------ |
| Run e2e (playback)      | `bun run e2e:verbose`                                  |
| Record all e2e fixtures | `POE_SNAPSHOT_MODE=record bun run e2e:verbose`         |
| Record missing only     | `POE_SNAPSHOT_MISS=record bun run e2e:verbose`         |
| Record specific test    | `POE_SNAPSHOT_MODE=record bun run e2e:verbose -- e2e/my.test.ts` |
