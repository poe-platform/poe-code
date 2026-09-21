#[derive(Clone, Copy, PartialEq)]
enum Status {
    Pending,
    Active,
    Passed,
    Failed,
    Rejected,
}
#[derive(Debug, PartialEq)]
pub enum Rejection {
    Primary,
    Collect,
    Ignore,
}
pub struct Scheduler {
    status: Vec<Status>,
    next: usize,
    active: usize,
    limit: usize,
    check: bool,
    fail_fast: bool,
    stopped: bool,
}
impl Scheduler {
    pub fn new(count: usize, max: f64, check: bool, fail_fast: bool) -> Result<Self, String> {
        if !max.is_finite() || max.fract() != 0.0 || max < 1.0 {
            return Err(
                "spawn.parallel maxConcurrent must be an integer greater than or equal to 1."
                    .into(),
            );
        }
        Ok(Self {
            status: vec![Status::Pending; count],
            next: 0,
            active: 0,
            limit: (max.min(count as f64)) as usize,
            check,
            fail_fast,
            stopped: false,
        })
    }
    pub fn workers(&self) -> usize {
        self.limit
    }
    pub fn take(&mut self) -> Option<usize> {
        if self.stopped || self.active >= self.limit || self.next >= self.status.len() {
            return None;
        }
        let index = self.next;
        self.next += 1;
        self.active += 1;
        self.status[index] = Status::Active;
        Some(index)
    }
    fn record(&mut self, index: usize, status: Status) -> Result<(), String> {
        if self.status.get(index) != Some(&Status::Active) {
            return Err("spawn.parallel call is not active.".into());
        }
        self.status[index] = status;
        self.active -= 1;
        Ok(())
    }
    pub fn complete(&mut self, index: usize, success: bool) -> Result<bool, String> {
        self.record(
            index,
            if success {
                Status::Passed
            } else {
                Status::Failed
            },
        )?;
        Ok(!success && self.check && self.fail_fast && self.stop())
    }
    pub fn reject(&mut self, index: usize, aborted: bool) -> Result<Rejection, String> {
        self.record(index, Status::Rejected)?;
        Ok(if self.stopped {
            Rejection::Ignore
        } else if self.fail_fast || aborted {
            self.stop();
            Rejection::Primary
        } else {
            Rejection::Collect
        })
    }
    pub fn stop(&mut self) -> bool {
        let first = !self.stopped;
        self.stopped = true;
        first
    }
    pub fn first_failed(&self) -> Option<usize> {
        if !self.check {
            return None;
        }
        self.status
            .iter()
            .position(|status| *status == Status::Failed)
    }
}
