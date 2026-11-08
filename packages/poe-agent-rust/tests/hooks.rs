use poe_agent_rust::hooks::{Catalog, Pipeline, Plan, Primitive};
#[test]
fn hook_catalog_and_pipeline_keep_live_order_and_first_defined_decision() {
    let mut catalog = Catalog::default();
    catalog.add("preToolUse", 0);
    catalog.add("preToolUse", 1);
    assert_eq!(catalog.get("preToolUse", 0), Some(0));
    catalog.add("preToolUse", 2);
    assert_eq!(catalog.get("preToolUse", 2), Some(2));
    assert_eq!(catalog.get("unknown", 0), None);
    let snapshot = catalog.snapshot();
    catalog.append(snapshot, 3).unwrap();
    assert_eq!(catalog.get("preToolUse", 3), Some(3));
    let mut pipeline = Pipeline::default();
    assert!(!pipeline.observe(false));
    assert!(pipeline.observe(true));
    assert!(!pipeline.observe(true));
}
#[test]
fn hook_decision_plans_preserve_short_circuit_precedence_and_event_skip_policy() {
    let mut plan = Plan::new("preToolUse", Primitive::Object);
    assert_eq!(plan.request(), "reject-string");
    plan.observe(false);
    assert_eq!(plan.request(), "block-true");
    plan.observe(true);
    assert_eq!(plan.request(), "reason-string");
    plan.observe(true);
    assert_eq!(plan.request(), "block");
    let mut plan = Plan::new("preToolUse", Primitive::Object);
    plan.observe(true);
    assert_eq!(plan.request(), "legacy");
    assert_eq!(
        Plan::new("postToolUse", Primitive::Skip).request(),
        "continue"
    );
    assert_eq!(Plan::new("notification", Primitive::Skip).request(), "skip");
    assert_eq!(Plan::new("unknown", Primitive::Abort).request(), "abort");
    let mut input = Plan::new("userPromptSubmit", Primitive::Object);
    assert_eq!(input.request(), "action-transform");
    input.observe(false);
    assert_eq!(input.request(), "action-handled");
    input.observe(true);
    assert_eq!(input.request(), "action-result");
    input.observe(false);
    assert_eq!(input.request(), "handled");
}

#[test]
fn legacy_reject_warnings_are_once_per_owned_registry_event() {
    let mut warnings = poe_agent_rust::hooks::Warnings::default();
    assert!(warnings.mark("preToolUse"));
    assert!(!warnings.mark("preToolUse"));
    assert!(warnings.mark("other"));
    assert!(poe_agent_rust::hooks::Warnings::default().mark("preToolUse"));
}
