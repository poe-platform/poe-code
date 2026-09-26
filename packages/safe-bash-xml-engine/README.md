# Bounded XML processing

Safe Bash shares XML tree queries, serialization, input decoding and resource
budgets between its XML commands. The engine uses the canonical safe-fs XML
parser and preserves UTF-8 admission, cancellation and explicit limits. Resource
quotas default to `Infinity`; configure finite byte, depth, node, attribute,
namespace, work or result limits as needed. Explicit `Infinity` disables a quota.

Access XML functionality through `@poe-platform/safe-bash/commands/xml` and its
`xmlCommands` plugin. This private engine is bundled into the public package;
it requires no separate installation and has no external runtime dependency.
