use poe_agent_rust::prompts::Order;
#[test]
fn prompt_order_remains_live_and_copy_appends_opaque_handles() {
    let mut order = Order::default();
    order.add(0);
    assert_eq!(order.get(0), Some(0));
    assert_eq!(order.get(1), None);
    order.add(1);
    assert_eq!(order.get(1), Some(1));
    let copy = order.snapshot();
    order.append(copy, 2).unwrap();
    assert_eq!(order.snapshot(), vec![0, 1, 2, 3]);
    assert_eq!(order.get(4), None);
    assert!(order.append(vec![u32::MAX], 1).is_err());
    assert_eq!(order.snapshot(), vec![0, 1, 2, 3]);
}
