//! Command lifecycle policy and deterministic IDs independent of host IO.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Phase {
    #[default]
    Pending,
    Running,
    Terminal,
}
#[derive(Default)]
pub struct Lifecycle {
    phase: Phase,
}
impl Lifecycle {
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn running(&mut self) -> Result<(), &'static str> {
        if self.phase != Phase::Pending {
            return Err("Command must be pending before running.");
        }
        self.phase = Phase::Running;
        Ok(())
    }
    pub fn terminal(&mut self) -> Result<(), &'static str> {
        if self.phase != Phase::Running {
            return Err("Command must be running before terminal commit.");
        }
        self.phase = Phase::Terminal;
        Ok(())
    }
    pub fn failure_action(&self) -> &'static str {
        match self.phase {
            Phase::Pending => "remove",
            Phase::Running => "lost",
            Phase::Terminal => "none",
        }
    }
}
pub fn activity_timeout_valid(value: Option<f64>) -> bool {
    value.is_none_or(|value| value.is_finite() && value > 0.0)
}
pub fn ulid(mut time: u64, random: &[u8; 10]) -> String {
    const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut out = [b'0'; 26];
    for index in (0..10).rev() {
        out[index] = ALPHABET[(time & 31) as usize];
        time >>= 5;
    }
    let mut entropy = 0u128;
    for byte in random {
        entropy = (entropy << 8) | u128::from(*byte);
    }
    for index in (10..26).rev() {
        out[index] = ALPHABET[(entropy & 31) as usize];
        entropy >>= 5;
    }
    String::from_utf8(out.to_vec()).expect("ULID alphabet is ASCII")
}
