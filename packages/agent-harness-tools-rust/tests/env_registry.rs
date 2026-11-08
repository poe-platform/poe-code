use agent_harness_tools_rust::env_registry::{MAX_FACTORIES, Registry};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn factory_slots_are_stable_on_replacement_and_keys_remain_exact() {
    let mut registry = Registry::default();
    assert_eq!(registry.get(&u("host")), None);
    assert_eq!(registry.register(u("host")), Ok(0));
    assert_eq!(registry.register(u("docker")), Ok(1));
    assert_eq!(registry.register(u("host")), Ok(0));
    assert_eq!(registry.get(&u("Host")), None);
    assert_eq!(registry.register(vec![0xd800]), Ok(2));
    assert_eq!(registry.get(&[0xd800]), Some(2));
}
#[test]
fn registry_capacity_rejects_transactionally_but_existing_keys_can_be_replaced() {
    let mut registry = Registry::default();
    for index in 0..MAX_FACTORIES {
        assert_eq!(registry.register(u(&index.to_string())), Ok(index as u32));
    }
    assert!(registry.register(u("overflow")).is_err());
    assert_eq!(registry.get(&u("overflow")), None);
    assert_eq!(registry.register(u("0")), Ok(0));
}
