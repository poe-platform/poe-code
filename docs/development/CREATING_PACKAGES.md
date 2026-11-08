# Creating Internal Packages

This project uses npm workspaces for internal packages. Packages live in `packages/` and are automatically linked via `npm install`.

## Package Structure

```
packages/
  your-package/
    package.json
    tsconfig.json
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
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc"
  },
  "files": ["dist"]
}
```

Key fields:

- `name`: Use `@poe-code/` prefix for consistency
- `private`: Set to `true` until ready to publish
- `main`/`types`: Point to compiled output for production build
- `exports`: Required for Vite/Vitest ESM module resolution. Without this field, tests will fail with "Failed to resolve entry for package"

### 3. Add README.md

Every package needs its own README. Include:

- what the package does;
- public API or CLI entry points;
- `Environment Variables`, even when the package exposes none;
- `Configuration` or `Configuration Options`, even when the package exposes none.

### 4. Create tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": false,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

### 5. Create source files

```typescript
// packages/your-package/src/index.ts
export { something } from "./something.js";
export type { SomeType } from "./types.js";
```

Note: Use `.js` extensions in imports (TypeScript resolves these to `.ts` files).

### 6. Link the package

```bash
npm install
```

This creates a symlink at `node_modules/@poe-code/your-package`.

### 7. Import from main code

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

- Build for production: packages compile via `npm run build --workspaces` during the main build.
- Tests in package: place `*.test.ts` files alongside source. Exclude them from build through `tsconfig.json`.
- No imports from `src/`: packages must not import from the root `src/` directory.
- Keep package logic in the package. The root CLI and SDK should wire packages and expose public APIs.
- Run `npm run lint:packages` before publishing or changing release wiring.

## Publishing

When a package becomes public:

1. Remove `private: true`.
2. Keep `files: ["dist"]`.
3. Add repository metadata with the package directory.
4. Add or update the GitHub release workflow.
5. Follow [NPM publishing](NPM_PUBLISHING.md). Releases happen from GitHub, not local `npm publish`.
