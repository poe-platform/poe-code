# Task List Rust

Validate task identities and model task states with a dependency-free Rust core
and TypeScript bindings. Keep your existing task storage while evaluating the
additive implementation.

- Default draft, planned, in-progress, done and archived states.
- Custom events with guards and lifecycle callbacks retained by your application.
- Ordered event discovery and exact UTF-16 task identities.
- Rust transition validation and shortest event-path discovery.
- TypeScript error classes and task interfaces matching the existing package.
- Markdown storage with atomic writes, locks, ordering, archive and passthrough frontmatter.
- YAML stores with source spans, retained block comments, quote styles and task ordering.
- GitHub issue/project storage, canonical issue identities, label states and project sync.

```typescript
import {
  defaultStateMachine, eventsFromState, assertTransition,
} from '@poe-code/task-list-rust';

console.log(eventsFromState(defaultStateMachine, 'draft')); // plan, archive
assertTransition('planned', 'draft'); // legacy default backward transition
```

The default machine is frozen. Wildcard events exclude their own target state;
custom machines allow only their declared events. Guards and lifecycle callbacks
are retained by reference and are not invoked during machine validation.

```typescript
import { openTaskList } from '@poe-code/task-list-rust';
const store = await openTaskList({ type: 'markdown-dir', path: './tasks', create: true });
const work = store.list('work');
await work.create({ id: 'ship', name: 'Ship release' });
await work.fire('ship', 'plan');
```

Markdown frontmatter is parsed and serialized by the owned Rust YAML implementation;
file I/O and lifecycle callbacks remain host operations. Atomic writes and locks
protect task updates. Passthrough mode supports existing plan documents.

GitHub storage supports project status or declarative label states. Supply a token
and fetch implementation to control authentication and transport. Project verification
reports missing states; sync requires `yes: true` to create missing project resources.
Rust validates issue/repository identities and parses GraphQL JSON, with a maximum
JSON nesting depth of 512. Network calls, project orchestration and callbacks remain
in Node. Native identity parsing retains UTF-16 strings and safe integer boundaries.

YAML storage retains unchanged block entries, comments attached to moved tasks,
inline comments and existing single/double quote styles for single-line strings.
Schema-aware scalar mapping keys retain their type. Syntax scanning uses the same
512-depth limit and permits at most 1,048,576 nodes. Edits to flow mappings that
contain `#` are rejected before file writes; other changed flow mappings are
normalized. Complex mapping keys and complete SDK formatting/alias-edit parity
remain under review.

This private package currently covers all three storage backends, project sync,
states, errors, interfaces and file-operation helpers. Migration is still being
implemented. It is not yet a complete replacement for task-list.
No npm runtime dependencies or changes to existing consumers are introduced.
Current native artifact validation covers macOS arm64; other platforms and Python
bindings remain pending. Native crossings do not imply faster small operations.
