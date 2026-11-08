use auth_store_rust::cache::DerivedKeyCache;
fn text(value: usize) -> Vec<u16> {
    value.to_string().encode_utf16().collect()
}
#[test]
fn derived_keys_have_bounded_lru_retention_and_overwrite_in_place() {
    let mut cache = DerivedKeyCache::default();
    for index in 0..64 {
        cache.insert(&text(index), &[index as u8; 32]).unwrap();
    }
    assert_eq!(cache.size(), 64);
    assert_eq!(cache.lookup(&text(0)), Some([0; 32]));
    cache.insert(&text(64), &[64; 32]).unwrap();
    assert_eq!(cache.lookup(&text(1)), None);
    assert_eq!(cache.lookup(&text(0)), Some([0; 32]));
    cache.insert(&text(64), &[7; 32]).unwrap();
    assert_eq!(cache.size(), 64);
    assert_eq!(cache.lookup(&text(64)), Some([7; 32]));
    assert!(cache.insert(&text(65), &[0; 31]).is_err());
    assert_eq!(cache.size(), 64);
}
#[test]
fn cache_does_not_retain_unbounded_identity_keys_and_preserves_utf16() {
    let mut cache = DerivedKeyCache::default();
    let huge = vec![65; 16385];
    cache.insert(&huge, &[0; 32]).unwrap();
    assert_eq!(cache.size(), 0);
    let key = [0xd800, 0];
    cache.insert(&key, &[9; 32]).unwrap();
    assert_eq!(cache.lookup(&key), Some([9; 32]));
}
