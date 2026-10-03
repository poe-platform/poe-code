use super::*;
use agent_skill_config_rust::bridge_async::{Bridge, Fault, Machine, Reply, Step};

fn step(value: Step) -> NativeJson {
    NativeJson(match value {
        Step::Request(request) => object(vec![
            ("kind", text("request")),
            ("operation", text(request.operation)),
            ("args", J::Array(request.args)),
            ("io", J::Number(request.io as f64)),
        ]),
        Step::Done(Ok(())) => object(vec![("kind", text("done"))]),
        Step::Done(Err(Fault::Foreign(id))) => {
            object(vec![("foreignError", J::Number(f64::from(id)))])
        }
        Step::Done(Err(Fault::Policy(message))) => object(vec![("error", J::String(message))]),
    })
}
#[napi]
#[derive(Default)]
pub struct SkillAsyncBridge {
    state: Bridge,
}
#[napi]
impl SkillAsyncBridge {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn begin(&self, spawn: Utf16String, run: Utf16String) -> SkillAsyncBridgeRun {
        SkillAsyncBridgeRun {
            machine: self.state.begin(spawn.to_vec(), run.to_vec()),
        }
    }
    #[napi]
    pub fn cleanup(&self) -> SkillAsyncBridgeRun {
        SkillAsyncBridgeRun {
            machine: self.state.cleanup(),
        }
    }
}
#[napi]
pub struct SkillAsyncBridgeRun {
    machine: Machine,
}
#[napi]
impl SkillAsyncBridgeRun {
    #[napi]
    pub fn start(&mut self) -> NativeJson {
        step(self.machine.step(None))
    }
    #[napi]
    pub fn value(&mut self, value: Utf16String) -> Result<NativeJson> {
        let value = json::parse_utf16(&value, Limits::default())
            .map_err(|error| Error::from_reason(error.to_string()))?;
        Ok(step(self.machine.step(Some(Reply::Value(value)))))
    }
    #[napi]
    pub fn bytes(&mut self, bytes: Buffer) -> NativeJson {
        step(self.machine.step(Some(Reply::Bytes(bytes.to_vec()))))
    }
    #[napi]
    pub fn failure(&mut self, id: u32) -> NativeJson {
        step(self.machine.step(Some(Reply::Error(id))))
    }
}
