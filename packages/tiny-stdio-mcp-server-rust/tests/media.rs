use tiny_stdio_mcp_server_rust::media::RemoteBytes;

#[test]
fn remote_bytes_admit_exact_limit_and_discard_overflow_without_recovery() {
    let mut bytes = RemoteBytes::new(3);
    assert!(bytes.append(&[1, 2]).unwrap());
    assert!(bytes.append(&[3]).unwrap());
    assert_eq!(bytes.take(), vec![1, 2, 3]);
    let mut overflow = RemoteBytes::new(2);
    assert!(overflow.append(&[1]).unwrap());
    assert!(!overflow.append(&[2, 3]).unwrap());
    assert!(!overflow.append(&[4]).unwrap());
    assert!(overflow.take().is_empty());
}
