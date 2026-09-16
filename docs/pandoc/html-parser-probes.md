# Existing HTML parser structural probes

Capture date: 2026-09-16. Source revision:
`3b0f790c7664275b292732dbb63012081fca2f1b`.
Node v22.22.2. Original inputs below contain no imported fixture text.

The inline Node probe read `parser.ts` without modifying it and used
`node:module.stripTypeScriptTypes` with `mode: transform`, then imported the
transformed source through an in-memory data URL. The entity import was replaced
in memory with an identity async function: these inputs contain no entities.
The budget was an explicit no-op structural harness (`add`, `work`, `check`,
`checkpoint`), with maxTokenBytes 65536, maxAttributes 64 and maxDepth 128.
No unit test, host scratch file, downloaded fixture or external utility was used.
The first attempt using tsx failed because dependencies were absent; Node strip-only
mode also rejected the parameter property. Transform mode completed all probes.
This isolates tree construction only; it cannot qualify budgets or entities.

Tree notation: arrays contain tag followed by children; strings are text.
The synthetic `root` wrapper is excluded from HTML5 document-wrapper comparisons.

| Input | Observed tree | HTML5 structural gap |
| --- | --- | --- |
| `<b><i>A</b>B</i>` | `["root",["b",["i","A"]],"B"]` | Active formatting reconstruction should retain italic formatting around B. |
| `<table>A<tr><td>B</td></tr></table>` | `["root",["table","A",["tr",["td","B"]]]]` | Table foster parenting should place A before table; implied tbody is absent. |
| `<div/>A` | `["root",["div"],"A"]` | HTML non-void self-closing syntax does not close div; A belongs inside it. |
| `<table><tr><td>A</table>` | `["root",["table",["tr",["td","A"]]]]` | Implied tbody is absent. |
| `<svg><foreignObject><p>A</p></foreignObject></svg>` | `["root",["svg",["foreignobject",["p","A"]]]]` | Foreign tag-name adjustment is absent; HtmlNode also has no namespace field. |

Each tree matched between one whole-input feed and one feed per Unicode character:
5/5 observed chunk comparisons. These are structural observations against HTML5
rules, not differential runs against an installed HTML5 parser. No pass count for
HTML5 conformance is implied. Existing parser behavior is preserved.

The architecture's extraction gate follows from these gaps and inspected shell/
Buffer coupling. Future execution and QA steps belong under docs/plans, not here.
