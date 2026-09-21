use toolcraft_design_rust::acp_events::render;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn custom_tool_kinds_fall_back_and_reasoning_truncates_utf16() {
    let event = render(
        "tool_start",
        false,
        &u("toString"),
        &u("read config"),
        &[],
        &[],
    );
    assert_eq!(event.style, "dim");
    assert_eq!(event.text, u("  → toString: read config"));
    let event = render("reasoning", true, &u(&"🌍".repeat(100)), &[], &[], &[]);
    let mut expected = u("- *thinking:* ");
    expected.extend(u(&"🌍".repeat(100))[..77].iter());
    expected.extend(u("..."));
    assert_eq!(event.text, expected);
}
#[test]
fn usage_and_permission_formats_use_owned_business_text() {
    assert_eq!(
        render(
            "usage",
            false,
            &u("1500"),
            &u("350"),
            &u(" (800 cached)"),
            &u(" ($0.01)")
        )
        .text,
        u("· tokens: 1500 in (800 cached) → 350 out ($0.01)")
    );
    assert_eq!(
        render("permission_rejected", true, &u("Command"), &[], &[], &[]).text,
        u("- **permission rejected:** Command")
    );
}
