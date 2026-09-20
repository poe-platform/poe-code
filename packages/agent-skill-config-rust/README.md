# agent-skill-config-rust

Find and install coding-agent skills, protect user files, and keep temporary Git
ignore rules scoped to one run.
The portable Rust core derives skill directories from the declarative agent
catalog and uses only the standard library and own path crates. Its independent
Node addon has no npm runtime, peer or optional dependencies.

| Capability | Node API |
| --- | --- |
| Supported agents, aliases and independent configs | `supportedAgents`, `resolveAgentSupport`, `getAgentConfig` |
| Global and project skill directories | `resolveSkillDir` |
| Project-first skill reference lookup | `resolveSkillReference` |
| Independent run-owned Git exclude blocks | `appendExcludeBlock`, `removeExcludeBlock` |
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

Exclude blocks preserve existing content and allocate separate ownership IDs
when two runs share a caller ID. Removal leaves other runs and incomplete marker
blocks intact. Atomic writes reject symlink traversal, exclusively create unique
temporary files, preserve collisions and clean partial writes/rename failures.
Git directory lookup uses builtin `git rev-parse`; no library dependency is needed.

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

This additive experimental workspace provides the current root SDK API. Full
malformed/accessor fidelity, Python bindings and cross-platform artifacts
remain in progress. Small native Node lookups and configuration cycles are slower
than the existing SDK.
Existing applications continue to use the original TypeScript package.
