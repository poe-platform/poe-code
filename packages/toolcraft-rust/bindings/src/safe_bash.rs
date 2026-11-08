use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn safe_bash_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::safe_bash::run(&mut NodeHost { env, object: host }, &operation, &args)
}

#[napi]
#[derive(Default)]
pub struct SafeBashOutputBudget(toolcraft_rust::safe_bash::OutputBudget);

#[napi]
impl SafeBashOutputBudget {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    #[napi]
    pub fn enqueue(&mut self, amount: f64) -> bool {
        self.0.enqueue(amount)
    }

    #[napi]
    pub fn complete(&mut self, amount: f64) {
        self.0.complete(amount);
    }
}
