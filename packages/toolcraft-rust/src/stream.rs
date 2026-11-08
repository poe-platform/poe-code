//! Managed stream lifecycle. Host promises and iterator handles only cross a
//! synchronous step; Rust selects continuation and exception ownership.
use std::cell::Cell;

pub trait Host {
    type Value: Copy;
    type Error;
    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value, Self::Error>;
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value, Self::Error>;
    fn is_undefined(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_true(&self, value: Self::Value) -> Result<bool, Self::Error>;
}

#[derive(Clone, Copy)]
#[repr(u32)]
pub enum Phase {
    Start,
    Acquire,
    Acquired,
    Pulled,
    Failure,
    Complete,
    ThrowInput,
    ThrowSaved,
    InvalidEvent,
}

impl Phase {
    pub fn from_index(index: u32) -> Option<Self> {
        Some(match index {
            0 => Self::Start,
            1 => Self::Acquire,
            2 => Self::Acquired,
            3 => Self::Pulled,
            4 => Self::Failure,
            5 => Self::Complete,
            6 => Self::ThrowInput,
            7 => Self::ThrowSaved,
            8 => Self::InvalidEvent,
            _ => return None,
        })
    }
    pub fn catch(self) -> Self {
        match self {
            Self::Acquire | Self::Acquired => Self::Failure,
            _ => Self::ThrowInput,
        }
    }
}

pub struct Action<V> {
    pub kind: &'static str,
    pub value: V,
    pub saved: V,
    pub next: Phase,
    pub failure: Phase,
}

#[derive(Default)]
pub struct ManagedStream {
    done: Cell<bool>,
}

impl ManagedStream {
    pub fn initialize<H: Host>(&self, host: &mut H) -> Result<(), H::Error> {
        let aborted = host.call("consumerAborted", vec![])?;
        host.call(
            if host.is_true(aborted)? {
                "abortFromConsumer"
            } else {
                "listen"
            },
            vec![],
        )?;
        Ok(())
    }

    pub fn close<H: Host>(&self, host: &mut H, reason: H::Value) -> Result<H::Value, H::Error> {
        let promise = host.call("closePromise", vec![])?;
        if !host.is_undefined(promise)? {
            return Ok(promise);
        }
        let closing = host.call(
            if self.done.get() {
                "undefined"
            } else {
                "iteratorPromise"
            },
            vec![],
        )?;
        self.done.set(true);
        host.call("detach", vec![])?;
        let promise = if host.is_undefined(closing)? {
            host.call("resolvedPromise", vec![])?
        } else {
            host.call("closeIterator", vec![closing])?
        };
        host.call("setClosePromise", vec![promise])?;
        host.call("abort", vec![reason])?;
        host.call("closePromise", vec![])
    }

    fn stopped<H: Host>(&self, host: &mut H) -> Result<bool, H::Error> {
        if self.done.get() {
            return Ok(true);
        }
        let aborted = host.call("aborted", vec![])?;
        host.is_true(aborted)
    }

    pub fn advance<H: Host>(
        &self,
        host: &mut H,
        phase: Phase,
        input: H::Value,
        saved: H::Value,
    ) -> Result<Action<H::Value>, H::Error> {
        let empty = host.call("undefined", vec![])?;
        let mut action = Action {
            kind: "await",
            value: empty,
            saved,
            next: Phase::Complete,
            failure: Phase::ThrowInput,
        };
        match phase {
            Phase::Start => {
                if self.stopped(host)? {
                    let reason = host.call("reason", vec![])?;
                    action.value = self.close(host, reason)?;
                } else {
                    action.kind = "continue";
                    action.next = Phase::Acquire;
                }
            }
            Phase::Acquire => {
                let mut promise = host.call("iteratorPromise", vec![])?;
                if host.is_undefined(promise)? {
                    promise = host.call("startIterator", vec![])?;
                    host.call("setIteratorPromise", vec![promise])?;
                }
                action.value = promise;
                action.next = Phase::Acquired;
                action.failure = Phase::Failure;
            }
            Phase::Acquired => {
                if self.stopped(host)? {
                    let reason = host.call("reason", vec![])?;
                    action.value = self.close(host, reason)?;
                } else {
                    action.value = host.call("next", vec![input])?;
                    action.next = Phase::Pulled;
                }
                action.failure = Phase::Failure;
            }
            Phase::Failure => {
                action.value = self.close(host, input)?;
                action.saved = input;
                action.next = Phase::ThrowSaved;
            }
            Phase::Pulled => {
                let aborted = host.call("aborted", vec![])?;
                if host.is_true(aborted)? {
                    let reason = host.call("reason", vec![])?;
                    action.value = self.close(host, reason)?;
                } else {
                    let done = host.get(input, "done")?;
                    if host.is_true(done)? {
                        self.done.set(true);
                        host.call("detach", vec![])?;
                        action.kind = "return";
                        action.value = host.call("complete", vec![])?;
                    } else {
                        // Keep the caller's value; validation may clone defaults but
                        // streams expose the untransformed iterator result.
                        let schema = host.call("schema", vec![])?;
                        let value = host.get(input, "value")?;
                        let result = host.call("validate", vec![schema, value])?;
                        let ok = host.get(result, "ok")?;
                        let message = if host.is_true(ok)? {
                            empty
                        } else {
                            let issues = host.get(result, "issues")?;
                            host.call("messages", vec![issues])?
                        };
                        if host.is_undefined(message)? {
                            let value = host.get(input, "value")?;
                            action.kind = "return";
                            action.value = host.call("event", vec![value])?;
                        } else {
                            let error = host.call("userError", vec![message])?;
                            action.value = self.close(host, error)?;
                            action.saved = message;
                            action.next = Phase::InvalidEvent;
                        }
                    }
                }
            }
            Phase::Complete => {
                action.kind = "return";
                action.value = host.call("complete", vec![])?;
            }
            Phase::ThrowInput => {
                action.kind = "throw";
                action.value = input;
            }
            Phase::ThrowSaved => {
                action.kind = "throw";
                action.value = saved;
            }
            Phase::InvalidEvent => {
                action.kind = "throw";
                action.value = host.call("userError", vec![saved])?;
            }
        }
        Ok(action)
    }
}
