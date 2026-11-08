pub const TERMINATION_GRACE_MS: u32 = 1000;
pub const GROUP_POLL_MS: u32 = 25;
pub const GROUP_WAIT_MS: u32 = TERMINATION_GRACE_MS + 500;
use crate::{o, s};
use mcp_protocol_rust::json::Value;
#[derive(Clone, Copy, PartialEq)]
pub enum Termination {
    Timeout,
    Abort,
}
pub struct Command {
    group: bool,
    timeout: f64,
    preabort: bool,
    settled: bool,
    termination: Option<Termination>,
    stdout: Vec<u16>,
    stderr: Vec<u16>,
}
impl Command {
    pub fn new(unix: bool, can_abort: bool, timeout: f64, preabort: bool) -> Self {
        Self {
            group: unix && (can_abort || timeout > 0.0),
            timeout,
            preabort,
            settled: false,
            termination: None,
            stdout: vec![],
            stderr: vec![],
        }
    }
    pub fn group(&self) -> bool {
        self.group
    }
    pub fn terminated(&self) -> bool {
        self.termination.is_some()
    }
    pub fn preaborted(&mut self) -> Option<Value> {
        if !self.preabort || self.settled {
            return None;
        }
        self.settled = true;
        Some(o(vec![
            ("stdout", s("")),
            ("stderr", s("Command aborted before start.")),
            ("exitCode", Value::Number(130.0)),
            ("aborted", Value::Bool(true)),
        ]))
    }
    pub fn stdout(&mut self, chunk: &[u16]) {
        if !self.settled {
            self.stdout.extend_from_slice(chunk);
        }
    }
    pub fn stderr(&mut self, chunk: &[u16]) {
        if !self.settled {
            self.stderr.extend_from_slice(chunk);
        }
    }
    pub fn buffered_units(&self) -> usize {
        self.stdout.len() + self.stderr.len()
    }
    pub fn terminate(&mut self, reason: Termination) -> bool {
        if self.settled || self.termination.is_some() {
            return false;
        }
        self.termination = Some(reason);
        true
    }
    fn result(&mut self, code: f64, flags: bool) -> Option<Value> {
        if self.settled {
            return None;
        }
        self.settled = true;
        let mut fields = vec![
            ("stdout", Value::String(std::mem::take(&mut self.stdout))),
            ("stderr", Value::String(std::mem::take(&mut self.stderr))),
            ("exitCode", Value::Number(code)),
        ];
        if flags {
            match self.termination {
                Some(Termination::Timeout) => fields.push(("timedOut", Value::Bool(true))),
                Some(Termination::Abort) => fields.push(("aborted", Value::Bool(true))),
                None => {}
            }
        }
        Some(o(fields))
    }
    pub fn close(&mut self, code: Option<f64>, signal: Option<f64>) -> Option<Value> {
        if self.settled {
            return None;
        }
        let exit = match self.termination {
            Some(Termination::Timeout) => {
                self.stderr.extend(
                    format!(
                        "Command timed out after {} ms.",
                        mcp_protocol_rust::numbers::format(self.timeout)
                    )
                    .encode_utf16(),
                );
                124.0
            }
            Some(Termination::Abort) => {
                self.stderr.extend("Command aborted.".encode_utf16());
                130.0
            }
            None => code.unwrap_or_else(|| signal.map_or(1.0, |value| 128.0 + value)),
        };
        self.result(exit, true)
    }
    pub fn error(
        &mut self,
        message: &[u16],
        code: Option<f64>,
        errno: Option<f64>,
    ) -> Option<Value> {
        if self.settled {
            return None;
        }
        self.stderr.extend_from_slice(message);
        self.result(code.or(errno).unwrap_or(127.0), false)
    }
}
