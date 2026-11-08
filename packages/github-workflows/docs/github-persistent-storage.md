# GitHub Persistent Storage Options

GitHub provides several mechanisms for short-lived persistent storage that can be used from workflows and the API.

## Actions Cache

The closest thing GitHub offers to a key-value store.

- **Keys**: arbitrary strings (up to 512 characters)
- **Values**: files or directories (compressed and stored)
- **TTL**: entries evicted after **7 days** of no access
- **Limit**: 10 GB per repository
- **Scope**: branch-level isolation with fallback to default branch

### Usage from workflows

```yaml
- uses: actions/cache@v4
  with:
    path: ./my-data
    key: my-cache-key-${{ github.sha }}
    restore-keys: |
      my-cache-key-
```

### Usage from REST API

```bash
# List caches
gh api /repos/{owner}/{repo}/actions/caches

# Delete a cache by key
gh actions-cache delete <key> --repo {owner}/{repo}
```

### Usage from `@actions/cache` npm package

```ts
import * as cache from "@actions/cache";

// Save
await cache.saveCache(["./my-data"], "my-cache-key");

// Restore
const hit = await cache.restoreCache(["./my-data"], "my-cache-key", ["my-cache-"]);
```

## Actions Artifacts

File-based storage attached to workflow runs.

- **Retention**: configurable from 1 to 90 days (default: 90)
- **Limit**: 500 MB per artifact (compressed), varies by plan
- **Scope**: tied to a specific workflow run

### Usage from workflows

```yaml
# Upload
- uses: actions/upload-artifact@v4
  with:
    name: my-artifact
    path: ./output
    retention-days: 7

# Download
- uses: actions/download-artifact@v4
  with:
    name: my-artifact
```

### Usage from REST API / CLI

```bash
# List artifacts for a repo
gh api /repos/{owner}/{repo}/actions/artifacts

# Download from a specific run
gh run download <run-id> --name my-artifact
```

## Repository Variables

String key-value pairs configurable at repo, org, or environment level.

- **TTL**: none (persistent until explicitly deleted)
- **Limit**: 48 KB per variable, 1000 variables per repo
- **Scope**: repo, org, or environment

### Usage from workflows

```yaml
steps:
  - run: echo "${{ vars.MY_KEY }}"
```

### Usage from REST API / CLI

```bash
# Set a variable
gh variable set MY_KEY --body "my-value"

# Get a variable
gh variable get MY_KEY

# List variables
gh variable list

# Delete a variable
gh variable delete MY_KEY
```

## Comparison

| Feature       | Actions Cache                        | Actions Artifacts      | Repository Variables |
| ------------- | ------------------------------------ | ---------------------- | -------------------- |
| Storage model | Key -> files                         | Run -> files           | Key -> string        |
| TTL           | 7 days (auto)                        | 1-90 days              | Manual               |
| Max size      | 10 GB / repo                         | 500 MB / artifact      | 48 KB / variable     |
| API writable  | Yes                                  | Yes                    | Yes                  |
| Best for      | Build caches, ephemeral shared state | Build outputs, reports | Configuration, flags |
