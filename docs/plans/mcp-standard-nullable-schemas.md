# Standard nullable JSON Schema descriptors

Direct Markdown-reader stdio QA returned a null section number under a descriptor declaring type string and nullable true. The latter keyword is an OpenAPI extension, not standard JSON Schema validation semantics.

Reproduced seven nullable descriptor failures after removing the nonstandard extension: strings, numbers, integers, booleans, arrays, objects and enums all rejected null. Emit a standard type array containing null; preserve enum membership and other constraints. Keep explicit null branches for composed schemas. Project object union branches as non-nullable before conversion so parent nullability remains authoritative.

All 2573 schema package tests pass, including 2226 upstream JSON Schema suite cases, seven standard nullable regressions and discriminator/union nullability checks. Rebuild downstream consumers and repeat independent descriptor validation and live stdio QA. Package lint/type verification is in progress; historical consumer exact schema expectations will need updates.
