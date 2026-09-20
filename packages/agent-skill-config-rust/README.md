# agent-skill-config-rust

Find coding-agent skills and keep temporary Git ignore rules scoped to one run.
The portable Rust core derives skill directories from the declarative agent
catalog and uses only the standard library and own path crates. Its independent
Node addon has no npm runtime, peer or optional dependencies.

| Capability | Node API |
| --- | --- |
| Supported agents, aliases and independent configs | `supportedAgents`, `resolveAgentSupport`, `getAgentConfig` |
| Global and project skill directories | `resolveSkillDir` |
| Project-first skill reference lookup | `resolveSkillReference` |
| Independent run-owned Git exclude blocks | `appendExcludeBlock`, `removeExcludeBlock` |

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

This additive experimental workspace currently covers the APIs above. Skill
installation/configuration, bundled templates, active-skill bridging/cleanup,
full malformed/accessor fidelity, Python bindings and cross-platform artifacts
remain in progress. Small native Node lookups are slower than the existing SDK.
Existing applications continue to use the original TypeScript package.
