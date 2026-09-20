# Engine workspace verification evidence

Task: `create-engine-workspace`. Scope is the original typed orchestration seam,
not any built-in reader, writer, full AST validator or shell command.

## Failing-first evidence

Before engine implementation, `npm run test:unit --workspace=@poe-code/pandoc`
failed resolving the absent `@poe-code/pandoc` public entry point. Original consumer
fixtures use explicit in-memory adapters and do not fake a format parser.

After initial implementation, three new original regressions failed:
Buffer input bytes and resolved resource bytes retained slice views, and unknown
options were ignored. Explicit `new Uint8Array` copies and shared option validation
fixed those failures. No unrelated source was changed.

## Verified local checks

- Package unit route: ten tests passed, including ordered independent reads and
  one write, pre-I/O validation, absent-parser gates, ownership, aggregate input
  and output bounds, ceiling rejection and cancellation before publication.
- Package lint route: ESLint plus production and consumer TypeScript checks passed.
- Selected maintained build route: `@poe-code/pandoc` built successfully; its
  declared build dependency closure contains only itself (zero runtime dependencies).
- Built Node ESM consumer imported `@poe-code/pandoc` through its package exports,
  exercised all three operations with original adapters and checked descriptors
  and the error constructor successfully. This is export/orchestration evidence,
  not CommonMark/plain/EPUB format evidence.
- Lockfile additions are only the new workspace identity and workspace link.

The engine uses standard typed arrays, structured cloning and explicit capabilities;
no environment lookup, host filesystem, fetch, clock, randomness or native fallback.
Public operation names have built evidence now. Browser/workerd and root public
bundle delivery are not claimed by this package-only check.

## Gates

Built-in format availability remains false. Injected trusted adapters must enforce
format syntax, full constructor semantics, resource admission and their own bounded
work through the supplied checkpoint. The next AST and format tasks remain open.
README copy is drafted separately; mandatory README permission remains unresolved,
so package delivery is incomplete. No remote-main delivery or release is claimed.
