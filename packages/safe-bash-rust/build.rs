fn main() {
    if std::env::var("TARGET").as_deref() == Ok("wasm32-unknown-unknown") {
        // Let a host install a typed stdin callback without adding a required import.
        println!("cargo::rustc-link-arg-cdylib=--export-table");
        println!("cargo::rustc-link-arg-cdylib=--growable-table");
    }
}
