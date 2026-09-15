# JSON value validation safety

Two failing schema checks reproduced getter invocation and hidden serialization hooks being accepted by generic JSON validation. Move the descriptor-based bounded JSON guard into the schema package, validate without reading accessor values, and retain sparse/cycle rejection and shared-reference acceptance. The MCP protocol consumer will import this shared implementation after the broad gate completes and the schema export is built.

Full schema verification is running. Check SDK/MCP parity and core structured-output regressions after consumers are rebuilt. Keep one implementation after migration.
