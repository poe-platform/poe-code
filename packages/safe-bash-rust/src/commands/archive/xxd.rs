use super::{BuiltinOutcome, SafeBashFs, err_out, ok_out, resolve_posix_path};
use crate::commands::{CommandInput, CommandWriter, coreutils::stream_file_error};
use std::fmt::Write;

fn input_error(e: &str) -> BuiltinOutcome {
    err_out(
        &format!("xxd: {e}\n"),
        if e.starts_with("ENOENT:") { 2 } else { 1 },
    )
}

fn read_input(
    stdin: &mut CommandInput,
    name: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    mut consume: impl FnMut(&[u8]) -> bool,
) -> Result<(), String> {
    let limit = fs.max_input_bytes();
    let mut left = limit;
    let mut feed = |chunk: &[u8]| {
        left = left
            .checked_sub(chunk.len())
            .ok_or_else(|| fs.limit_error("maxInputBytes", limit))?;
        Ok(chunk.chunks(8192).all(&mut consume))
    };
    if name == "-" {
        let mut status = Ok(true);
        stdin.read_stdin(|chunk| {
            status = feed(chunk);
            matches!(status, Ok(true))
        })?;
        status.map(|_| ())
    } else {
        let path = crate::vfs::path::absolute_operand(cwd, name);
        fs.inspect_command_entry(&path, true, "capabilitiesFor")
            .and_then(|(entry, stat)| {
                if stat.kind == crate::vfs::VfsEntryKind::Directory {
                    return Err("EISDIR: illegal operation on a directory".into());
                }
                fs.read_chunks(&entry, &mut |chunk| {
                    for part in chunk.chunks(8192) {
                        if !feed(part)? {
                            return Ok(false);
                        }
                    }
                    Ok(true)
                })
            })
            .map_err(|e| stream_file_error(e, "readStream", &path))
    }
}

const MAX_ADDRESS: u64 = (1 << 53) - 1;

fn parse_xxd_num(text: &str) -> Result<u64, String> {
    let (digits, radix) =
        if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
            (hex, 16)
        } else if text.starts_with('0') {
            (text, 8)
        } else {
            (text, 10)
        };
    if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
        return Err(format!("invalid number '{text}'"));
    }
    u64::from_str_radix(digits, radix)
        .ok()
        .filter(|&v| v <= MAX_ADDRESS)
        .ok_or_else(|| format!("number out of range '{text}'"))
}

pub(crate) fn cmd_xxd(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    fs: &dyn SafeBashFs,
    write: &mut CommandWriter,
) -> BuiltinOutcome {
    let mut autoskip = false;
    let mut capitalize = false;
    let mut plain = false;
    let mut reverse = false;
    let mut decimal_addr = false;
    let mut upper_hex = false;
    let mut bits_mode = false;
    let mut c_include = false;
    let mut little_endian = false;
    let mut numbers = Vec::new();
    let mut custom_name: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();

    let mut ended = false;
    let mut normalized_args: Vec<String> = Vec::with_capacity(args.len());
    for arg in args {
        if ended {
            normalized_args.push(arg.clone());
            continue;
        }
        if arg == "--" {
            ended = true;
            normalized_args.push(arg.clone());
            continue;
        }
        let mapped = match arg.as_str() {
            "-ps" | "-plain" | "-postscript" => "-p",
            "-revert" => "-r",
            "-cols" => "-c",
            "-groupsize" => "-g",
            "-len" => "-l",
            "-bits" => "-b",
            "-include" => "-i",
            "-name" => "-n",
            "-autoskip" => "-a",
            "-capitalize" => "-C",
            other => other,
        };
        normalized_args.push(mapped.to_string());
    }

    ended = false;
    let mut i = 0usize;
    while i < normalized_args.len() {
        let a = normalized_args[i].as_str();
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            operands.push(a.to_string());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            return err_out(&format!("xxd: unrecognized option '{a}'\n"), 2);
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut c_idx = 0usize;
        while c_idx < chars.len() {
            let ch = chars[c_idx];
            match ch {
                'a' => autoskip = !autoskip,
                'C' => capitalize = true,
                'p' => plain = true,
                'r' => reverse = true,
                'd' => decimal_addr = true,
                'u' => upper_hex = true,
                'b' => bits_mode = true,
                'i' => c_include = true,
                'e' => little_endian = true,
                'c' | 'g' | 'l' | 's' | 'o' | 'n' => {
                    let rest: String = chars[c_idx + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < normalized_args.len() {
                        i += 1;
                        normalized_args[i].clone()
                    } else {
                        return err_out(
                            &format!("xxd: option requires an argument -- '{ch}'\n"),
                            2,
                        );
                    };
                    if ch == 'n' {
                        custom_name = Some(val);
                    } else {
                        numbers.push((ch, val));
                    }
                    break;
                }
                _ => return err_out(&format!("xxd: invalid option -- '{ch}'\n"), 2),
            }
            c_idx += 1;
        }
        i += 1;
    }

    if operands.len() > 2 {
        return err_out(&format!("xxd: extra operand '{}'\n", operands[2]), 2);
    }
    let infile = operands.first().map(String::as_str).unwrap_or("-");
    let outpath = operands
        .get(1)
        .filter(|name| name.as_str() != "-")
        .map(|s| resolve_posix_path(cwd, s));
    if !reverse
        && let Some(path) = &outpath
        && let Err(e) = fs.write_file(path, &[])
    {
        return input_error(&e);
    }
    if (plain && (bits_mode || c_include || little_endian))
        || (little_endian && (bits_mode || c_include))
        || (bits_mode && c_include)
    {
        return err_out("xxd: incompatible display modes\n", 2);
    }
    if reverse && (bits_mode || c_include || little_endian) {
        return err_out("xxd: cannot revert this type of hexdump\n", 2);
    }
    let default_cols = if plain {
        30
    } else if c_include {
        12
    } else if bits_mode {
        6
    } else {
        16
    };
    let mut cols = default_cols;
    let mut group_bytes = if little_endian {
        4
    } else if bits_mode {
        1
    } else {
        2
    };
    let mut seek = 0i64;
    let mut max_len = None;
    let mut displacement = 0;
    for key in ['c', 'g', 's', 'l', 'o'] {
        for (_, val) in numbers.iter().filter(|(flag, _)| *flag == key) {
            let spec = if key == 's' {
                val.strip_prefix('+').unwrap_or(val)
            } else {
                val
            };
            let negative = key == 's' && spec.starts_with('-');
            let number = match parse_xxd_num(if negative { &spec[1..] } else { spec }) {
                Ok(n) => n,
                Err(e) => return err_out(&format!("xxd: {e}\n"), 2),
            };
            match key {
                'c' => {
                    cols = if number == 0 && !plain {
                        default_cols
                    } else {
                        usize::try_from(number).unwrap_or(usize::MAX)
                    }
                }
                'g' => group_bytes = usize::try_from(number).unwrap_or(usize::MAX),
                's' => {
                    seek = if negative {
                        -(number as i64)
                    } else {
                        number as i64
                    }
                }
                'l' => max_len = Some(number),
                _ => displacement = number,
            }
        }
        if key == 'g' && little_endian && group_bytes != 0 && !group_bytes.is_power_of_two() {
            return err_out(
                "xxd: number of octets per group must be a power of 2 with -e\n",
                2,
            );
        }
    }
    if reverse && (numbers.iter().any(|(c, _)| *c == 'l' || *c == 'o') || decimal_addr) {
        return err_out(
            "xxd: reverse does not support seek, length, displacement, or decimal addresses\n",
            2,
        );
    }
    if reverse {
        let Ok(seek_offset) = usize::try_from(seek) else {
            return err_out("xxd: Sorry, cannot seek.\n", 4);
        };
        let mut raw_data = Vec::new();
        if let Err(e) = read_input(&mut stdin, infile, cwd, fs, |chunk| {
            raw_data.extend_from_slice(chunk);
            true
        }) {
            return input_error(&e);
        }
        let mut out_bytes: Vec<u8> = Vec::new();
        if plain {
            if seek_offset > 0 {
                out_bytes.resize(seek_offset, 0);
            }
            let mut high: Option<u8> = None;
            for &b in &raw_data {
                if b == b' ' || (9..=13).contains(&b) {
                    continue;
                }
                let digit = match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(b - b'a' + 10),
                    b'A'..=b'F' => Some(b - b'A' + 10),
                    _ => None,
                };
                if let Some(d) = digit {
                    if let Some(h) = high {
                        out_bytes.push((h << 4) | d);
                        high = None;
                    } else {
                        high = Some(d);
                    }
                } else {
                    high = None;
                }
            }
        } else {
            for line in raw_data.split(|&b| b == b'\n') {
                let trimmed_non_ws = line.iter().any(|&b| b != b' ' && !(9..=13).contains(&b));
                if !trimmed_non_ws || line == b"*" {
                    continue;
                }
                let Some(colon_pos) = line.iter().position(|&b| b == b':') else {
                    return err_out(
                        "xxd: invalid input: expected hexadecimal address and colon\n",
                        1,
                    );
                };
                if colon_pos == 0 || colon_pos > 14 {
                    return err_out(
                        "xxd: invalid input: expected hexadecimal address and colon\n",
                        1,
                    );
                }
                let mut addr = 0usize;
                for &b in &line[..colon_pos] {
                    let d = match b {
                        b'0'..=b'9' => (b - b'0') as usize,
                        b'a'..=b'f' => (b - b'a' + 10) as usize,
                        b'A'..=b'F' => (b - b'A' + 10) as usize,
                        _ => {
                            return err_out(
                                "xxd: invalid input: expected hexadecimal address and colon\n",
                                1,
                            );
                        }
                    };
                    addr = addr.saturating_mul(16).saturating_add(d);
                }
                addr = addr.saturating_add(seek_offset);
                if out_bytes.len() < addr {
                    out_bytes.resize(addr, 0);
                }
                let mut row_bytes: Vec<u8> = Vec::new();
                let mut high: Option<u8> = None;
                let mut spaces = 0usize;
                for &b in &line[colon_pos + 1..] {
                    if b == b' ' || b == b'\t' || b == b'\r' {
                        spaces += 1;
                        if !row_bytes.is_empty() && spaces >= 2 {
                            break;
                        }
                        continue;
                    }
                    let digit = match b {
                        b'0'..=b'9' => Some(b - b'0'),
                        b'a'..=b'f' => Some(b - b'a' + 10),
                        b'A'..=b'F' => Some(b - b'A' + 10),
                        _ => None,
                    };
                    let Some(d) = digit else {
                        break;
                    };
                    spaces = 0;
                    if let Some(h) = high {
                        row_bytes.push((h << 4) | d);
                        high = None;
                        if row_bytes.len() == cols {
                            break;
                        }
                    } else {
                        high = Some(d);
                    }
                }
                for (k, &rb) in row_bytes.iter().enumerate() {
                    if addr + k < out_bytes.len() {
                        out_bytes[addr + k] = rb;
                    } else {
                        out_bytes.push(rb);
                    }
                }
            }
        }
        if let Some(path) = &outpath {
            if let Err(e) = fs.write_file(path, &out_bytes) {
                return input_error(&e);
            }
            return ok_out("");
        }
        return ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes));
    }

    let seek_offset = if seek < 0 {
        if infile == "-" {
            return err_out("xxd: negative seek requires an input file\n", 2);
        }
        let size = match fs.stat(&resolve_posix_path(cwd, infile)) {
            Ok(st) => st.size as u64,
            Err(e) => return input_error(&e),
        };
        let Some(start) = size.checked_sub(seek.unsigned_abs()) else {
            return err_out("xxd: Sorry, cannot seek.\n", 4);
        };
        start
    } else {
        seek as u64
    };
    let mut offset = seek_offset + displacement;
    if offset > MAX_ADDRESS {
        return err_out("xxd: input address exceeds safe integer range\n", 1);
    }
    let raw_var = custom_name.or_else(|| {
        if infile != "-" {
            Some(infile.to_string())
        } else {
            None
        }
    });
    let var_name = raw_var.map(|f| {
        let mut ident: String = f
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        if ident.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            ident.insert_str(0, "__");
        }
        if capitalize {
            ident = ident.to_ascii_uppercase();
        }
        ident
    });
    let mut out = String::new();
    if c_include && let Some(vn) = &var_name {
        out = format!("unsigned char {vn}[] = {{\n");
    }
    let octets = if group_bytes == 0 {
        cols
    } else {
        group_bytes.min(cols)
    };
    let width = if plain || c_include {
        0
    } else if little_endian {
        cols.div_ceil(octets)
            .saturating_mul(octets.saturating_mul(2).saturating_add(1))
            - 1
    } else {
        cols.saturating_mul(if bits_mode { 8 } else { 2 })
            .saturating_add((cols - 1).checked_div(group_bytes).unwrap_or(0))
    };

    let mut zero_run = 0usize;
    let mut zero_second = String::new();
    let mut zero_last = String::new();
    let finish_zeros =
        |out_buf: &mut String, z_run: &mut usize, z_sec: &str, z_last: &str, at_end: bool| {
            if *z_run >= if at_end { 4 } else { 3 } {
                out_buf.push_str("*\n");
                if at_end {
                    out_buf.push_str(z_last);
                }
            } else if *z_run == 3 {
                out_buf.push_str(z_sec);
                out_buf.push_str(z_last);
            } else if *z_run == 2 {
                out_buf.push_str(z_last);
            }
            *z_run = 0;
        };

    let mut result = ok_out("");
    let mut emitted = false;
    let mut writable = true;
    let mut flush = |out: &mut String| {
        if out.is_empty() {
            return true;
        }
        let ok = if let Some(path) = &outpath {
            match fs.append_file(path, out.as_bytes()) {
                Ok(()) => true,
                Err(e) => {
                    result = input_error(&e);
                    false
                }
            }
        } else {
            write(1, out, &mut result)
        };
        out.clear();
        ok
    };
    let mut any = false;
    let mut include_row = String::new();
    let mut length = 0u64;
    let row_width = if plain && cols == 0 { 4096 } else { cols };
    let hex = if upper_hex {
        b"0123456789ABCDEF"
    } else {
        b"0123456789abcdef"
    };
    let put_hex = |out: &mut String, b: u8| {
        out.push(hex[(b >> 4) as usize] as char);
        out.push(hex[(b & 15) as usize] as char);
    };
    let mut format_error = None;
    let mut batch = |data: &[u8]| {
        for chunk in data.chunks(row_width) {
            any = true;
            if c_include {
                if !include_row.is_empty() {
                    out.push_str(&include_row);
                    out.push_str(",\n");
                }
                include_row.clear();
                include_row.push_str("  ");
                for (i, byte) in chunk.iter().enumerate() {
                    if i != 0 {
                        include_row.push_str(", ");
                    }
                    include_row.push_str(if upper_hex { "0X" } else { "0x" });
                    put_hex(&mut include_row, *byte);
                }
                length += chunk.len() as u64;
            } else if plain {
                for &b in chunk {
                    put_hex(&mut out, b);
                }
                if cols != 0 {
                    out.push('\n');
                }
            } else {
                if width > fs.shell_limits().max_output_bytes {
                    format_error =
                        Some(fs.limit_error("maxOutputBytes", fs.shell_limits().max_output_bytes));
                    return false;
                }
                let addr_str = if decimal_addr {
                    format!("{offset:08}")
                } else {
                    format!("{offset:08x}")
                };
                let mut hex_data = String::new();
                let mut ascii = String::new();
                for (idx, &b) in chunk.iter().enumerate() {
                    if !little_endian && group_bytes > 0 && idx > 0 && idx % group_bytes == 0 {
                        hex_data.push(' ');
                    }
                    if !little_endian {
                        if bits_mode {
                            hex_data.push_str(&format!("{b:08b}"));
                        } else {
                            put_hex(&mut hex_data, b);
                        }
                    }
                    ascii.push(if (0x20..=0x7e).contains(&b) {
                        b as char
                    } else {
                        '.'
                    });
                }
                if little_endian {
                    let mut start = 0usize;
                    while start < chunk.len() {
                        if start > 0 {
                            hex_data.push(' ');
                        }
                        for k in (start..start + octets).rev() {
                            if let Some(&b) = chunk.get(k) {
                                put_hex(&mut hex_data, b);
                            } else {
                                hex_data.push_str("  ");
                            }
                        }
                        start += octets;
                    }
                }
                let formatted = format!("{addr_str}: {hex_data:<width$}  {ascii}\n");
                if autoskip && chunk.len() == cols && chunk.iter().all(|&b| b == 0) {
                    if zero_run == 0 {
                        out.push_str(&formatted);
                    }
                    if zero_run == 1 {
                        zero_second = formatted.clone();
                    }
                    zero_run += 1;
                    zero_last = formatted;
                } else {
                    finish_zeros(&mut out, &mut zero_run, &zero_second, &zero_last, false);
                    out.push_str(&formatted);
                }
            }
            offset += chunk.len() as u64;
            if offset > MAX_ADDRESS {
                format_error = Some("input address exceeds safe integer range".into());
                return false;
            }
            if (!emitted || out.len() >= 16384) && !out.is_empty() {
                emitted = true;
                if !flush(&mut out) {
                    return false;
                }
            }
        }
        flush(&mut out)
    };

    let mut skip = seek_offset;
    let mut left = max_len.unwrap_or(u64::MAX);
    let mut pending = Vec::new();
    let read = if skip == 0 && left == 0 {
        Ok(())
    } else {
        read_input(&mut stdin, infile, cwd, fs, |chunk| {
            let drop = skip.min(chunk.len() as u64);
            skip -= drop;
            let n = left.min(chunk.len() as u64 - drop);
            left -= n;
            let mut data = &chunk[drop as usize..(drop + n) as usize];
            if !pending.is_empty() {
                let take = (row_width - pending.len()).min(data.len());
                pending.extend_from_slice(&data[..take]);
                data = &data[take..];
                if pending.len() == row_width {
                    writable = batch(&pending);
                    pending.clear();
                }
            }
            let full = data.len() / row_width * row_width;
            if writable && full != 0 {
                writable = batch(&data[..full]);
            }
            pending.extend_from_slice(&data[full..]);
            writable && (skip != 0 || left != 0)
        })
    };
    if writable && read.is_ok() && !pending.is_empty() {
        writable = batch(&pending);
    }
    if !writable && format_error.is_none() {
        return result;
    }
    let read = read.and_then(|_| format_error.map_or(Ok(()), Err));
    let seek_failed = skip != 0 && infile == "-";
    if read.is_ok() && !seek_failed || any {
        finish_zeros(&mut out, &mut zero_run, &zero_second, &zero_last, true);
        if !include_row.is_empty() {
            out.push_str(&include_row);
            out.push('\n');
            if read.is_ok() && (!emitted || out.len() >= 16384) && !flush(&mut out) {
                return result;
            }
        }
        if read.is_ok() {
            if c_include && let Some(vn) = var_name {
                let suffix = if capitalize { "_LEN" } else { "_len" };
                write!(out, "}};\nunsigned int {vn}{suffix} = {length};\n").unwrap();
            }
            if plain && cols == 0 && any {
                out.push('\n');
            }
        }
        if !flush(&mut out) {
            return result;
        }
    }
    if let Err(e) = read {
        let error = input_error(&e);
        result.stderr.push_str(&error.stderr);
        result.exit_code = error.exit_code;
    } else if seek_failed {
        result.stderr.push_str("xxd: Sorry, cannot seek.\n");
        result.exit_code = 4;
    }
    result
}
