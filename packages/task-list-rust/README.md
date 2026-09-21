# Task List Rust

Validate task identities and model task states with a dependency-free Rust core
and TypeScript bindings. Keep your existing task storage while evaluating the
additive implementation.

- Default draft, planned, in-progress, done and archived states.
- Custom events with guards and lifecycle callbacks retained by your application.
- Ordered event discovery and exact UTF-16 task identities.
- Rust transition validation and shortest event-path discovery.
- TypeScript error classes and task interfaces matching the existing package.

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

This private package currently covers states, errors, interfaces and internal
file-operation helpers. Storage backends, migration and GitHub project sync are
still being implemented. It is not yet a complete replacement for task-list.
No npm runtime dependencies or changes to existing consumers are introduced.
Current native artifact validation covers macOS arm64; other platforms and Python
bindings remain pending. Native crossings do not imply faster small operations.
