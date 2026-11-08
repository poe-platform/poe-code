use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
use tiny_stdio_mcp_server_rust::output::{LineOutput, OutputAction};
use tiny_stdio_mcp_server_rust::stdio::LineInput;

#[napi(object)]
pub struct FrameBatch {
    pub lines: Vec<Utf16String>,
    pub error: Option<String>,
}

#[napi]
pub struct NativeStdioInput {
    input: LineInput,
    max_lines: usize,
    failed: bool,
}

#[napi]
impl NativeStdioInput {
    #[napi(constructor)]
    pub fn new(max_line_bytes: f64, max_lines: f64) -> Result<Self> {
        for (name, value) in [
            ("maxStdioLineBytes", max_line_bytes),
            ("maxPendingStdioMessages", max_lines),
        ] {
            if !value.is_finite()
                || value.fract() != 0.0
                || !(1.0..=9_007_199_254_740_991.0).contains(&value)
            {
                return Err(Error::from_reason(format!(
                    "{name} must be a safe integer greater than or equal to 1."
                )));
            }
        }
        Ok(Self {
            input: LineInput::new(max_line_bytes as usize)
                .map_err(|error| Error::from_reason(error.to_string()))?,
            max_lines: max_lines as usize,
            failed: false,
        })
    }

    #[napi]
    pub fn push(&mut self, chunk: Either<Buffer, Utf16String>) -> FrameBatch {
        if self.failed {
            return FrameBatch {
                lines: Vec::new(),
                error: Some("Stdio input is closed".into()),
            };
        }
        let mut lines = Vec::new();
        let mut full = false;
        let mut emit = |line: Vec<u16>| {
            if lines.len() == self.max_lines {
                full = true;
            } else {
                lines.push(line.into());
            }
        };
        let result = match chunk {
            Either::A(bytes) => self.input.push_bytes(&bytes, &mut emit),
            Either::B(units) => self.input.push_utf16(&units, &mut emit),
        };
        let error = if full {
            Some("Stdio pending message limit exceeded".into())
        } else {
            result.err().map(|error| error.to_string())
        };
        self.failed = error.is_some();
        if self.failed {
            self.input.abort();
        }
        FrameBatch { lines, error }
    }

    #[napi]
    pub fn finish(&mut self) -> FrameBatch {
        if self.failed {
            return FrameBatch {
                lines: Vec::new(),
                error: Some("Stdio input is closed".into()),
            };
        }
        let mut lines = Vec::new();
        let error = self
            .input
            .finish(|line| lines.push(line.into()))
            .err()
            .map(|error| error.to_string());
        FrameBatch { lines, error }
    }

    #[napi]
    pub fn abort(&mut self) {
        self.failed = true;
        self.input.abort();
    }
}

#[napi(object)]
pub struct WriteAction {
    pub kind: String,
    pub token: f64,
    pub data: Option<String>,
}

#[napi(object)]
pub struct SubmittedWrite {
    pub token: f64,
    pub actions: Vec<WriteAction>,
}

#[napi]
pub struct NativeStdioOutput {
    output: LineOutput,
}

#[napi]
impl NativeStdioOutput {
    #[napi(constructor)]
    pub fn new(max_bytes: f64) -> Result<Self> {
        let limit = super::capacity(Some(max_bytes), "maxStdioOutputBytes", 1024.0 * 1024.0)?;
        Ok(Self {
            output: LineOutput::new(limit as usize)
                .map_err(|error| Error::from_reason(error.to_string()))?,
        })
    }

    #[napi(getter)]
    pub fn pending(&self) -> f64 {
        self.output.pending() as f64
    }

    #[napi]
    pub fn enqueue(&mut self, data: Utf16String) -> Result<SubmittedWrite> {
        let (token, actions) = self
            .output
            .enqueue(String::from_utf16_lossy(&data))
            .map_err(|error| Error::from_reason(error.to_string()))?;
        Ok(SubmittedWrite {
            token: token as f64,
            actions: write_actions(actions),
        })
    }

    #[napi]
    pub fn returned(&mut self, token: f64, accepted: bool) -> Vec<WriteAction> {
        let Some(token) = native_token(token) else {
            return Vec::new();
        };
        write_actions(self.output.returned(token, accepted))
    }

    #[napi]
    pub fn completed(&mut self, token: f64) -> Vec<WriteAction> {
        let Some(token) = native_token(token) else {
            return Vec::new();
        };
        write_actions(self.output.completed(token))
    }

    #[napi]
    pub fn drain(&mut self) -> Vec<WriteAction> {
        write_actions(self.output.drain())
    }

    #[napi]
    pub fn abort(&mut self) -> Vec<f64> {
        self.output
            .abort()
            .into_iter()
            .map(|token| token as f64)
            .collect()
    }
}

fn write_actions(actions: Vec<OutputAction>) -> Vec<WriteAction> {
    actions
        .into_iter()
        .map(|action| match action {
            OutputAction::Write { token, data } => WriteAction {
                kind: "write".into(),
                token: token as f64,
                data: Some(data),
            },
            OutputAction::Complete { token } => WriteAction {
                kind: "complete".into(),
                token: token as f64,
                data: None,
            },
        })
        .collect()
}

fn native_token(token: f64) -> Option<u64> {
    (token.is_finite() && token.fract() == 0.0 && (1.0..=9_007_199_254_740_991.0).contains(&token))
        .then_some(token as u64)
}
