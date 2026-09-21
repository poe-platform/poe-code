use task_list_rust::{Event, Machine, printable_identifier, task_id, visible_name};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn machine() -> Machine {
    Machine {
        initial: text("draft"),
        states: ["draft", "planned", "in-progress", "done", "archived"]
            .map(text)
            .to_vec(),
        events: vec![
            Event {
                name: text("plan"),
                from: Some(vec![text("draft")]),
                to: text("planned"),
            },
            Event {
                name: text("start"),
                from: Some(vec![text("planned")]),
                to: text("in-progress"),
            },
            Event {
                name: text("complete"),
                from: Some(vec![text("in-progress")]),
                to: text("done"),
            },
            Event {
                name: text("archive"),
                from: None,
                to: text("archived"),
            },
        ],
    }
}
#[test]
fn ordered_events_and_terminal_exclusion() {
    let m = machine();
    assert_eq!(m.validate(), Ok(()));
    assert_eq!(m.events_from(&text("draft")), vec![0, 3]);
    assert_eq!(m.events_from(&text("archived")), Vec::<usize>::new());
    assert_eq!(m.find_event(&text("done"), &text("archive")), Some(3));
    assert_eq!(m.find_event(&text("done"), &text("plan")), None);
}
#[test]
fn default_legacy_reverse_is_separate_from_custom_events() {
    let m = machine();
    assert!(m.can_transition(&text("planned"), &text("draft"), true));
    assert!(!m.can_transition(&text("planned"), &text("draft"), false));
    assert!(!m.can_transition(&text("done"), &text("draft"), true));
    assert!(!m.can_transition(&text("archived"), &text("done"), true));
}
#[test]
fn breadth_first_path_is_shortest_and_ordered() {
    let m = machine();
    assert_eq!(m.path(&text("draft"), &text("done")), Some(vec![0, 1, 2]));
    assert_eq!(m.path(&text("draft"), &text("archived")), Some(vec![3]));
    assert_eq!(m.path(&text("done"), &text("done")), Some(vec![]));
    assert_eq!(m.path(&text("archived"), &text("draft")), None);
}
#[test]
fn ecmascript_whitespace_and_utf16_identity() {
    for unit in [
        0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f,
        0x205f, 0x3000, 0xfeff,
    ] {
        assert!(!visible_name(&[unit]));
        assert!(!printable_identifier(&[unit, 97]));
    }
    assert!(visible_name(&[0x85]));
    assert!(printable_identifier(&[0xd800]));
    assert!(task_id(&[0xd800]));
    for value in ["", ".x", "a..b", "a/b", "a\\b", "a\u{7f}", " a", "a "] {
        assert!(!task_id(&text(value)), "{value:?}");
    }
    assert!(task_id(&text("issue:2")));
}
#[test]
fn validation_reports_first_invalid_definition() {
    let mut m = machine();
    m.initial = text("missing");
    assert!(m.validate().unwrap_err().contains("Initial state"));
    m.initial = text("draft");
    m.events[0].to = text("missing");
    assert!(m.validate().unwrap_err().contains("target state"));
    m.events[0].to = text("planned");
    m.events[0].from = Some(vec![text("missing")]);
    assert!(m.validate().unwrap_err().contains("source state"));
    m.events[0].name = text(" ");
    assert_eq!(m.validate().unwrap_err(), "Event names must not be empty.");
}
#[test]
fn cycles_and_duplicate_states_do_not_break_search() {
    let mut m = machine();
    m.states.push(text("draft"));
    m.events.push(Event {
        name: text("reset"),
        from: Some(vec![text("planned")]),
        to: text("draft"),
    });
    assert_eq!(m.validate(), Ok(()));
    assert_eq!(m.path(&text("draft"), &text("missing")), None);
}
