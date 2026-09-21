use poe_agent_rust::caller_ack::Pending;
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn pending_acknowledgements_preserve_identity_order_and_reuse() {
    let mut state = Pending::default();
    assert_eq!(state.insert(units("a")).unwrap(), Some(0));
    assert_eq!(state.insert(units("b")).unwrap(), Some(1));
    assert_eq!(state.insert(units("a")).unwrap(), None);
    assert_eq!(state.take(&units("a")), Some(0));
    assert_eq!(state.take(&units("a")), None);
    assert_eq!(state.insert(units("a")).unwrap(), Some(2));
    assert_eq!(state.drain(), vec![1, 2]);
    assert!(state.drain().is_empty());
    assert_eq!(state.insert(vec![0xd800]).unwrap(), Some(0));
    assert_eq!(state.insert(vec![0xfffd]).unwrap(), Some(1));
    assert_eq!(state.take(&[0xd800]), Some(0));
    assert_eq!(state.drain(), vec![1]);
}
#[test]
fn repeated_acknowledgements_do_not_grow_the_pending_slot_store() {
    let mut state = Pending::default();
    for _ in 0..16384 {
        assert_eq!(state.insert(units("tool")).unwrap(), Some(0));
        assert_eq!(state.take(&units("tool")), Some(0));
    }
    assert!(state.drain().is_empty());
}

#[test]
fn acknowledgement_limits_reject_without_losing_existing_requests() {
    let mut state = Pending::default();
    assert_eq!(state.insert(vec![0; 1048576]).unwrap(), Some(0));
    assert!(state.insert(vec![1]).is_err());
    assert_eq!(state.drain(), vec![0]);
    for i in 0..4096 {
        assert_eq!(state.insert(vec![i as u16]).unwrap(), Some(i));
    }
    assert!(state.insert(vec![5000]).is_err());
    assert_eq!(state.drain().len(), 4096);
    assert_eq!(state.insert(vec![5000]).unwrap(), Some(0));
}
