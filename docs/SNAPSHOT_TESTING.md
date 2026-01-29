# Snapshot Testing

Record and replay LLM API responses for deterministic tests.

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `POE_SNAPSHOT_MODE` | `record`, `playback` | `playback` | Record new or replay existing snapshots |
| `POE_SNAPSHOT_DIR` | path | `__snapshots__` | Snapshot storage directory |
| `POE_SNAPSHOT_MISS` | `error`, `warn`, `passthrough` | `error` | Behavior when snapshot missing |

## Usage

| Task | Command |
|------|---------|
| Run tests (playback) | `npm run test` |
| Record all snapshots | `POE_SNAPSHOT_MODE=record npm run test` |
| Record specific test | `POE_SNAPSHOT_MODE=record npm run test -- tests/my.test.ts` |
| List snapshots | `npm run snapshots:list` |
| Refresh snapshots | `npm run snapshots:refresh` |
| Delete all snapshots | `npm run snapshots:delete` |
| Delete stale snapshots | `npm run snapshots:delete-stale` |

## Writing a New Test

1. **Write the test** - Create your test file using the snapshot client

2. **Record snapshots** - Run with record mode to capture LLM responses:

   ```bash
   POE_SNAPSHOT_MODE=record npm run test -- tests/my.test.ts
   ```

3. **Verify playback** - Run normally to confirm snapshots replay correctly:

   ```bash
   npm run test -- tests/my.test.ts
   ```

4. **Delete stale snapshots** - Remove unused snapshots after refactoring:

   ```bash
   npm run snapshots:delete-stale
   ```
