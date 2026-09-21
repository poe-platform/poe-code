//! Persistent live work order; host callbacks and async validation remain outside the core.
use mcp_protocol_rust::strings::trim_ecmascript;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Status {
    #[default]
    Idle,
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Paused,
}
impl Status {
    pub fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Paused => "paused",
        }
    }
    pub fn outcome(s: &str) -> Option<Self> {
        match s {
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "paused" => Some(Self::Paused),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub id: Vec<u16>,
    pub status: Status,
    pub plan: bool,
    pub text: Vec<u16>,
    pub after_plan: Option<Vec<u16>>,
    absolute: Vec<u16>,
}
#[derive(Default)]
pub struct Queue {
    items: Vec<Item>,
    cursor: usize,
    next_id: u64,
    pub status: Status,
    pub active_plan: Option<Vec<u16>>,
    pub active_item: Option<Vec<u16>>,
}
pub const MAX_ITEMS: usize = 65536;
type Result<T> = std::result::Result<T, Vec<u16>>;
impl Queue {
    pub fn items(&self) -> &[Item] {
        &self.items
    }
    pub fn has_work(&self) -> bool {
        self.cursor < self.items.len()
    }
    pub fn assert_accepting(&self) -> Result<()> {
        if matches!(self.status, Status::Idle | Status::Running) {
            Ok(())
        } else {
            Err(u(
                "This run has finished. Start a new run to queue more work.",
            ))
        }
    }
    pub fn enqueue_plan(
        &mut self,
        path: Vec<u16>,
        absolute: Vec<u16>,
        messages: Vec<Vec<u16>>,
    ) -> Result<Vec<u16>> {
        self.assert_accepting()?;
        let path = trim_ecmascript(&path).to_vec();
        if path.is_empty() {
            return Err(u("Queued plan paths cannot be empty."));
        }
        if self
            .items
            .iter()
            .any(|item| item.plan && item.absolute == absolute)
        {
            let mut error = u("Plan is already queued: ");
            error.extend(&path);
            return Err(error);
        }
        let added = messages
            .len()
            .checked_add(1)
            .ok_or_else(|| u("Harness queue item budget exceeded (65536)."))?;
        if self.items.len().saturating_add(added) > MAX_ITEMS {
            return Err(u("Harness queue item budget exceeded (65536)."));
        }
        self.next_id += 1;
        let id = u(&format!("plan-{}", self.next_id));
        self.items.push(Item {
            id: id.clone(),
            status: Status::Pending,
            plan: true,
            text: path,
            after_plan: None,
            absolute,
        });
        for text in messages {
            self.next_id += 1;
            self.items.push(Item {
                id: u(&format!("message-{}", self.next_id)),
                status: Status::Pending,
                plan: false,
                text,
                after_plan: Some(id.clone()),
                absolute: vec![],
            });
        }
        Ok(id)
    }
    pub fn enqueue_message(
        &mut self,
        text: Vec<u16>,
        target: Option<Vec<u16>>,
    ) -> Result<Vec<u16>> {
        self.assert_accepting()?;
        let trimmed = trim_ecmascript(&text);
        if trimmed.is_empty() {
            return Err(u("Queued messages cannot be empty."));
        }
        let target = target.or_else(|| self.active_plan.clone()).or_else(|| {
            self.items
                .iter()
                .find(|item| item.plan)
                .map(|item| item.id.clone())
        });
        let Some(index) = self
            .items
            .iter()
            .position(|item| item.plan && Some(&item.id) == target.as_ref())
        else {
            return Err(u("Choose a queued plan for this message."));
        };
        let mut index = index + 1;
        while self.items.get(index).is_some_and(|item| !item.plan) {
            index += 1;
        }
        if index <= self.cursor {
            return Err(u(
                "That plan has already finished. Choose the current or a later plan.",
            ));
        }
        if self.items.len() >= MAX_ITEMS {
            return Err(u("Harness queue item budget exceeded (65536)."));
        }
        self.next_id += 1;
        let id = u(&format!("message-{}", self.next_id));
        self.items.insert(
            index,
            Item {
                id: id.clone(),
                status: Status::Pending,
                plan: false,
                text: trimmed.to_vec(),
                after_plan: target,
                absolute: vec![],
            },
        );
        Ok(id)
    }
    pub fn begin(&mut self) -> Result<()> {
        if self.status == Status::Running {
            return Err(u("This queue is already running."));
        }
        self.assert_accepting()?;
        self.status = Status::Running;
        Ok(())
    }
    pub fn activate(&mut self) -> Result<Item> {
        let Some(item) = self.items.get_mut(self.cursor) else {
            return Err(u("Harness queue has no active item."));
        };
        item.status = Status::Running;
        self.active_plan = if item.plan {
            Some(item.id.clone())
        } else {
            item.after_plan.clone()
        };
        self.active_item = Some(item.id.clone());
        Ok(item.clone())
    }
    pub fn finish(&mut self, outcome: Status) -> Result<()> {
        let Some(active) = self.active_item.as_ref() else {
            return Err(u("Harness queue has no active item."));
        };
        let Some(item) = self.items.iter_mut().find(|item| item.id == *active) else {
            return Err(u("Harness queue has no active item."));
        };
        item.status = outcome;
        if outcome != Status::Completed {
            self.status = outcome;
        }
        self.active_item = None;
        Ok(())
    }
    pub fn advance(&mut self) -> Result<()> {
        if self.cursor >= self.items.len() || self.items[self.cursor].status != Status::Completed {
            return Err(u("Harness queue item has not completed."));
        }
        self.cursor += 1;
        Ok(())
    }
    pub fn stop(&mut self, outcome: Status) {
        self.status = outcome;
        self.active_item = None;
    }
}
