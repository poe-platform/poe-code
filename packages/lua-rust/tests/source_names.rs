use lua_rust::Runtime;

#[test]
fn plain_source_names_shorten_at_byte_and_line_boundaries() {
    for (source, shown) in [
        ("a".repeat(44), "a".repeat(44)),
        ("a".repeat(45), format!("{}...", "a".repeat(45))),
        ("a".repeat(46), format!("{}...", "a".repeat(45))),
        ("first\nsecond".into(), "first...".into()),
        (
            format!("{}Ω", "a".repeat(44)),
            format!("{}�...", "a".repeat(44)),
        ),
    ] {
        let error = Runtime::new(100_000)
            .run("error('broken')", &source)
            .unwrap_err();
        assert_eq!(error.to_string(), format!("[string \"{shown}\"]:1: broken"));
        assert_eq!(error.location, Some((source, 1)));
    }
}

#[test]
fn file_source_names_keep_the_short_name_or_last_57_bytes() {
    for (source, shown) in [
        ("@file.lua".into(), "file.lua".into()),
        (format!("@{}", "a".repeat(59)), "a".repeat(59)),
        (
            format!("@{}", "a".repeat(60)),
            format!("...{}", "a".repeat(57)),
        ),
        (
            format!("@{}", "Ω".repeat(30)),
            format!("...�{}", "Ω".repeat(28)),
        ),
    ] {
        let error = Runtime::new(100_000)
            .run("error('broken')", &source)
            .unwrap_err();
        assert_eq!(error.to_string(), format!("{shown}:1: broken"));
    }
}

#[test]
fn literal_source_names_keep_the_first_60_bytes() {
    for (source, shown) in [
        ("=label".into(), "label".into()),
        (format!("={}", "a".repeat(60)), "a".repeat(60)),
        (format!("={}", "a".repeat(61)), "a".repeat(60)),
        (
            format!("={}Ω", "a".repeat(59)),
            format!("{}�", "a".repeat(59)),
        ),
    ] {
        let error = Runtime::new(100_000)
            .run("error('broken')", &source)
            .unwrap_err();
        assert_eq!(error.to_string(), format!("{shown}:1: broken"));
    }
}
