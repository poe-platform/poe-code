use std::{
    error::Error,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use user_error_rust::{USER_ERROR_NAME, UserError};

#[test]
fn message_hint_and_typed_recognition_preserve_recoverable_error_semantics() {
    let error = UserError::new("No API key found.").with_hint("Create a key");
    assert_eq!(USER_ERROR_NAME, "UserError");
    assert_eq!(error.message, "No API key found.");
    assert_eq!(error.hint.as_deref(), Some("Create a key"));
    assert_eq!(error.to_string(), "No API key found.");
    let dynamic: &(dyn Error + 'static) = &error;
    assert!(dynamic.is::<UserError>());
    assert!(dynamic.source().is_none());
    assert!(
        UserError::new("empty hint is valid")
            .with_hint("")
            .hint
            .is_some()
    );
    assert!(UserError::new("no hint").hint.is_none());
}

#[derive(Debug)]
struct Cause(Arc<AtomicUsize>);
impl std::fmt::Display for Cause {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("underlying failure")
    }
}
impl Error for Cause {}
impl Drop for Cause {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
#[test]
fn cause_chains_preserve_concrete_types_and_release_with_the_owner() {
    let drops = Arc::new(AtomicUsize::new(0));
    let error = UserError::new("Config not found.").with_cause(Cause(drops.clone()));
    assert_eq!(error.source().unwrap().to_string(), "underlying failure");
    assert!(error.source().unwrap().is::<Cause>());
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    let wrapped = UserError::new("Cannot start").with_cause(error);
    assert!(wrapped.source().unwrap().is::<UserError>());
    drop(wrapped);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
}

#[test]
fn error_can_cross_worker_boundaries_without_global_retention() {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<UserError>();
    let drops = Arc::new(AtomicUsize::new(0));
    for _ in 0..4096 {
        drop(UserError::new("Unicode 🦀\0").with_cause(Cause(drops.clone())));
    }
    assert_eq!(drops.load(Ordering::SeqCst), 4096);
}
