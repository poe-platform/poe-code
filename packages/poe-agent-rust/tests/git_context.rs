use poe_agent_rust::context_plugins::git_context;
#[test]
fn git_context_keeps_exact_host_coercions_and_newlines() {
    let units = |s: &str| s.encode_utf16().collect::<Vec<_>>();
    assert_eq!(
        git_context(&[
            units("system"),
            units("## Git context"),
            units("M file\n"),
            units("abc commit\n")
        ])
        .unwrap(),
        units("system\n## Git context\nM file\n\nabc commit\n")
    );
    assert_eq!(
        git_context(&[vec![0xd800], vec![0xdc00]]).unwrap(),
        vec![0xd800, 10, 0xdc00]
    );
    assert!(git_context(&[vec![1; 8388608], vec![2]]).is_err());
}
