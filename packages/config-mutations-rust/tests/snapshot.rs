use config_mutations_rust::{snapshot::decode, value::Value};
fn text(output: &mut Vec<u8>, value: &[u16]) {
    output.extend((value.len() as u32).to_le_bytes());
    for unit in value {
        output.extend(unit.to_le_bytes());
    }
}
#[test]
fn binary_snapshot_preserves_foreign_tokens_and_unpaired_utf16() {
    let mut bytes = vec![10];
    bytes.extend(2_u32.to_le_bytes());
    text(&mut bytes, &[0xd800]);
    bytes.push(8);
    text(&mut bytes, &[52, 50]);
    text(&mut bytes, &[97]);
    bytes.push(1);
    assert_eq!(
        decode(&bytes).unwrap(),
        Value::Object(vec![
            (vec![0xd800], Value::Unsupported(vec![52, 50])),
            (vec![97], Value::Undefined)
        ])
    );
}
#[test]
fn binary_snapshot_rejects_truncation_extra_data_and_depth_overflow() {
    assert!(decode(&[5, 1, 0, 0, 0, 65]).is_err());
    assert!(decode(&[0, 0]).is_err());
    let mut bytes = vec![];
    for _ in 0..1002 {
        bytes.push(9);
        bytes.extend(1_u32.to_le_bytes());
    }
    bytes.push(0);
    assert!(decode(&bytes).is_err());
}
