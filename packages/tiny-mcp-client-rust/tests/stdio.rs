use tiny_mcp_client_rust::stdio::StderrTail;
#[test]
fn bounded_stderr_keeps_the_last_utf16_units_including_split_surrogates() {
    let mut tail = StderrTail::default();
    assert_eq!(tail.snapshot(), Vec::<u16>::new());
    tail.append(&vec![65; 65535]);
    tail.append(&[0xd83e, 0xdd8a]);
    assert_eq!(tail.snapshot().len(), 65536);
    assert_eq!(&tail.snapshot()[65534..], &[0xd83e, 0xdd8a]);
    tail.append(&vec![66; 65535]);
    assert_eq!(tail.snapshot()[0], 0xdd8a);
    tail.append(&vec![67; 100000]);
    assert_eq!(tail.snapshot(), vec![67; 65536]);
    tail.append(&[]);
    assert_eq!(tail.snapshot().len(), 65536);
}
