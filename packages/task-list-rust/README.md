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
- Migration with state mapping, rollback, dry-run validation and progress callbacks.

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

Migration searches declared state events in order and rolls back a created target
if applying the mapped state or deleting the source fails. Rust owns the live
search queue, visited identities and token bucket. The caller retains getters,
callbacks, timers and I/O. Search admits up to 65,536 queued/visited entries per
collection and 1,048,576 aggregate UTF-16/path units, counting empty event slots.
Dequeued paths release their budget; invalid rates and limits reject before I/O.

This private package exposes all original public runtime exports and compatible
public TypeScript signatures. Each implementation's default machine has its own
singleton identity; an explicitly supplied foreign default follows custom-machine
transition rules. YAML editing bounds above and platform acceptance remain pending,
so the rewrite is not yet fully interchangeable for every admitted SDK document.
No npm runtime dependencies or changes to existing consumers are introduced.
Current native artifact validation covers macOS arm64; other platforms and Python
bindings remain pending. Native crossings do not imply faster small operations.
