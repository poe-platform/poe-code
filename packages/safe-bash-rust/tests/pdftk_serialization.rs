use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn document() -> Vec<u8> {
    let bodies = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
        "<< /Length 16 /Custom (keep) >>\nstream\nBT (hello) Tj ET\nendstream",
    ];
    let mut out = String::from("%PDF-1.7\n");
    let mut offsets = Vec::new();
    for (i, body) in bodies.iter().enumerate() {
        offsets.push(out.len());
        out.push_str(&format!("{} 0 obj\n{body}\nendobj\n", i + 1));
    }
    let start = out.len();
    out.push_str("xref\n0 5\n0000000000 65535 f \n");
    for offset in offsets { out.push_str(&format!("{offset:010} 00000 n \n")); }
    out.push_str(&format!("trailer << /Size 5 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n"));
    out.into_bytes()
}

#[test]
fn pdftk_stream_modes_preserve_dictionary_order_without_changing_qpdf_compression() {
    let fs = Arc::new(MemoryVfs::new());
    let input = document();
    fs.write_file("/in", &input).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    // Exact dictionaries captured from independently executed JavaScript commands.
    for (command, expected) in [
        ("pdftk in output out", "4 0 obj\n<<\n/Length 16\n/Custom (keep)\n>>\nstream\n"),
        ("pdftk in output out compress", "4 0 obj\n<<\n/Length 24\n/Custom (keep)\n/Filter /FlateDecode\n>>\nstream\n"),
        ("pdftk in output out uncompress", "4 0 obj\n<<\n/Length 16\n/Custom (keep)\n>>\nstream\n"),
        ("qpdf in out", "4 0 obj\n<<\n/Custom (keep)\n/Filter /FlateDecode\n/Length 24\n>>\nstream\n"),
    ] {
        let result = shell.exec(command).unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""), "{command}");
        let output = fs.read_file("/out").unwrap();
        assert!(output.windows(expected.len()).any(|bytes| bytes == expected.as_bytes()), "{command}: {}", String::from_utf8_lossy(&output));
        let text = shell.exec("qpdf out --show-object=4 --filtered-stream-data").unwrap();
        assert_eq!((text.exit_code, text.stdout.as_str(), text.stderr.as_str()), (0, "BT (hello) Tj ET", ""), "{command}");
        assert_eq!(fs.read_file("/in").unwrap(), input);
    }
}
