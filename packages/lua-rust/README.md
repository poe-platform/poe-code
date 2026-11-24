# Rust Lua evaluator

Run document-filter Lua directly in Rust or WebAssembly, without a JavaScript engine or native Lua installation.

```rust
use lua_rust::{Runtime, Value};

let mut lua = Runtime::new(1_000_000);
let values = lua.run("return string.upper('hello')", "filter.lua").unwrap();
assert_eq!(values, vec![Value::String("HELLO".into())]);
```

The evaluator supports functions and closures, multiple results and variadic arguments, tables and metatables, conditional statements, loops, and string, table, math and UTF-8 helpers. String patterns support `find`, `match`, independent `gmatch` iterators, and `gsub` with capture templates, callbacks or lookup tables. Character classes, captures, backreferences, balanced pairs and frontier patterns follow the existing Pandoc Lua engine. Each runtime owns its tables, captured variables and functions; dropping it releases those values together.

Lua strings retain arbitrary bytes through character construction, slicing, reversal, concatenation, patterns and replacements. `Value::String` stores `Vec<u8>`, and `Runtime::run` accepts text or source bytes. UTF-8 helpers use byte positions and preserve the existing Lua engine's handling of surrogate code points. Pandoc validates UTF-8 when those bytes become document text.

Numbers distinguish signed 32-bit integers from binary64 floats, matching the existing Pandoc Lua engine. Integer arithmetic wraps; shifts, decimal and hexadecimal coercion, numeric loops, and 14-digit float text retain those types. `Value::Integer` and `Value::Number` compare numerically across types.

This is not yet a complete Lua 5.3 implementation. String formatting, explicit-base number conversion, complete scope validation and the remaining exposed library functions still need parity work. Pandoc uses its shared Lua constructors and traversal code with this evaluator.
