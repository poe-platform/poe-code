# agent-skill-config-rust

Find and install coding-agent skills, protect user files, and keep temporary Git
ignore rules scoped to one run.
The portable Rust core derives skill directories from the declarative agent
catalog and uses only the standard library and own path crates. Async operations
uses the existing own `@poe-code/safe-fs` capability and path contracts.

| Capability | Node API |
| --- | --- |
| Supported agents, aliases and independent configs | `supportedAgents`, `resolveAgentSupport`, `getAgentConfig` |
| Global and project skill directories | `resolveSkillDir` |
| Project-first skill reference lookup | `resolveSkillReference`, `resolveSkillReferenceAsync` |
| Discover ordered, unique skills through a supplied filesystem | `discoverSkillsAsync` |
| Independent run-owned Git exclude blocks | `appendExcludeBlock`, `removeExcludeBlock`, `appendExcludeBlockAsync`, `removeExcludeBlockAsync` |
| Install bundled skills without overwriting user files | `configure`, `unconfigure` |
| Install named skills with explicit overwrite control | `installSkill` |
| Temporarily copy selected skills into a spawning agent | `bridgeActiveSkills`, `cleanupBridgedSkills` |

```typescript
import { resolveSkillReference } from '@poe-code/agent-skill-config-rust';

const skill = resolveSkillReference('claude/review', process.cwd(), '/home/me');
if (skill.kind === 'resolved') console.log(skill.sourcePath);
```

Bare names search `.poe-code/skills` in project and user scope. Agent-prefixed
names use that agent's configured directories, with case-insensitive agent aliases
and exact skill-name casing. Failed lookups report the ordered paths searched.
Unexpected filesystem errors preserve their original Node exception identity.
Async lookup uses the supplied `fs`, `cwd`, `homeDir` and optional `signal`.
It shares Rust validation and search plans with synchronous lookup and uses the
existing filesystem bridge for provider operations and cancellation.

Exclude blocks preserve existing content and allocate separate ownership IDs
when two runs share a caller ID. Removal leaves other runs and incomplete marker
blocks intact. Synchronous writes reject symlink traversal, exclusively create unique
temporary files, preserve collisions and clean partial writes/rename failures.
Git directory lookup uses builtin `git rev-parse`; no library dependency is needed.

Async exclude updates use the supplied filesystem, search parent directories for
Git metadata and support worktree `gitdir:` files. Updates serialize per filesystem,
inspect metadata ancestors for symbolic links and preserve the existing SDK's
temporary-file cleanup and error behavior. Rust owns the search, text changes and
publication lifecycle; the host retains filesystem and promise-queue identities.

Rust users can supply `resolve::Host` and `exclude::Host` implementations for their
platform paths and filesystem. UTF16 text retains JavaScript values, including
lone surrogates in in-memory policies.

Configuration defaults to global scope; named installation defaults to local.
Installation rejects ambiguous names and reports an existing skill before any
mutation unless `force` is set. Dry runs retain the same preflight checks while
leaving files unchanged. Unconfiguration preserves modified bundled files unless
forced and only removes an empty shared skills root. Mutation observers receive
the same labels, details and outcomes as the original SDK.

The portable `apply::Machine` produces filesystem preflight requests and mutation
plans. `templates::Machine` searches package roots and source/distribution template
locations in order; `templates::bundled` supplies the compiled own templates for
Rust hosts. The Node addon includes the own mutation engine in the same native
artifact and loads its bundled template files using builtin filesystem APIs.

Active bridges resolve the whole reference batch before copying, report local,
global, self-reference and same-name collisions, and copy nested binary assets.
They reject symbolic links beneath the workspace/source root. Unmodified copies
are shared by overlapping runs; a changed source is not reused. Cleanup checks
the ownership token and tree fingerprint, preserves user replacements and changed
copies, and removes only owned empty parents. Git bookkeeping failures roll back
copies; exclude cleanup must succeed before targets are removed. Original
manifests have idempotent cleanup, and serialized manifests retain duplicate-run
exclude IDs.

Async discovery loads direct child `SKILL.md` files, preserves directory order,
sorts child names by UTF-16 units and deduplicates successfully loaded paths.
Rust owns traversal and file admission; the host retains filesystem operations,
decoding, cancellation and original exception identities. Symbolic-link roots
and nonregular skill files are rejected. Pass `fs`, `cwd` and `homeDir`, with an
optional `signal`; `nativePaths` retains the original direct-filesystem mode.

This additive experimental workspace exposes the current Node SDK API. Two
async helpers (bridge and cleanup)
still delegate to the original package and are not independent Rust replacements.
Full malformed/accessor fidelity, Python bindings and cross-platform artifacts
remain in progress. Small native Node lookups, discovery and configuration cycles
are slower than the existing SDK in measured samples.
Existing applications continue to use the original TypeScript package.
