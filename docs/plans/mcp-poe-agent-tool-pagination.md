# Poe-agent MCP tool pagination

Focused tests reproduced repeated cursor setup making a third request and advancing unique cursors having no page bound. Reject repeated cursors before further requests and enforce 128 pages when continuation remains. Preserve successful final pages at the bound and ordinary multi-page tool setup.

Unit plus in-memory plugin API suite passes 16 checks. Add exact-bound final page validation and run relevant Poe-agent package lint/build and wider plugin/runtime consumers before completion.

The maintained plugin API suite now includes a final-page-at-128 boundary check; all 15 cases pass.
