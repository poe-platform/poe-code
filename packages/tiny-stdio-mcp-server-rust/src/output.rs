#[derive(Debug, PartialEq, Eq)]
pub enum OutputError {
    ByteLimit,
    Closed,
    InvalidLimit,
    IdentifierExhausted,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OutputAction {
    Write { token: u64, data: String },
    Complete { token: u64 },
}

use std::collections::VecDeque;

pub struct LineOutput {
    limit: usize,
    bytes: usize,
    next_token: u64,
    queue: VecDeque<Frame>,
    active: Option<Active>,
    stopped: bool,
}

struct Frame {
    token: u64,
    data: String,
}
struct Active {
    token: u64,
    bytes: usize,
    returned: bool,
    completed: bool,
    drained: bool,
    needs_drain: bool,
}

impl LineOutput {
    pub fn new(limit: usize) -> Result<Self, OutputError> {
        if limit == 0 {
            return Err(OutputError::InvalidLimit);
        }
        Ok(Self {
            limit,
            bytes: 0,
            next_token: 0,
            queue: VecDeque::new(),
            active: None,
            stopped: false,
        })
    }

    pub fn enqueue(&mut self, data: String) -> Result<(u64, Vec<OutputAction>), OutputError> {
        if self.stopped {
            return Err(OutputError::Closed);
        }
        if data.len() > self.limit - self.bytes {
            return Err(OutputError::ByteLimit);
        }
        let token = self
            .next_token
            .checked_add(1)
            .ok_or(OutputError::IdentifierExhausted)?;
        // Tokens cross the host boundary as exact JS numbers.
        if token > 9_007_199_254_740_991 {
            return Err(OutputError::IdentifierExhausted);
        }
        self.next_token = token;
        self.bytes += data.len();
        self.queue.push_back(Frame { token, data });
        Ok((token, self.pump().into_iter().collect()))
    }

    pub fn returned(&mut self, token: u64, accepted: bool) -> Vec<OutputAction> {
        if let Some(active) = &mut self.active
            && active.token == token
        {
            active.returned = true;
            active.needs_drain = !accepted;
        }
        self.advance()
    }

    pub fn completed(&mut self, token: u64) -> Vec<OutputAction> {
        if let Some(active) = &mut self.active
            && active.token == token
        {
            active.completed = true;
        }
        self.advance()
    }

    pub fn drain(&mut self) -> Vec<OutputAction> {
        if let Some(active) = &mut self.active {
            active.drained = true;
        }
        self.advance()
    }

    pub fn abort(&mut self) -> Vec<u64> {
        self.stopped = true;
        self.bytes = 0;
        self.active
            .take()
            .map(|active| active.token)
            .into_iter()
            .chain(self.queue.drain(..).map(|frame| frame.token))
            .collect()
    }

    pub fn pending_bytes(&self) -> usize {
        self.bytes
    }
    pub fn pending(&self) -> usize {
        self.queue.len() + usize::from(self.active.is_some())
    }

    fn pump(&mut self) -> Option<OutputAction> {
        if self.stopped || self.active.is_some() {
            return None;
        }
        let frame = self.queue.pop_front()?;
        self.active = Some(Active {
            token: frame.token,
            bytes: frame.data.len(),
            returned: false,
            completed: false,
            drained: false,
            needs_drain: false,
        });
        Some(OutputAction::Write {
            token: frame.token,
            data: frame.data,
        })
    }

    fn advance(&mut self) -> Vec<OutputAction> {
        if !self.active.as_ref().is_some_and(|active| {
            active.returned && active.completed && (!active.needs_drain || active.drained)
        }) {
            return Vec::new();
        }
        let active = self.active.take().expect("completed active frame");
        self.bytes -= active.bytes;
        let mut actions = vec![OutputAction::Complete {
            token: active.token,
        }];
        actions.extend(self.pump());
        actions
    }
}

impl std::fmt::Display for OutputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::ByteLimit => "Stdio output byte limit exceeded",
            Self::Closed => "Stdio output is closed",
            Self::InvalidLimit => "Stdio output capacity must be positive",
            Self::IdentifierExhausted => "Stdio output identifier exhausted",
        })
    }
}
impl std::error::Error for OutputError {}
