# config-mutations-rust

Edit JSON configuration without losing comments, with no npm runtime dependencies.
This private additive rewrite leaves your existing configuration integrations intact.

```ts
import {jsonFormat,modifyAtPath} from '@poe-code/config-mutations-rust/json';

const config=jsonFormat.parse('{ // preserved\n "enabled":true,\n}');
const updated=modifyAtPath('{ // preserved\n "enabled":true,\n}', ['enabled'], false);
```

The own Rust parser and editor preserve UTF-16 strings, trailing commas, indentation,
line endings and unaffected comments. Node supplies serialization and property
operations that retain Date, getter, array-hole and patch-reference behavior.
The Rust codec is independent of Node and uses only std and own path crates.

This is the JSON foundation of the ongoing rewrite. TOML, YAML, mutation execution
and the original root/testing exports are not available yet. It is not integrated
into applications. Nested input is bounded to 512 levels; malformed edit input
is rejected rather than recovered by the development oracle's tolerant editor.
Unlike the original JSONC parser, `__proto__` keys are retained as ordinary own
data properties instead of being lost through a prototype assignment.
Removing the final array item also fixes an SDK bug that joins adjacent numbers
(`remove [1,2,3] at index 2` returns `[1,2]`, instead of `[1,23]`).
