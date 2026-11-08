//! Platform process ownership for PTYs. Spawned PIDs stay pinned until reaped.
use std::{io, process::Child};
pub enum Process {
    System(Child),
    #[cfg(target_os = "macos")]
    Direct {
        pid: u32,
        exit: Option<i32>,
    },
}
impl Process {
    pub fn id(&self) -> u32 {
        match self {
            Self::System(child) => child.id(),
            #[cfg(target_os = "macos")]
            Self::Direct { pid, .. } => *pid,
        }
    }
    pub fn try_wait(&mut self) -> io::Result<Option<i32>> {
        match self {
            Self::System(child) => child.try_wait().map(|s| s.map(|s| s.code().unwrap_or(0))),
            #[cfg(target_os = "macos")]
            Self::Direct { pid, exit } => {
                if exit.is_none() {
                    *exit = macos::wait(*pid, 1)?;
                }
                Ok(*exit)
            }
        }
    }
    pub fn wait(&mut self) -> io::Result<()> {
        match self {
            Self::System(child) => child.wait().map(|_| ()),
            #[cfg(target_os = "macos")]
            Self::Direct { pid, exit } => {
                if exit.is_none() {
                    *exit = macos::wait(*pid, 0)?;
                }
                Ok(())
            }
        }
    }
}
#[cfg(target_os = "macos")]
pub mod macos {
    use super::Process;
    use crate::pty::Options;
    use std::{
        ffi::{CString, c_char, c_int, c_short, c_void},
        io,
        path::Path,
    };
    unsafe extern "C" {
        fn posix_spawnattr_init(attr: *mut *mut c_void) -> c_int;
        fn posix_spawnattr_destroy(attr: *mut *mut c_void) -> c_int;
        fn posix_spawnattr_setflags(attr: *mut *mut c_void, flags: c_short) -> c_int;
        fn posix_spawnattr_setsigmask(attr: *mut *mut c_void, mask: *const u32) -> c_int;
        fn posix_spawnattr_setsigdefault(attr: *mut *mut c_void, mask: *const u32) -> c_int;
        fn posix_spawn_file_actions_init(actions: *mut *mut c_void) -> c_int;
        fn posix_spawn_file_actions_destroy(actions: *mut *mut c_void) -> c_int;
        fn posix_spawn_file_actions_addopen(
            actions: *mut *mut c_void,
            fd: c_int,
            path: *const c_char,
            flags: c_int,
            mode: u16,
        ) -> c_int;
        fn posix_spawn_file_actions_adddup2(
            actions: *mut *mut c_void,
            from: c_int,
            to: c_int,
        ) -> c_int;
        fn posix_spawn(
            pid: *mut c_int,
            path: *const c_char,
            actions: *const *mut c_void,
            attr: *const *mut c_void,
            argv: *const *const c_char,
            env: *const *const c_char,
        ) -> c_int;
        fn ttyname_r(fd: c_int, name: *mut c_char, len: usize) -> c_int;
        fn waitpid(pid: c_int, status: *mut c_int, flags: c_int) -> c_int;
    }
    fn status(result: c_int) -> io::Result<()> {
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(result))
        }
    }
    fn cstring(text: &str) -> io::Result<CString> {
        CString::new(text).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "PTY command, arguments and environment must not contain NUL.",
            )
        })
    }
    struct Plan {
        attr: *mut c_void,
        actions: *mut c_void,
    }
    impl Drop for Plan {
        fn drop(&mut self) {
            // Only initialized platform handles are destroyed, once, on every error path.
            unsafe {
                if !self.attr.is_null() {
                    posix_spawnattr_destroy(&mut self.attr);
                }
                if !self.actions.is_null() {
                    posix_spawn_file_actions_destroy(&mut self.actions);
                }
            }
        }
    }
    pub fn spawn(options: &Options, slave: c_int) -> io::Result<Option<Process>> {
        // No process-global cwd mutation. Other cwd/PATH cases retain std's spawn semantics.
        if !Path::new(&options.command).is_absolute()
            || options
                .cwd
                .as_deref()
                .is_some_and(|p| std::env::current_dir().map_or(true, |cwd| Path::new(p) != cwd))
        {
            return Ok(None);
        }
        let path = cstring(&options.command)?;
        let args = std::iter::once(options.command.as_str())
            .chain(options.args.iter().map(String::as_str))
            .map(cstring)
            .collect::<io::Result<Vec<_>>>()?;
        let mut argv = args.iter().map(|s| s.as_ptr()).collect::<Vec<_>>();
        argv.push(std::ptr::null());
        let env = options
            .env
            .iter()
            .map(|(k, v)| cstring(&format!("{k}={v}")))
            .collect::<io::Result<Vec<_>>>()?;
        let mut envp = env.iter().map(|s| s.as_ptr()).collect::<Vec<_>>();
        envp.push(std::ptr::null());
        let mut name = vec![0u8; 1024];
        status(unsafe { ttyname_r(slave, name.as_mut_ptr().cast(), name.len()) })?;
        let mut plan = Plan {
            attr: std::ptr::null_mut(),
            actions: std::ptr::null_mut(),
        };
        // Darwin defines both opaque handles as pointers; sigset_t is a 32-bit bit set.
        unsafe {
            status(posix_spawnattr_init(&mut plan.attr))?;
            status(posix_spawn_file_actions_init(&mut plan.actions))?;
            // SETSID + CLOEXEC_DEFAULT + SETSIGDEF + SETSIGMASK.
            status(posix_spawnattr_setflags(
                &mut plan.attr,
                0x0400 | 0x4000 | 0x0004 | 0x0008,
            ))?;
            status(posix_spawnattr_setsigmask(&mut plan.attr, &0))?;
            status(posix_spawnattr_setsigdefault(&mut plan.attr, &u32::MAX))?;
            // Opening the slave after setsid establishes the child's controlling terminal.
            status(posix_spawn_file_actions_addopen(
                &mut plan.actions,
                0,
                name.as_ptr().cast(),
                2,
                0,
            ))?;
            status(posix_spawn_file_actions_adddup2(&mut plan.actions, 0, 1))?;
            status(posix_spawn_file_actions_adddup2(&mut plan.actions, 0, 2))?;
            let mut pid = 0;
            status(posix_spawn(
                &mut pid,
                path.as_ptr(),
                &plan.actions,
                &plan.attr,
                argv.as_ptr(),
                envp.as_ptr(),
            ))?;
            Ok(Some(Process::Direct {
                pid: pid as u32,
                exit: None,
            }))
        }
    }
    pub(super) fn wait(pid: u32, flags: c_int) -> io::Result<Option<i32>> {
        loop {
            let mut value = 0;
            let result = unsafe { waitpid(pid as c_int, &mut value, flags) };
            if result == 0 {
                return Ok(None);
            }
            if result == pid as c_int {
                return Ok(Some(if value & 0x7f == 0 {
                    (value >> 8) & 0xff
                } else {
                    0
                }));
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}
