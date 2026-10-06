pub mod alloc;

pub use alloc::AllocationGuard;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
#[cfg(not(target_arch = "wasm32"))]
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellLimits {
    pub max_loop_iterations: usize,
    pub max_commands: usize,
    pub max_output_bytes: usize,
    pub max_filesystem_operations: usize,
    pub max_pipeline_stages: usize,
    pub max_substitution_depth: usize,
    pub max_function_depth: usize,
    pub max_expansion_fields: usize,
    pub max_expansion_bytes: usize,
    pub max_memory_bytes: usize,
    pub max_redirects: usize,
    pub max_pathname_components: usize,
    pub max_input_bytes: usize,
    pub max_parse_units: usize,
    pub max_source_bytes: usize,
}

impl Default for ShellLimits {
    fn default() -> Self {
        Self {
            max_loop_iterations: 100_000,
            max_commands: 25_000,
            max_output_bytes: 16 * 1024 * 1024,
            max_filesystem_operations: 100_000,
            max_pipeline_stages: 64,
            max_substitution_depth: 32,
            max_function_depth: 64,
            max_expansion_fields: 50_000,
            max_expansion_bytes: 8 * 1024 * 1024,
            max_memory_bytes: 64 * 1024 * 1024,
            max_redirects: 64,
            max_pathname_components: 256,
            max_input_bytes: 16 * 1024 * 1024,
            max_parse_units: 100_000,
            max_source_bytes: 16 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

pub struct ExecutionBudget {
    pub limits: ShellLimits,
    pub cancel_token: CancellationToken,
    pub alloc_guard: AllocationGuard,
    loop_iterations: AtomicUsize,
    commands: AtomicUsize,
    output_bytes: AtomicUsize,
    fs_ops: AtomicUsize,
    recursion_depth: AtomicUsize,
    substitution_depth: AtomicUsize,
    exceeded_error: Mutex<Option<String>>,
    #[cfg(not(target_arch = "wasm32"))]
    deadline: Option<Instant>,
}

impl Default for ExecutionBudget {
    fn default() -> Self {
        Self::new(ShellLimits::default(), None)
    }
}

impl ExecutionBudget {
    pub fn new(limits: ShellLimits, timeout_ms: Option<u64>) -> Self {
        let max_mem = limits.max_memory_bytes;
        #[cfg(not(target_arch = "wasm32"))]
        let deadline = timeout_ms.map(|ms| Instant::now() + Duration::from_millis(ms));
        #[cfg(target_arch = "wasm32")]
        let _ = timeout_ms;
        Self {
            limits,
            cancel_token: CancellationToken::new(),
            alloc_guard: AllocationGuard::new(max_mem),
            loop_iterations: AtomicUsize::new(0),
            commands: AtomicUsize::new(0),
            output_bytes: AtomicUsize::new(0),
            fs_ops: AtomicUsize::new(0),
            recursion_depth: AtomicUsize::new(0),
            substitution_depth: AtomicUsize::new(0),
            exceeded_error: Mutex::new(None),
            #[cfg(not(target_arch = "wasm32"))]
            deadline,
        }
    }

    pub fn record_exceeded(&self, msg: String) -> String {
        if let Ok(mut guard) = self.exceeded_error.lock()
            && guard.is_none()
        {
            *guard = Some(msg.clone());
        }
        msg
    }

    pub fn check_exceeded(&self) -> Result<(), String> {
        if let Ok(guard) = self.exceeded_error.lock()
            && let Some(msg) = guard.as_ref()
        {
            return Err(msg.clone());
        }
        Ok(())
    }

    pub fn check_cancelled(&self) -> Result<(), String> {
        self.check_exceeded()?;
        if self.cancel_token.is_cancelled() {
            return Err("Execution aborted: cancelled".to_string());
        }
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(deadline) = self.deadline
            && Instant::now() >= deadline
        {
            return Err("Command timed out".to_string());
        }
        Ok(())
    }

    pub fn tick_loop(&self) -> Result<(), String> {
        self.check_cancelled()?;
        let prev = self.loop_iterations.fetch_add(1, Ordering::Relaxed);
        if prev + 1 > self.limits.max_loop_iterations {
            return Err(self.record_exceeded(format!(
                "Execution aborted: Shell limit exceeded: maxLoopIterations ({})",
                self.limits.max_loop_iterations
            )));
        }
        Ok(())
    }

    pub fn tick_iteration(&self) -> Result<(), String> {
        self.tick_loop()
    }

    pub fn enter_recursion(&self) -> Result<(), String> {
        self.check_cancelled()?;
        let prev = self.recursion_depth.fetch_add(1, Ordering::Relaxed);
        if prev + 1 > self.limits.max_function_depth {
            self.recursion_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(self.record_exceeded(format!(
                "Execution aborted: Shell limit exceeded: maxFunctionDepth ({})",
                self.limits.max_function_depth
            )));
        }
        Ok(())
    }

    pub fn leave_recursion(&self) {
        let _ = self.recursion_depth.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn enter_substitution(&self) -> Result<(), String> {
        self.check_cancelled()?;
        let prev = self.substitution_depth.fetch_add(1, Ordering::Relaxed);
        if prev + 1 > self.limits.max_substitution_depth {
            self.substitution_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(self.record_exceeded(format!(
                "Execution aborted: Shell limit exceeded: maxSubstitutionDepth ({})",
                self.limits.max_substitution_depth
            )));
        }
        Ok(())
    }

    pub fn leave_substitution(&self) {
        let _ = self.substitution_depth.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn record_stdout(&self, bytes: usize) -> Result<(), String> {
        self.add_output_bytes(bytes)
    }

    pub fn record_stderr(&self, bytes: usize) -> Result<(), String> {
        self.add_output_bytes(bytes)
    }

    pub fn tick_command(&self) -> Result<(), String> {
        self.check_cancelled()?;
        let prev = self.commands.fetch_add(1, Ordering::Relaxed);
        if prev + 1 > self.limits.max_commands {
            return Err(self.record_exceeded(format!(
                "Execution aborted: Shell limit exceeded: maxCommands ({})",
                self.limits.max_commands
            )));
        }
        Ok(())
    }

    pub fn add_output_bytes(&self, bytes: usize) -> Result<(), String> {
        if bytes == 0 {
            return Ok(());
        }
        let prev = self.output_bytes.fetch_add(bytes, Ordering::Relaxed);
        if prev.saturating_add(bytes) > self.limits.max_output_bytes {
            return Err(self.record_exceeded(format!(
                "Execution aborted: Shell limit exceeded: maxOutputBytes ({})",
                self.limits.max_output_bytes
            )));
        }
        Ok(())
    }

    pub fn tick_fs_op(&self) -> Result<(), String> {
        let prev = self.fs_ops.fetch_add(1, Ordering::Relaxed);
        if prev + 1 > self.limits.max_filesystem_operations {
            return Err(self.record_exceeded(format!(
                "Execution aborted: Shell limit exceeded: maxFileSystemOperations ({})",
                self.limits.max_filesystem_operations
            )));
        }
        Ok(())
    }
}
