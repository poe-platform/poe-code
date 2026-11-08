use poe_agent_rust::config::{Graph, normalize_name};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn dependency_effects_are_lazy_stable_and_deduplicated() {
    let mut graph = Graph::default();
    assert_eq!(graph.add(text(" app ")).unwrap(), 0);
    assert_eq!(graph.add(text(" dependency ")).unwrap(), 1);
    assert_eq!(graph.begin(&text("app")).unwrap(), Some(0));
    assert_eq!(
        graph
            .load(vec![text(" dependency "), text("dependency"), text(" ")])
            .unwrap(),
        Some(1)
    );
    assert_eq!(graph.load(vec![]).unwrap(), None);
    assert_eq!(graph.begin(&text("dependency")).unwrap(), None);
    assert_eq!(graph.order(), &[1, 0]);
}
#[test]
fn duplicate_missing_self_and_cycle_diagnostics_preserve_names() {
    assert_eq!(
        normalize_name(&text(" "), &text("Plugin")),
        Err(text("Plugin name must be a non-empty string."))
    );
    let mut graph = Graph::default();
    graph.add(text("a")).unwrap();
    graph.add(text("b")).unwrap();
    assert_eq!(
        graph.add(text(" a ")),
        Err(text("Duplicate plugin name \"a\"."))
    );
    graph.begin(&text("a")).unwrap();
    assert_eq!(graph.load(vec![text("b")]).unwrap(), Some(1));
    assert_eq!(
        graph.load(vec![text("a")]),
        Err(text(
            "Circular plugin dependencies detected: \"a\" -> \"b\" -> \"a\"."
        ))
    );
    let mut graph = Graph::default();
    graph.add(text("a")).unwrap();
    graph.begin(&text("a")).unwrap();
    assert_eq!(
        graph.load(vec![text("a")]),
        Err(text("Plugin \"a\" cannot depend on itself."))
    );
    let mut graph = Graph::default();
    graph.add(text("a")).unwrap();
    graph.begin(&text("a")).unwrap();
    assert_eq!(
        graph.load(vec![text("missing")]),
        Err(text(
            "Unknown plugin dependency \"missing\" for plugin \"a\"."
        ))
    );
}

#[test]
fn invalid_planner_sequences_reject_instead_of_panicking() {
    let mut graph = Graph::default();
    assert!(graph.load(vec![]).is_err());
    graph.add(text("a")).unwrap();
    graph.begin(&text("a")).unwrap();
    assert!(graph.begin(&text("a")).is_err());
    assert!(graph.add(text("b")).is_err());
    graph.load(vec![]).unwrap();
    assert!(graph.load(vec![]).is_err());
}

#[test]
fn deep_acyclic_graphs_use_owned_frames_without_native_recursion() {
    let mut graph = Graph::default();
    for index in 0..20_000 {
        graph.add(text(&format!("p{index}"))).unwrap();
    }
    assert_eq!(graph.begin(&text("p0")).unwrap(), Some(0));
    for index in 1..20_000 {
        assert_eq!(
            graph.load(vec![text(&format!("p{index}"))]).unwrap(),
            Some(index)
        );
    }
    assert_eq!(graph.load(vec![]).unwrap(), None);
    assert_eq!(graph.order().len(), 20_000);
    assert_eq!(graph.order()[0], 19_999);
    assert_eq!(graph.order()[19_999], 0);
}
