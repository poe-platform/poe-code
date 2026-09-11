---
title: JSON spacing option conversion
---

Native comparisons reproduced rejection of valid JSON.stringify spacing options.
Convert boxed Numbers with ToNumber and boxed Strings with ToString, including
observable coercion hooks. Ignore all other non-number/non-string values without
coercing them. Preserve the existing ten-space/ten-UTF-16-unit truncation rules.

Validate primitive and boxed inputs, infinities/NaN/fractions, astral strings,
ignored objects with throwing hooks, invalid boxed-number conversion, and the
order of replacer-list conversion, spacing conversion, and toJSON invocation.
Run package tests, lint, types, selected workspace build, and the skill-guided
no-capability CLI harness with actual screenshot inspection. Commit/push this
improvement independently and monitor publication while continuing the audit.
