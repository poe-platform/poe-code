use toolcraft_rust::safe_bash::OutputBudget;

#[test]
fn output_budget_keeps_pending_bytes_until_the_sink_finishes() {
    let mut budget = OutputBudget::default();
    assert!(budget.enqueue(1_048_576.0));
    assert!(!budget.enqueue(1.0));
    budget.complete(1_048_576.0);
    assert!(budget.enqueue(1_048_575.0));
    assert!(!budget.enqueue(1.0));
}

#[test]
fn independent_output_budgets_do_not_share_pending_writes() {
    let mut first = OutputBudget::default();
    let mut second = OutputBudget::default();
    assert!(first.enqueue(1_048_576.0));
    assert!(second.enqueue(5.0));
    second.complete(5.0);
    assert!(second.enqueue(1_048_576.0));
    assert!(!first.enqueue(1.0));
}
