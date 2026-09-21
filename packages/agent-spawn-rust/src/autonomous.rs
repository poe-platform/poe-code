//! Host-independent attempt admission for autonomous streaming runs.
//!
//! The host observes result and consumer failures concurrently and classifies
//! activity timeouts. This state owns the retry budget, not either host task.
#[derive(PartialEq)]
enum Phase {
    Ready,
    Running,
    Done,
}

pub struct Autonomous {
    max: f64,
    attempt: f64,
    phase: Phase,
}

impl Autonomous {
    pub fn new(max: f64) -> Result<Self, String> {
        if !max.is_finite() || max.fract() != 0.0 || max < 1.0 {
            return Err(
                "spawnAutonomous maxTimeoutRetries must be an integer greater than or equal to 1."
                    .into(),
            );
        }
        Ok(Self {
            max,
            attempt: 0.0,
            phase: Phase::Ready,
        })
    }

    pub fn begin(&mut self) -> Result<f64, String> {
        if self.phase != Phase::Ready {
            return Err("Autonomous spawn has no pending attempt.".into());
        }
        self.attempt += 1.0;
        self.phase = Phase::Running;
        Ok(self.attempt)
    }

    pub fn succeed(&mut self) -> Result<(), String> {
        if self.phase != Phase::Running {
            return Err("Autonomous spawn has no active attempt.".into());
        }
        self.phase = Phase::Done;
        Ok(())
    }

    pub fn fail(&mut self, activity_timeout: bool) -> Result<bool, String> {
        if self.phase != Phase::Running {
            return Err("Autonomous spawn has no active attempt.".into());
        }
        let retry = activity_timeout && self.attempt < self.max;
        self.phase = if retry { Phase::Ready } else { Phase::Done };
        Ok(retry)
    }
}
