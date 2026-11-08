use poe_agent_rust::plugin_config::{Names, distance};
#[test]
fn plugin_names_and_edit_distances_preserve_utf16_units() {
    let mut names = Names::default();
    let name: Vec<_> = "web".encode_utf16().collect();
    assert!(!names.contains(&name));
    assert!(names.insert(name.clone()));
    assert!(names.contains(&name));
    assert!(!names.insert(name));
    assert_eq!(
        distance(
            &"shel".encode_utf16().collect::<Vec<_>>(),
            &"shell".encode_utf16().collect::<Vec<_>>()
        ),
        1
    );
    assert_eq!(distance(&[0xd800], &[0xdfff]), 1);
    assert_eq!(distance(&[0xd83c, 0xdf0d], &[]), 2);
    assert_eq!(distance(&vec![120; 65536], &[120]), 65535);
}
