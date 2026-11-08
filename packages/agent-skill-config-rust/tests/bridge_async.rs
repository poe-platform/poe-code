use agent_skill_config_rust::bridge_async::{Bridge, Fault, Reply, Step};
use mcp_protocol_rust::json::Value;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn unsupported_async_spawn_fails_before_host_io() {
    let mut machine = Bridge::default().begin(u("unknown"), u("run"));
    assert!(
        matches!(machine.step(None), Step::Done(Err(Fault::Policy(message))) if message == u("Unsupported spawn agent: unknown"))
    );
}
#[test]
fn async_bridge_yields_capability_acquisition_before_reference_resolution() {
    let mut machine = Bridge::default().begin(u("claude"), u("run"));
    assert!(matches!(machine.step(None), Step::Request(request) if request.operation == "acquire"));
    assert!(
        matches!(machine.step(Some(Reply::Value(Value::Number(0.0)))), Step::Request(request) if request.operation == "resolveRefs")
    );
    assert!(matches!(
        machine.step(Some(Reply::Error(7))),
        Step::Done(Err(Fault::Foreign(7)))
    ));
}
