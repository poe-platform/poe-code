use poe_agent_rust::agent_host::{HostState, InvocationState, SpawnOutput};
#[test]
fn invocation_close_admits_one_attempt_even_when_the_host_return_fails() {
    let mut state = InvocationState::default();
    assert!(state.begin_close());
    assert!(!state.begin_close());
}
#[test]
fn host_fork_sequence_and_spawn_output_are_owned_and_preserve_utf16() {
    let mut host = HostState::default();
    assert_eq!(host.next_fork(), 1.0);
    assert_eq!(host.next_fork(), 2.0);
    let mut output = SpawnOutput::default();
    output.append(&[0xD800]);
    output.append(&[0xD83C, 0xDF0D]);
    assert_eq!(output.finish(), [0xD800, 0xD83C, 0xDF0D]);
}
