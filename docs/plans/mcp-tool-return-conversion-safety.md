# Tool return conversion safety

Four red unit checks reproduced hidden serialization hooks and content/array accessors executing during conversion, and sparse array entries silently dropped. A fifth red check reproduced cyclic arrays overflowing the call stack instead of receiving a clear cyclic-array rejection. Strict JSON preflight now protects object returns, supported Image/Audio/File helpers remain accepted, and own data descriptors govern array entries.

Deep/wide bounds passed in Vitest's worker environment but failed two explicit main-Node assertions with Maximum call stack size exceeded. Replace recursive/spread traversal with an explicit frame stack so production main-Node behavior matches the unit contract. Both main-Node checks subsequently passed; the complete content suite passes 135 cases in 162 ms. Evidence: /tmp/mcp-tool-return-main-node-depth-red.log, /tmp/mcp-tool-return-main-node-width-red.log, /tmp/mcp-tool-return-main-node-depth-width-green.log, /tmp/mcp-tool-return-depth-width-green.log.

The previously passing conversion tests retain scalar/helper/nested-array behavior. Resource-link content is also retained through core and Toolcraft conversion. Complete current server/client consumer gates and lint follow. No README additions have been made.

The current consumer gate exposed the maintained structural class-content contract rejecting valid own content fields. A separate red regression demonstrated inherited serialization hooks must not survive conversion. Copy descriptors into a null-prototype record and validate supported content before returning it; getters and hidden own hooks remain rejected, inherited hooks never execute.

Main-Node QA independently reproduced Toolcraft's separate recursive array flattener overflowing at 20,000 nested arrays. Three red Toolcraft tests additionally reproduced serialization/type hooks executing in untyped returns. Remove its duplicate converter and invoke the owning iterative content converter directly. The complete focused class, non-plain, getter, hook, and array matrix passes 283 cases in /tmp/mcp-toolcraft-untyped-safety-green.log. Full consumer gate and rebuilt artifact QA follow.
