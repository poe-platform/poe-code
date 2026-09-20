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

import {runMutations,fileMutation,configMutation} from '@poe-code/config-mutations-rust/execution';
const result=await runMutations([
  fileMutation.ensureDirectory({path:'~/.agent'}),
  {kind:'chmod',target:'~/.agent',mode:0o700},
  {kind:'removeFile',target:'~/.agent/empty',whenEmpty:true}
], {fs:yourFileSystem,homeDir:yourHomeDirectory,dryRun:true});

// Preserve the first baseline, including an originally missing file.
await runMutations([fileMutation.backup({target:'~/.agent/config.json',once:true})],
  {fs:yourFileSystem,homeDir:yourHomeDirectory});
// Later, restore and consume the most recent generated backup.
await runMutations([fileMutation.restoreBackup({target:'~/.agent/config.json'})],
  {fs:yourFileSystem,homeDir:yourHomeDirectory});

// Merge JSONC, TOML or YAML, preserving a backup when the input is invalid.
await runMutations([
  configMutation.merge({target:'~/.agent/config.json',value:{enabled:true}}),
  configMutation.prune({target:'~/.agent/config.json',shape:{legacy:{}}}),
  configMutation.transform({target:'~/.agent/config.json',
    transform:doc=>({content:{...doc,version:2},changed:true})})
], {fs:yourFileSystem,homeDir:yourHomeDirectory});
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
supply Date-key coercion; the Node adapter uses the host time zone.

The `./execution` API runs directory creation/removal, guarded file removal,
permission changes, backups, restoration and configuration updates in order.
The `fileMutation` and `configMutation` factories
keeps resolver and guard identities while deriving its layouts from Rust. Its Rust state machine checks symbolic links before
writes, retains dry-run outcomes and requests host controls lazily; injected
filesystem errors and observers retain their identities. Paths must start with
`~` and remain inside the managed home before optional mapping.

Configuration policy runs in Rust: format selection, missing/invalid-document
handling, invalid backups, guards, dry runs, deletion and serialized comparisons.
JSONC updates retain unaffected comments. Prefix pruning supports replacing
managed keys before a shallow table merge. Arbitrary JavaScript documents,
callbacks, getters and replacement references remain in the Node adapter;
their merge/prune property operations currently run in JavaScript. Standalone
Rust callers can use `config_data::merge` and `config_data::prune` with owned
codec values, explicit work stacks and a depth limit of 1,000.

The Rust core also includes `atomic::AtomicMachine` for exclusive temporary
writes, ten collision retries, rename and cleanup. It executes through injected
platform requests and preserves host error tokens. Terminal states release owned
buffers immediately. This is an internal foundation
for the remaining handlers; it is not a new public npm API.

Template execution, template factories and the original
root/testing exports remain under development. It is not integrated into
applications. JSON nesting is bounded to 512
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

In-memory file mutation measurements take about 13–18 µs in the native binding
versus 2–3 µs in TypeScript. Real filesystem latency is additional. The finite
memory check retains about the same JS heap and more native-process RSS; it does
not establish a speedup, memory reduction or universal stability guarantee.

A 16 KiB backup/restore round trip in memfs takes about212 µs native versus160 µs
in TypeScript on Node22/macOSARM64. A separate controlled-host run of5120 cycles
levels near109 MB RSS for native and78 MB for TypeScript, with about8.9 MB retained
JS heap either. These results do not show a general speed or memory advantage.

A 64-field JSON merge/prune/transform round trip on the same platform takes
about 223 µs native versus 180 µs in TypeScript. A controlled-host check of 5,120
round trips retains about 104/106 MB RSS and 9.1/9.5 MB JS heap respectively;
both implementations are loaded in each process. This finite check does not
establish a general memory advantage or leak-free guarantee.
