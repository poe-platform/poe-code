use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn inline_svg_does_not_swallow_the_following_html_paragraph() {
    let fs = MemoryVfs::new();
    fs.write_file("/chart.html", br#"<h2>Chart</h2><p><a href="/key">Legend</a></p><svg width="200" height="64"><g><rect x="2" y="4" width="73.5" height="18"/><text x="8" y="16">Part <tspan>A</tspan></text></g><rect x="0x4" y="24"/><text y="39"> B &amp; C </text><circle r="15"/></svg><p>After diagram</p>"#).unwrap();
    let mut shell = Shell::new(
        Arc::new(fs),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec("wkhtmltopdf /chart.html /chart.pdf && pdftotext /chart.pdf -")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let mut remaining = result.stdout.as_str();
    for expected in ["Chart", "Legend", "Part A", "B & C", "After diagram"] {
        let at = remaining
            .find(expected)
            .unwrap_or_else(|| panic!("missing {expected}: {}", result.stdout));
        remaining = &remaining[at + expected.len()..];
    }
}
