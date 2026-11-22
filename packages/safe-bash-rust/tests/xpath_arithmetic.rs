use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn xpath_multiplication_division_and_remainder_preserve_precedence_and_node_paths() {
    let fs = MemoryVfs::new();
    fs.write_file("/doc", b"<r><a n='2'><n>1</n></a><a n='4'><n>2</n></a><a n='6'><n>3</n></a></r>").unwrap();
    let mut shell = Shell::new(Arc::new(fs), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for (query, expected) in [
        ("1 mod 2", "1"), ("5 div 2", "2.5"), ("3+4*2", "11"),
        ("8 div 2 * 3", "12"), ("-5 mod 2", "-1"), ("5 mod -2", "1"),
        ("count(//a[position() mod 2=1])", "2"),
        ("count(//a[position()*2=4])", "1"),
        ("count(//a[n*2=4])", "1"), ("count(//a[* * 2=4])", "1"),
        ("count(//a[n div 2=1])", "1"), ("count(//a[n mod 2=1])", "2"),
        ("/r/a[1]/n*2", "2"), ("count(/r/*)", "3"),
        ("count(//a[-number(@n) + 2 = 0])", "1"),
    ] {
        let result = shell.exec(&format!("xmllint --xpath '{query}' /doc")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, format!("{expected}\n").as_str(), ""), "{query}");
    }
}
