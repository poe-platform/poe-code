---
title: JSON conversion hooks on functions
---

Native comparisons confirmed that JSON.stringify must consult toJSON on callable
objects before deciding whether to omit them. The sandbox previously skipped this
lookup for every closure. Include closures in hook dispatch and preserve normal
getter receivers, property keys, replacer order, and non-callable-hook behavior.

Validate root, nested, and array functions; accessor hooks; receiver identity;
replacement values; and Symbol results. Run package tests, lint, types, workspace
build, and the skill-guided no-capability harness with screenshot inspection.
Commit and push this improvement independently of other JSON fixes.

Separate validated follow-up: a replacer that receives a Symbol-valued object
property fails instead of being allowed to convert it. Native reproduction:
`JSON.stringify({x:Symbol('x')},(key,value)=>typeof value==='symbol'?'symbol':value)`.
Do not include that separate input-admission fix in this commit.
