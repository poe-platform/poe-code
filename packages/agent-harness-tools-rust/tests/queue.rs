use agent_harness_tools_rust::queue::{Queue, Status};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn messages_follow_plans_and_completed_cursor_rejects_late_insertions() {
    let mut q = Queue::default();
    assert_eq!(
        q.enqueue_plan(u(" one.md "), u("/one.md"), vec![u("review")])
            .unwrap(),
        u("plan-1")
    );
    assert_eq!(
        q.enqueue_plan(u("two.md"), u("/two.md"), vec![]).unwrap(),
        u("plan-3")
    );
    q.begin().unwrap();
    assert_eq!(q.activate().unwrap().id, u("plan-1"));
    q.finish(Status::Completed).unwrap();
    q.advance().unwrap();
    assert_eq!(
        q.enqueue_message(u("follow up"), Some(u("plan-1")))
            .unwrap(),
        u("message-4")
    );
    assert_eq!(q.activate().unwrap().id, u("message-2"));
    q.finish(Status::Completed).unwrap();
    q.advance().unwrap();
    assert_eq!(q.activate().unwrap().id, u("message-4"));
    q.finish(Status::Completed).unwrap();
    q.advance().unwrap();
    assert!(q.enqueue_message(u("late"), Some(u("plan-1"))).is_err());
    assert_eq!(q.activate().unwrap().id, u("plan-3"));
}
#[test]
fn duplicate_and_finished_admission_are_transactional() {
    let mut q = Queue::default();
    q.enqueue_plan(u("one.md"), u("/one.md"), vec![]).unwrap();
    assert!(q.enqueue_plan(u("./one.md"), u("/one.md"), vec![]).is_err());
    assert_eq!(q.items().len(), 1);
    q.begin().unwrap();
    q.stop(Status::Paused);
    assert!(q.enqueue_plan(u("new.md"), u("/new.md"), vec![]).is_err());
    assert!(q.begin().is_err());
}
#[test]
fn exact_utf16_and_default_message_target() {
    let mut q = Queue::default();
    let path = vec![0xd800, 46, 109, 100];
    q.enqueue_plan(path.clone(), path.clone(), vec![]).unwrap();
    q.enqueue_message(u("\\u{feff}hello "), None).unwrap();
    assert_eq!(q.items()[0].text, path);
    q.begin().unwrap();
    q.activate().unwrap();
    q.finish(Status::Failed).unwrap();
    assert_eq!(q.status, Status::Failed);
}
#[test]
fn item_budget_rejects_without_consuming_identifiers() {
    let mut q = Queue::default();
    let messages = vec![u("review"); agent_harness_tools_rust::queue::MAX_ITEMS];
    assert_eq!(
        q.enqueue_plan(u("over.md"), u("/over.md"), messages),
        Err(u("Harness queue item budget exceeded (65536)."))
    );
    assert!(q.items().is_empty());
    assert_eq!(
        q.enqueue_plan(u("one.md"), u("/one.md"), vec![]).unwrap(),
        u("plan-1")
    );
}
