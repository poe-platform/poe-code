# Memory MCP search limit input schema

Three red checks reproduced negative/fractional search limits being handled as tool execution errors and advertised as unconstrained numbers. Declare the existing non-negative integer contract directly in the MCP input schema. Remove the imperative repeated validation and require invalid arguments to return -32602 before querying the handle.

All nine focused MCP helper tests pass. Run the maintained memory workspace suite and scope lint/types. No README additions or new configuration options are required.
