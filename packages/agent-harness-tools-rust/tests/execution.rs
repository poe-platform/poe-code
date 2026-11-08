use agent_harness_tools_rust::execution::{CapabilityError, Fact, admit};
#[test]
fn runtime_capabilities_are_read_lazily_in_original_priority() {
    let mut seen = vec![];
    let result = admit(|fact| {
        seen.push(fact);
        Ok::<_, ()>(match fact {
            Fact::Detach => true,
            Fact::SupportsDetach => false,
            _ => panic!("must not read later facts"),
        })
    });
    assert_eq!(result, Ok(Some(CapabilityError::Detach)));
    assert_eq!(seen, vec![Fact::Detach, Fact::SupportsDetach]);
    seen.clear();
    let result = admit(|fact| {
        seen.push(fact);
        Ok::<_, ()>(match fact {
            Fact::Detach => false,
            Fact::WantsTransfer => true,
            Fact::SupportsTransfer => false,
            _ => panic!("detach support must not be read"),
        })
    });
    assert_eq!(result, Ok(Some(CapabilityError::Transfer)));
    assert_eq!(
        seen,
        vec![Fact::Detach, Fact::WantsTransfer, Fact::SupportsTransfer]
    );
}
#[test]
fn capability_getter_failures_retain_their_host_tokens() {
    assert_eq!(
        admit(|fact| if fact == Fact::Detach {
            Ok(false)
        } else {
            Err(42usize)
        }),
        Err(42)
    );
    assert_eq!(admit(|_| Ok::<_, ()>(true)), Ok(None));
}
