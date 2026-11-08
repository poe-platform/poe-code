//! Packed terminal channels and minimal SGR transition planning.
use std::convert::Infallible;

pub const BOLD: i32 = 1;
pub const DIM: i32 = 2;
pub const UNDERLINE: i32 = 4;
pub const INVERSE: i32 = 8;

pub fn pack(flags: [bool; 4], fg: i32, bg: i32) -> i32 {
    flags
        .into_iter()
        .zip([BOLD, DIM, UNDERLINE, INVERSE])
        .fold(
            0,
            |packed, (enabled, bit)| if enabled { packed | bit } else { packed },
        )
        | ((fg & 255) << 8)
        | ((bg & 255) << 16)
}

pub fn channel(style: i32, background: bool) -> i32 {
    (style >> if background { 16 } else { 8 }) & 255
}

pub trait Host {
    type Error;
    fn operand(&mut self, next: bool) -> Result<i32, Self::Error>;
    fn code(&mut self, code: i32) -> Result<(), Self::Error>;
}

pub fn emit<H: Host>(host: &mut H) -> Result<(), H::Error> {
    let previous = host.operand(false)? & (BOLD | DIM);
    let next = host.operand(true)? & (BOLD | DIM);
    if previous != next {
        let reset = (previous & !next) != 0;
        if reset {
            host.code(22)?;
        }
        if next & BOLD != 0 && (reset || previous & BOLD == 0) {
            host.code(1)?;
        }
        if next & DIM != 0 && (reset || previous & DIM == 0) {
            host.code(2)?;
        }
    }
    for (flag, on, off) in [(UNDERLINE, 4, 24), (INVERSE, 7, 27)] {
        let previous = host.operand(false)? & flag;
        let next = host.operand(true)? & flag;
        if previous != next {
            let code = if host.operand(true)? & flag == 0 {
                off
            } else {
                on
            };
            host.code(code)?;
        }
    }
    for (background, default, base) in [(false, 39, 30), (true, 49, 40)] {
        let previous = channel(host.operand(false)?, background);
        let next = channel(host.operand(true)?, background);
        if previous != next {
            host.code(if next == 0 { default } else { base + next })?;
        }
    }
    Ok(())
}

pub fn codes(previous: i32, next: i32) -> Vec<i32> {
    struct Numbers {
        values: [i32; 2],
        codes: Vec<i32>,
    }
    impl Host for Numbers {
        type Error = Infallible;
        fn operand(&mut self, next: bool) -> Result<i32, Self::Error> {
            Ok(self.values[usize::from(next)])
        }
        fn code(&mut self, code: i32) -> Result<(), Self::Error> {
            self.codes.push(code);
            Ok(())
        }
    }
    let mut host = Numbers {
        values: [previous, next],
        codes: Vec::with_capacity(7),
    };
    match emit(&mut host) {
        Ok(()) => host.codes,
        Err(error) => match error {},
    }
}
