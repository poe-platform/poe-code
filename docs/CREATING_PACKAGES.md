# Creating Internal Packages

This project uses npm workspaces for internal packages. Packages live in `packages/` and are automatically linked via `npm install`.

## Package Structure

```
packages/
  your-package/
    package.json
    src/
      index.ts        # main entry point
      types.ts        # type definitions (optional)
      *.test.ts       # co-located tests
```

## Creating a New Package

### 1. Create the directory

```bash
mkdir -p packages/your-package/src
```

### 2. Create package.json

```json
{
  "name": "@poe-code/your-package",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

Key fields:
- `name`: Use `@poe-code/` prefix for consistency
- `private`: Set to `true` until ready to publish
- `main`/`types`: Point directly to TypeScript source (no build step needed)

### 3. Create source files

```typescript
// packages/your-package/src/index.ts
export { something } from "./something.js";
export type { SomeType } from "./types.js";
```

Note: Use `.js` extensions in imports (TypeScript resolves these to `.ts` files).

### 4. Link the package

```bash
npm install
```

This creates a symlink at `node_modules/@poe-code/your-package`.

### 5. Import from main code

```typescript
import { something } from "@poe-code/your-package";
```

## Testing

Tests are co-located in the package and discovered by the root test runner.

```typescript
// packages/your-package/src/something.test.ts
import { describe, it, expect } from "vitest";
import { something } from "./index.js";

describe("your-package", () => {
  it("works", () => {
    expect(something).toBeDefined();
  });
});
```

Run with `npm run test` from root.

## Key Points

- **No separate build**: Packages point `main` to TypeScript source. `tsx` handles resolution at runtime.
- **No dist folder**: Unlike published packages, internal packages don't need compilation.
- **Tests in package**: Place `*.test.ts` files alongside source. The root vitest config discovers them via `packages/**/*.test.ts`.
- **Zero imports from src/**: Packages must not import from the main `src/` directory to avoid circular dependencies.

## Publishing (Future)

When ready to publish a package:

1. Add a build script and tsconfig
2. Change `main`/`types` to point to `dist/`
3. Add `files: ["dist"]`
4. Remove `private: true`
