# Rust Lua evaluator

Run document-filter Lua directly in Rust or WebAssembly, without a JavaScript engine or native Lua installation.

```rust
use lua_rust::{Runtime, Value};

let mut lua = Runtime::new(1_000_000);
let values = lua.run("return string.upper('hello')", "filter.lua").unwrap();
assert_eq!(values, vec![Value::String("HELLO".into())]);
```

The evaluator supports functions and closures, multiple results and variadic arguments, tables and metatables, conditional statements, loops, and string, table, math and UTF-8 helpers. String patterns support `find`, `match`, independent `gmatch` iterators, and `gsub` with capture templates, callbacks or lookup tables. Character classes, captures, backreferences, balanced pairs and frontier patterns follow the existing Pandoc Lua engine. Each runtime owns its tables, captured variables and functions; dropping it releases those values together.

This is not yet a complete Lua 5.3 implementation. String formatting, binary strings, exact 64-bit integer arithmetic, complete scope validation and the remaining standard-library functions still need parity work. Pandoc uses its shared Lua constructors and traversal code with this evaluator.
