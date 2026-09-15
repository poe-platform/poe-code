# Preserve native upstream JSON Schema semantics

Current-source execution reproduced two production issues. For an object allOf requiring separate a:string and b:number properties, the original validator rejects {a:"yes"} while the converted runtime and wire validators accept it. The original accepts {a:"yes",b:1} while both converted validators reject it. Conversion has incorrectly replaced intersection with union and introduced closed-object restrictions.

A recursive object schema requiring value:string converts to unconstrained JSON, accepts value:2, and has a non-object root which the proxy refuses. These are validated unresolved issues, not supported behavior.

Preserve an authoritative upstream schema alongside its CLI field projection. Use the maintained JSON Schema compiler for authoritative validation and retain the original schema for MCP advertisement. Cover allOf, overlapping anyOf/oneOf, recursive object roots, reference siblings, additional properties, and SDK/CLI/MCP parity with failing tests before implementation. Keep projection concerns separate from validation semantics without introducing a parallel schema DSL.

Implemented the schema-owner native contract adapter: snapshot/compile once, authoritative validation before projection checks, prefixed nested issues, strict JSON value safety, and isolated exported documents. All 2,585 maintained schema cases pass. Converter regressions now cover object allOf and recursive roots; native document retention keeps valid combined objects accepted and incomplete/invalid recursive objects rejected. Overlapping unions, reference siblings, proxy transport parity, final builds, and broad consumer checks remain pending.

Overlapping anyOf/oneOf object branches and reference-sibling conjunction now retain native contracts. A red self-reference case exposed unbounded reference resolution; cycle-aware projection resolution now preserves that contract without stack overflow. All 40 native/converter checks pass. Latest full stdio verification independently found and corrected legacy raw-string quoting; final result is recorded separately.

Nested scalar unions, nested object intersections, and valid unions sharing required-key sets now use native validation while preserving useful projections. A maintained scalar-composition test now verifies acceptance/rejection and raw-schema retention instead of rejecting a spec-valid schema. All 44 converter and SDK/CLI/modern-MCP parity checks pass. Consumer lint is running; package export rebuild remains pending while the broad dist-consuming test process is live.
