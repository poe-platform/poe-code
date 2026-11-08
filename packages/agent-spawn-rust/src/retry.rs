#[derive(Debug, PartialEq)]
pub enum Decision {
    Done,
    Check,
    Wait(f64),
}
#[derive(PartialEq)]
enum Phase {
    Ready,
    Running,
    Checking,
    Done,
}
pub struct Retry {
    max: f64,
    base: f64,
    attempt: f64,
    phase: Phase,
}
impl Retry {
    pub fn new(max: f64, base: f64) -> Result<Self, String> {
        if !max.is_finite() || max.fract() != 0.0 || max < 1.0 {
            return Err(
                "spawn.retry maxAttempts must be an integer greater than or equal to 1.".into(),
            );
        }
        if !base.is_finite() || base < 0.0 {
            return Err("spawn.retry backoffMs must be a non-negative finite number.".into());
        }
        Ok(Self {
            max,
            base,
            attempt: 0.0,
            phase: Phase::Ready,
        })
    }
    pub fn begin(&mut self, aborted: bool) -> Result<f64, String> {
        if aborted {
            return Err("Agent spawn retry aborted".into());
        }
        if self.phase != Phase::Ready || self.attempt >= self.max {
            return Err("spawn.retry reached an unreachable retry state.".into());
        }
        self.phase = Phase::Running;
        self.attempt += 1.0;
        Ok(self.attempt)
    }
    pub fn evaluate(&mut self, exit: f64) -> Result<Decision, String> {
        if self.phase != Phase::Running {
            return Err("spawn.retry cannot evaluate outside an active attempt.".into());
        }
        if exit == 0.0 || self.attempt >= self.max {
            self.phase = Phase::Done;
            Ok(Decision::Done)
        } else {
            self.phase = Phase::Checking;
            Ok(Decision::Check)
        }
    }
    pub fn finish_check(&mut self, retry: bool) -> Result<Decision, String> {
        if self.phase != Phase::Checking {
            return Err("spawn.retry has no pending retryability check.".into());
        }
        if retry {
            self.phase = Phase::Ready;
            Ok(Decision::Wait(backoff(self.base, self.attempt)))
        } else {
            self.phase = Phase::Done;
            Ok(Decision::Done)
        }
    }
    pub fn attempt(&self) -> f64 {
        self.attempt
    }
}
pub fn retryable(exit: f64) -> bool {
    [1.0, 124.0, 125.0, 137.0].contains(&exit)
}
pub fn backoff(base: f64, completed: f64) -> f64 {
    let delay = base * 2.0_f64.powf(completed - 1.0);
    if delay.is_nan() {
        delay
    } else {
        delay.min(30000.0)
    }
}
pub fn prefix_field(kind: &str) -> Option<&'static str> {
    match kind {
        "agent_message" | "reasoning" => Some("text"),
        "error" => Some("message"),
        "tool_start" => Some("title"),
        "tool_complete" => Some("path"),
        _ => None,
    }
}
