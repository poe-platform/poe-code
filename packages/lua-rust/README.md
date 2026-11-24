# Rust Lua evaluator

Run document-filter Lua directly in Rust or WebAssembly, without a JavaScript engine or native Lua installation.

```rust
use lua_rust::{Runtime, Value};

let mut lua = Runtime::new(1_000_000);
let values = lua.run("return string.upper('hello')", "filter.lua").unwrap();
assert_eq!(values, vec![Value::String("HELLO".into())]);
```

The evaluator supports functions and closures, multiple results and variadic arguments, tables and metatables (including shared string metatables, operator callbacks and chained indexing), conditional statements, loops, and string, table, math and UTF-8 helpers. `string.format` supports numeric fields, hexadecimal floats, quoted Lua values, padding and precision, and custom `__tostring` callbacks. It preserves raw bytes and the existing engine’s UTF-16 string-precision behavior. Binary strings support `string.pack`, `string.unpack`, and `string.packsize`, including byte order, alignment, integer and floating-point fields, and fixed, length-prefixed or zero-terminated strings. String patterns support `find`, `match`, independent `gmatch` iterators, and `gsub` with capture templates, callbacks or lookup tables. Character classes, captures, backreferences, balanced pairs and frontier patterns follow the existing Pandoc Lua engine. `math.randomseed` reproduces existing seeded random sequences, `math.random` supports unit fractions and integer intervals, and `math.ult` compares unsigned 32-bit values. Global reads and writes follow lexical `_ENV` bindings and table metatables. Successive `run` calls share their root environment cell, while local bindings stay within each chunk. Labels and `goto` preserve lexical scope and captured values; invalid jumps and misplaced `break` statements are rejected before execution. `...` is accepted only within the current variadic function or the top-level chunk. Table insert/remove, concat/unpack and sort honor length callbacks, nil defaults and integer positions. Moves preserve overlap direction and callback order; sorting supports comparison callbacks and string metatables. `table.remove` preserves existing elements when removing just after the end. `string.byte`, `string.sub`, and `string.rep` accept explicit nil defaults, validate signed 32-bit positions/counts, and preserve empty ranges and byte strings. Repetition checks combined string/separator length before producing output. Each runtime owns its random state, tables, captured variables and functions; dropping it releases those values together.

Source strings and identifiers retain the streaming Pandoc engine’s interning behavior, including its existing collisions. Interned names preserve raw bytes in globals, locals, closures and methods.

Lua strings retain arbitrary bytes through character construction, slicing, reversal, concatenation, patterns and replacements. `Value::String` stores `Vec<u8>`, and `Runtime::run` accepts text or source bytes. UTF-8 helpers use byte positions and preserve the existing Lua engine's handling of surrogate code points. Pandoc validates UTF-8 when those bytes become document text.

Numbers distinguish signed 32-bit integers from binary64 floats, matching the existing Pandoc Lua engine. `tonumber(value, base)` retains the existing engine’s digit-prefix parsing and large-number rounding for bases 2–36. Integer arithmetic wraps; shifts, decimal and hexadecimal coercion, numeric loops, and 14-digit float text retain those types. `Value::Integer` and `Value::Number` compare numerically across types.

This is not yet a complete Lua 5.3 implementation. Complete scope validation and the remaining exposed library functions still need parity work. Pandoc uses its shared Lua constructors and traversal code with this evaluator.
