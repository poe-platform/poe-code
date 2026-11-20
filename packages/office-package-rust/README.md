# office-package-rust

Inspect and assemble owned Office package parts, parse their XML, and serialize
them as a deterministic ZIP archive using Rust's standard library.

```rust
use office_package_rust::{Package, Part};
let package = Package { parts: vec![Part::new("word/document.xml", b"<document/>".to_vec())] };
let bytes = package.write()?;
# Ok::<(), String>(())
```

`write_async().await` uses the same serializer, yielding while validating parts,
calculating CRCs and copying archive data. Hosts can cancel by dropping the future
between polls; synchronous `write()` drives it to completion.

`Package.parts` remains editable until serialization. `write` rejects duplicate,
absolute or escaping names and oversized archives. The `xml` module exposes the
existing namespace-aware streaming parser used by the Rust shell. Shared shell
and document consumers use the same implementations.
