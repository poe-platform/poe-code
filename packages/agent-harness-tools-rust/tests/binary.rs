use agent_harness_tools_rust::binary::{detectors, valid};
#[test]
fn fallback_passes_exact_utf16_name_as_a_positional_argument() {
    let name = [109, 105, 115, 115, 105, 110, 103, 34, 59, 32, 0xd800];
    let specs = detectors(&name);
    assert_eq!(specs.len(), 3);
    assert_eq!(specs[0].command, "which");
    assert_eq!(specs[1].command, "where");
    assert_eq!(specs[2].command, "sh");
    assert_eq!(specs[2].args[0], "-c".encode_utf16().collect::<Vec<_>>());
    assert_eq!(specs[2].args[2], "sh".encode_utf16().collect::<Vec<_>>());
    assert_eq!(specs[2].args[3], name);
    let script = String::from_utf16(&specs[2].args[1]).unwrap();
    assert!(script.contains("\"$directory/$1\""));
    assert!(!script.contains("missing"));
}
#[test]
fn detector_success_requires_output_only_for_windows() {
    assert!(valid(0, true, false));
    assert!(!valid(0, false, true));
    assert!(!valid(1, true, false));
    assert!(valid(1, true, true));
    assert!(valid(2, true, false));
    assert!(!valid(3, true, true));
}
