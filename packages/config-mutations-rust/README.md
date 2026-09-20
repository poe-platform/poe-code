# config-mutations-rust

Read and update JSONC, TOML or YAML configuration with no npm runtime dependencies.
This private additive rewrite leaves your existing configuration integrations intact.

```ts
import {jsonFormat,modifyAtPath} from '@poe-code/config-mutations-rust/json';

const config=jsonFormat.parse('{ // preserved\n "enabled":true,\n}');
const updated=modifyAtPath('{ // preserved\n "enabled":true,\n}', ['enabled'], false);

import {tomlFormat} from '@poe-code/config-mutations-rust/toml';
const servers=tomlFormat.parse('[mcp_servers.agent]\ncommand = "node"\n');
const toml=tomlFormat.serialize(servers);

import {yamlFormat} from '@poe-code/config-mutations-rust/yaml';
const settings=yamlFormat.parse('extensions:\n  terminal:\n    enabled: true\n');
const yaml=yamlFormat.serialize(settings);
```

The own Rust parser and editor preserve UTF-16 strings, trailing commas, indentation,
line endings and unaffected comments. Node supplies serialization and property
operations that retain Date, getter, array-hole and patch-reference behavior.
The Rust codec is independent of Node and uses only std and own path crates.

TOML supports dotted and quoted keys, arrays of tables, multiline strings,
nonfinite numbers and mutable Date values that retain authored offsets and local
date/time forms. A binary host snapshot preserves UTF-16 strings, BigInt and Date
hooks without calling foreign `toJSON` methods. Rust handles parsing and formatting;
Node retains JavaScript object identities during merge and prune.

YAML supports block and flow collections, multiline strings, YAML 1.1 scalar
resolution, merge keys, binary and temporal tags, and safe own properties.
Serialization preserves shared references and circular objects as YAML anchors;
host getters, `toJSON`, Maps and iterators retain JavaScript behavior. Parsed Date
and Symbol aliases retain scalar identity. YAML configuration nesting is bounded
to 512 levels, with alias expansion checks before cloning; cyclic input rejects
promptly instead of overflowing the original configuration clone.

Exact YAML SDK warnings/error metadata, all authored complex-key formatting and
merge-source alias admission are still under conformance review. SDK-specific
Document/node objects are not serialization inputs. Standalone Rust callers can
supply Date-key coercion; the Node adapter uses the host time zone. The original
mutation execution and root/testing exports are not available yet. It is not integrated into applications. JSON nesting is bounded to 512
levels; malformed edit input
is rejected rather than recovered by the development oracle's tolerant editor.
Unlike the original JSONC parser, `__proto__` keys are retained as ordinary own
data properties instead of being lost through a prototype assignment.
Removing the final array item also fixes an SDK bug that joins adjacent numbers
(`remove [1,2,3] at index 2` returns `[1,2]`, instead of `[1,23]`).
TOML nesting is bounded to 1,000 levels, including dotted paths combined with
literal nesting. Arrays-of-tables headers require both closing brackets, fixing
the development oracle's acceptance of `[[section]`. Rust does not guarantee a
speedup for every workload: native transfer overhead can outweigh parsing savings
on small documents, and JavaScript TOML serialization currently remains faster.

Local YAML measurements on Node 22/macOS ARM64 showed faster native parsing and
serialization for small, 64-property and 4,096-property workloads. The largest
parse took 5.3 ms versus 233 ms; serialization took 4.2 ms versus 10.5 ms.
This is workload-specific evidence, not a guarantee on other platforms. Peak RSS
was about 156 MB for either implementation; no memory reduction is claimed.
