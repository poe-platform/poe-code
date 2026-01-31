# PathMapper Pattern

## Overview

`PathMapper` is used in the `@poe-code/config-mutations` package to support **isolated configurations** - when provider config files need to be written to an alternate location instead of their standard paths.

## Use Case

| Mode | Path |
|------|------|
| Normal | `~/.codex/config.toml` |
| Isolated | `~/.poe-code/codex/config.toml` |

The same mutation definition works for both cases - `pathMapper` intercepts and redirects paths at runtime.

## Implementation

```typescript
// packages/config-mutations/src/types.ts
export interface PathMapper {
  mapTargetDirectory(input: { targetDirectory: string }): string;
}

// packages/config-mutations/src/execution/path-utils.ts
export function resolvePath(rawPath: string, homeDir: string, pathMapper?: PathMapper): string {
  validateHomePath(rawPath);
  const expanded = expandHome(rawPath, homeDir);  // ~/.codex/config.toml -> /home/user/.codex/config.toml

  if (!pathMapper) return expanded;

  const directory = path.dirname(expanded);       // /home/user/.codex
  const mapped = pathMapper.mapTargetDirectory({ targetDirectory: directory });  // /home/user/.poe-code/codex
  return path.join(mapped, path.basename(expanded));  // /home/user/.poe-code/codex/config.toml
}
```

## Evaluation

| Aspect | Rating | Notes |
|--------|--------|-------|
| Reusability | Good | Same mutations work for normal and isolated modes |
| Testability | Good | PathMapper can be mocked |
| Complexity | Poor | Adds indirection that's hard to follow |
| Coupling | Poor | Config-mutations package now knows about "directory mapping" |
| Fragility | Poor | The "split path, map directory, reconstruct" logic is brittle |

## Verdict

**Acceptable but not ideal.** The pattern was inherited from the old `service-manifest.ts` system to maintain compatibility.

## Potential Improvements

If refactoring in the future, consider moving path resolution **outside** the mutation system:

1. **Modified homeDir** - Pass a different `homeDir` for isolated configs (e.g., `~/.poe-code/codex` instead of `~`)

2. **Pre-resolved paths** - Have mutations accept resolved absolute paths instead of `~` paths, with path resolution happening at a higher level before `runMutations` is called

3. **Path prefix transform** - Apply path transformation at the call site rather than inside the mutation execution

These alternatives would keep the config-mutations package simpler and more focused on its core responsibility of file manipulation.
