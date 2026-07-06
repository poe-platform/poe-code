# Snapshot Testing

Record and replay LLM API responses for deterministic tests.

## Environment Variables

| Variable            | Values                                   | Default    | Description                             |
| ------------------- | ---------------------------------------- | ---------- | --------------------------------------- |
| `POE_SNAPSHOT_MODE` | `record`, `playback`                     | `playback` | Record new or replay existing snapshots |
| `POE_SNAPSHOT_MISS` | `error`, `warn`, `passthrough`, `record` | `error`    | Behavior when snapshot missing          |

### `POE_SNAPSHOT_MISS` Behaviors

| Value         | Action on miss                            |
| ------------- | ----------------------------------------- |
| `error`       | Fail the test (default)                   |
| `warn`        | Log warning, forward to upstream          |
| `passthrough` | Silently forward to upstream              |
| `record`      | Forward to upstream and save new snapshot |

The `record` miss behavior enables hybrid mode: existing snapshots play back,
missing ones are recorded as the test runs. Use it when adding requests to an
existing suite.

Snapshots are stored in the `.snapshots` directory.

## Usage

| Task                   | Command                                                     |
| ---------------------- | ----------------------------------------------------------- |
| Run tests (playback)   | `npm run test`                                              |
| Record all snapshots   | `POE_SNAPSHOT_MODE=record npm run test`                     |
| Record specific test   | `POE_SNAPSHOT_MODE=record npm run test -- tests/my.test.ts` |
| List snapshots         | `npm run snapshots:list`                                    |
| Refresh snapshots      | `npm run snapshots:refresh`                                 |
| Delete all snapshots   | `npm run snapshots:delete`                                  |
| Delete stale snapshots | `npm run snapshots:delete-stale`                            |

## Writing a New Test

1. Write the test with the snapshot client.

2. Record snapshots:

   ```bash
   POE_SNAPSHOT_MODE=record npm run test -- tests/my.test.ts
   ```

3. Verify playback:

   ```bash
   npm run test -- tests/my.test.ts
   ```

4. Remove stale snapshots after refactoring:

```bash
npm run snapshots:list:stale
npm run snapshots:delete:stale
```

## E2E Proxy Snapshots

E2E tests use the same `POE_SNAPSHOT_MODE` and `POE_SNAPSHOT_MISS` variables.
The proxy server intercepts model HTTP requests from the selected e2e backend
and replays recorded snapshots.

E2E snapshots are stored in `.snapshots/<testName>/`.

| Task                    | Command                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| Run e2e playback        | `npm run e2e:verbose`                                            |
| Record all e2e fixtures | `POE_SNAPSHOT_MODE=record npm run e2e:verbose`                   |
| Record missing only     | `POE_SNAPSHOT_MISS=record npm run e2e:verbose`                   |
| Record specific test    | `POE_SNAPSHOT_MODE=record npm run e2e:verbose -- e2e/my.test.ts` |
