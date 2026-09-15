# MCP JSON literal constraints

Three failing converter tests reproduced nonprimitive const/enum constraints widening to arbitrary JSON. Preserve native JSON const and enum values in the minimal JSON descriptor, advertise the standard keywords, and validate them using structural equality. Object key order is immaterial; array order is significant.

A CLI/SDK/MCP consumer regression reproduced JSON fields bypassing validation in CLI and MCP. Validate those fields before handler execution, including static defaults and preset values. SDK already delegates to the schema validator.

Converter and full schema suite passed 2,603 checks before consumer fixes. Consumer verification, scoped lint and build are in progress. Audit dynamic CLI JSON paths and nullable constraint combinations before completion. README additions remain subject to the user's permission.
