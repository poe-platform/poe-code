use agent_harness_tools_rust::log_stream::{
    complete_utf8_prefix, decimal_exit_code, safe_job_id, tee_command,
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn job_components_reject_traversal_slashes_and_nul_but_preserve_quotes() {
    for input in ["", ".", "..", "../outside", "a/b", "a\\b", "nul\0id"] {
        assert!(!safe_job_id(&u(input)));
    }
    for input in ["quote'id", "..safe", "😀", " ", "a\nb"] {
        assert!(safe_job_id(&u(input)));
    }
}
#[test]
fn utf8_prefix_withholds_only_incomplete_final_sequence() {
    for (bytes, size) in [
        (&b"abc"[..], 3),
        (&[0xf0, 0x9f][..], 0),
        (&[65, 0xe2, 0x82][..], 1),
        (&[0xe2, 0x82, 0xac][..], 3),
        (&[0x80, 0x80][..], 2),
        (&[0xff][..], 1),
    ] {
        assert_eq!(complete_utf8_prefix(bytes), size);
    }
}
#[test]
fn exit_codes_admit_canonical_nonnegative_decimal_including_overflow() {
    assert_eq!(decimal_exit_code(&u("0")), Some(0.0));
    assert_eq!(decimal_exit_code(&u("255")), Some(255.0));
    for input in ["00", "01", "-1", "+1", " 1", "1.0", "1e3", ""] {
        assert_eq!(decimal_exit_code(&u(input)), None);
    }
    assert_eq!(decimal_exit_code(&u(&"9".repeat(400))), Some(f64::INFINITY));
}
#[test]
fn tee_quotes_every_argument_and_guards_all_managed_targets() {
    let command = tee_command(&[u("echo"), u("a'b")], &u("job'id")).unwrap();
    assert_eq!(command[0], u("sh"));
    assert_eq!(command[1], u("-c"));
    let text = String::from_utf16(&command[2]).unwrap();
    assert!(text.contains("'echo' 'a'\\''b'"));
    assert!(text.contains("test ! -L '/tmp/poe-jobs'"));
    assert!(text.contains("job'\\''id.exit.tmp"));
    assert!(tee_command(&[], &u("job")).is_err());
    assert!(tee_command(&[u("echo")], &u("../bad")).is_err());
}
