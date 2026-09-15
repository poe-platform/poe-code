# Native schema nullable compatibility

Two red converter cases reproduced supported legacy nullable annotations being ignored after native schema preservation. Translate them into standard anyOf null branches, retain schema identities/definitions, and remap moved local property references relative to their resource roots. Native JSON Schema validation and advertised schemas must agree.

Reference checks cover moved properties and nested resource identifiers. A third red case reproduced rewriting unchanged percent-encoded reference spelling; retain the original reference unless its target path actually moves. Run the focused conversion/reference suite, scope lint/types, and final consumer checks. Absolute references, tuple items, dynamic anchors, and nullable combinations still require further audit.

Absolute in-document property references reproduced an unresolvable target after wrapping; resolve source resource identities before rewriting moved fragments. Draft-seven tuple checks were strengthened to require standard emitted syntax after a red wire-format check, rather than relying on the compiler accepting scalar nullable annotations. All 50 conversion/nullability/reference checks pass. Dynamic anchors, legacy id resources, and complete native proxy artifact validation remain pending.
