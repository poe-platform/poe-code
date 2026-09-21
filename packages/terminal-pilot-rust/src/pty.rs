//! Own POSIX PTY transport. Descriptor ownership uses std; C calls are confined here.
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod posix {
    use std::{
        collections::VecDeque,
        ffi::{c_char, c_int, c_ulong, c_void},
        fs::File,
        io::{self, Read, Write},
        os::fd::{AsRawFd, FromRawFd},
        os::unix::process::CommandExt,
        process::{Child, Command, Stdio},
    };
    #[repr(C)]
    struct Winsize {
        rows: u16,
        cols: u16,
        xpixel: u16,
        ypixel: u16,
    }
    #[cfg_attr(target_os = "linux", link(name = "util"))]
    unsafe extern "C" {
        fn openpty(
            master: *mut c_int,
            slave: *mut c_int,
            name: *mut c_char,
            termios: *const c_void,
            size: *const Winsize,
        ) -> c_int;
        fn fcntl(fd: c_int, command: c_int, ...) -> c_int;
        fn setsid() -> c_int;
        fn ioctl(fd: c_int, request: c_ulong, ...) -> c_int;
        fn kill(pid: c_int, signal: c_int) -> c_int;
    }
    #[cfg(target_os = "macos")]
    const TIOCSCTTY: c_ulong = 0x20007461;
    #[cfg(target_os = "macos")]
    const TIOCSWINSZ: c_ulong = 0x80087467;
    #[cfg(target_os = "macos")]
    const NONBLOCK: c_int = 4;
    #[cfg(not(target_os = "macos"))]
    const TIOCSCTTY: c_ulong = 0x540e;
    #[cfg(not(target_os = "macos"))]
    const TIOCSWINSZ: c_ulong = 0x5414;
    #[cfg(not(target_os = "macos"))]
    const NONBLOCK: c_int = 0x800;
    #[derive(Clone)]
    pub struct Options {
        pub command: String,
        pub args: Vec<String>,
        pub cwd: Option<String>,
        pub env: Vec<(String, String)>,
        pub cols: usize,
        pub rows: usize,
    }
    pub struct Pty {
        master: File,
        child: Option<Child>,
        pending: VecDeque<u8>,
        exited: Option<i32>,
    }
    fn size(cols: usize, rows: usize) -> io::Result<Winsize> {
        if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Terminal columns and rows must be positive integers no greater than 1000.",
            ));
        }
        Ok(Winsize {
            rows: rows as u16,
            cols: cols as u16,
            xpixel: 0,
            ypixel: 0,
        })
    }
    impl Pty {
        pub fn spawn(options: Options) -> io::Result<Self> {
            let size = size(options.cols, options.rows)?;
            let (mut master, mut slave) = (-1, -1);
            // openpty writes two owned descriptors on success; termios defaults are platform-owned.
            if unsafe {
                openpty(
                    &mut master,
                    &mut slave,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    &size,
                )
            } < 0
            {
                return Err(io::Error::last_os_error());
            }
            // Each successful descriptor is adopted exactly once and closed on every subsequent error.
            let master = unsafe { File::from_raw_fd(master) };
            let slave = unsafe { File::from_raw_fd(slave) };
            for fd in [master.as_raw_fd(), slave.as_raw_fd()] {
                if unsafe { fcntl(fd, 2, 1) } < 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            let flags = unsafe { fcntl(master.as_raw_fd(), 3) };
            if flags < 0 || unsafe { fcntl(master.as_raw_fd(), 4, flags | NONBLOCK) } < 0 {
                return Err(io::Error::last_os_error());
            }
            let mut command = Command::new(&options.command);
            command
                .args(&options.args)
                .env_clear()
                .envs(options.env)
                .stdin(Stdio::from(slave.try_clone()?))
                .stdout(Stdio::from(slave.try_clone()?))
                .stderr(Stdio::from(slave));
            if let Some(cwd) = options.cwd {
                command.current_dir(cwd);
            }
            // Only async-signal-safe platform calls occur after fork; no allocation or locks.
            unsafe {
                command.pre_exec(|| {
                    if setsid() < 0 || ioctl(0, TIOCSCTTY, 0) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            let child = command.spawn()?;
            Ok(Self {
                master,
                child: Some(child),
                pending: VecDeque::new(),
                exited: None,
            })
        }
        pub fn pid(&self) -> u32 {
            self.child.as_ref().unwrap().id()
        }
        pub fn write(&mut self, data: &[u8]) -> io::Result<()> {
            if self.pending.len().saturating_add(data.len()) > 2 * 1024 * 1024 {
                return Err(io::Error::new(
                    io::ErrorKind::OutOfMemory,
                    "PTY pending input exceeds byte budget.",
                ));
            }
            self.pending.extend(data);
            self.flush()
        }
        fn flush(&mut self) -> io::Result<()> {
            while !self.pending.is_empty() {
                let (a, _) = self.pending.as_slices();
                match self.master.write(a) {
                    Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                    Ok(n) => {
                        self.pending.drain(..n);
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(e) => return Err(e),
                }
            }
            Ok(())
        }
        pub fn read(&mut self) -> io::Result<Vec<u8>> {
            self.flush()?;
            let mut bytes = vec![0; 16384];
            match self.master.read(&mut bytes) {
                Ok(n) => {
                    bytes.truncate(n);
                    Ok(bytes)
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock || e.raw_os_error() == Some(5) => {
                    Ok(vec![])
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => Ok(vec![]),
                Err(e) => Err(e),
            }
        }
        pub fn resize(&self, cols: usize, rows: usize) -> io::Result<()> {
            let size = size(cols, rows)?;
            if unsafe { ioctl(self.master.as_raw_fd(), TIOCSWINSZ, &size) } < 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        }
        pub fn signal(&mut self, signal: i32) -> io::Result<()> {
            if self.exit_code()?.is_some() {
                return Ok(());
            }
            if unsafe { kill(self.child.as_ref().unwrap().id() as c_int, signal) } < 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        }
        pub fn exit_code(&mut self) -> io::Result<Option<i32>> {
            if self.exited.is_none() {
                self.exited = self
                    .child
                    .as_mut()
                    .unwrap()
                    .try_wait()?
                    .map(|status| status.code().unwrap_or(0));
            }
            Ok(self.exited)
        }
    }
    impl Drop for Pty {
        fn drop(&mut self) {
            if let Some(mut child) = self.child.take()
                && child.try_wait().ok().flatten().is_none()
            {
                // setsid established this child's own process group before exec.
                // Kill the owned group while the live/unreaped leader pins its ID.
                unsafe {
                    kill(-(child.id() as c_int), 9);
                }
                let _ = child.kill();
                // Reaping cannot block the Node finalizer or an application's caller.
                let _ = std::thread::Builder::new()
                    .name("terminal-pty-reaper".into())
                    .spawn(move || {
                        let _ = child.wait();
                    });
            }
        }
    }
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub use posix::{Options, Pty};
