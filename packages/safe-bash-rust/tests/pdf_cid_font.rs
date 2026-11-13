use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
use std::collections::BTreeMap;
const PDF: &[u8] = include_bytes!("fixtures/cid-truetype.pdf");
fn field(case: &Value, key: &str) -> String {
    let Some(Value::String(s)) = case.get(key) else {
        return String::new();
    };
    String::from_utf16(s).unwrap()
}

#[test]
fn identity_h_embedded_truetype_public_commands() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/cid-font-cases.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    for command in ["pdftoppm", "pdftocairo"] {
        let mut outputs = BTreeMap::new();
        for case in &cases {
            let name = field(case, "name");
            let mut bytes = PDF.to_vec();
            bytes.extend_from_slice(field(case, "update").as_bytes());
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &bytes).unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            let png = fs.read_file("/page.png").unwrap();
            if field(case, "expected") == "error" {
                assert_ne!(result.exit_code, 0, "{command} {name}");
                assert_eq!(png, b"existing", "{command} {name}");
            } else {
                assert_eq!(result.exit_code, 0, "{command} {name}: {}", result.stderr);
                if field(case, "expected") == "visible" {
                    assert!(png.len() > 300, "{command} {name}");
                }
                let same = field(case, "same");
                if !same.is_empty() {
                    assert_eq!(&png, outputs.get(&same).unwrap(), "{command} {name}");
                }
                outputs.insert(name, png);
            }
        }
    }
}
