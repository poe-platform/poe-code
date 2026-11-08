use mcp_protocol_rust::json::Value;
use toolcraft_design_rust::layout::compute;
#[test]
fn readable_and_compact_layouts_follow_terminal_threshold() {
    let wide = compute([80.0, 24.0, 1.0, 1.0, 25.0]);
    assert_eq!(
        wide.get("leftPane").unwrap().get("width"),
        Some(&Value::Number(52.0))
    );
    assert!(wide.get("summary").is_none());
    let compact = compute([60.0, 24.0, 1.0, 1.0, 25.0]);
    assert_eq!(
        compact.get("summary").unwrap().get("height"),
        Some(&Value::Number(2.0))
    );
    assert_eq!(
        compact.get("leftPane").unwrap().get("width"),
        Some(&Value::Number(58.0))
    );
    assert_eq!(
        compact.get("rightPane").unwrap().get("width"),
        Some(&Value::Number(0.0))
    );
}
#[test]
fn dimensions_are_clipped_without_inventing_room_in_empty_terminals() {
    let empty = compute([-1.0, -1.0, 1.0, 1.0, 25.0]);
    assert_eq!(
        empty.get("outerBorder").unwrap().get("width"),
        Some(&Value::Number(0.0))
    );
    assert!(empty.get("summary").is_none());
    let fractional = compute([80.9, 24.9, 1.9, 1.9, 25.9]);
    assert_eq!(fractional, compute([80.0, 24.0, 1.0, 1.0, 25.0]));
}
