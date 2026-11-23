// Insert the parameter sets needed by concat's H.264 byte-stream conversion.
// Internal MP4 staging retains four-byte NAL lengths instead of start codes.
pub(in super::super) struct Converter<'a> {
    length: usize,
    sets: [Vec<&'a [u8]>; 2],
    seen: [bool; 2],
    new_picture: bool,
}

impl<'a> Converter<'a> {
    pub(in super::super) fn new(config: &'a [u8]) -> Result<Self, &'static str> {
        if config.len() < 7 || config[0] != 1 {
            return Err("Invalid H.264 configuration");
        }
        let mut bytes = &config[6..];
        let mut sets = [Vec::new(), Vec::new()];
        let mut count = usize::from(config[5] & 31);
        for (i, set) in sets.iter_mut().enumerate() {
            if i == 1 {
                let (&n, rest) = bytes.split_first().ok_or("Truncated H.264 configuration")?;
                count = usize::from(n);
                bytes = rest;
            }
            for _ in 0..count {
                let (prefix, rest) = bytes.split_at_checked(2).ok_or("Truncated H.264 configuration")?;
                let size = usize::from(u16::from_be_bytes([prefix[0], prefix[1]]));
                let (nal, rest) = rest.split_at_checked(size).ok_or("Truncated H.264 configuration")?;
                set.push(nal);
                bytes = rest;
            }
        }
        Ok(Self {
            length: usize::from(config[4] & 3) + 1,
            sets,
            seen: [false; 2],
            new_picture: true,
        })
    }

    pub(in super::super) fn packet(&mut self, data: &'a [u8], remaining: &mut usize) -> Result<Vec<u8>, &'static str> {
        let length = self.length;
        let units = || {
            let mut bytes = data;
            std::iter::from_fn(move || {
                if bytes.is_empty() { return None; }
                let result = (|| {
                    let (prefix, rest) = bytes.split_at_checked(length).ok_or("Truncated H.264 NAL length")?;
                    let size = prefix.iter().fold(0usize, |n, &b| n << 8 | usize::from(b));
                    let (nal, rest) = rest.split_at_checked(size).ok_or("Invalid H.264 NAL length")?;
                    bytes = rest;
                    Ok(nal)
                })();
                if result.is_err() { bytes = &[]; }
                Some(result)
            })
        };
        // In-band changes replace the cached set of that kind for later pictures.
        let mut replaced = [false; 2];
        for nal in units() {
            let nal = nal?;
            let kind = nal.first().copied().unwrap_or(0) & 31;
            if !matches!(kind, 7 | 8) { continue; }
            let index = usize::from(kind - 7);
            if !replaced[index] {
                self.sets[index].clear();
                replaced[index] = true;
            }
            if self.sets.iter().map(Vec::len).sum::<usize>() >= *remaining / size_of::<&[u8]>() {
                return Err("H.264 parameter sets exceed memory budget");
            }
            self.sets[index].push(nal);
        }
        let mut output = Vec::new();
        let mut append = |nal: &[u8]| -> Result<(), &'static str> {
            let size = u32::try_from(nal.len()).map_err(|_| "H.264 packet exceeds memory budget")?;
            *remaining = remaining.checked_sub(4 + nal.len()).ok_or("H.264 packet exceeds memory budget")?;
            output.extend_from_slice(&size.to_be_bytes());
            output.extend_from_slice(nal);
            Ok(())
        };
        for nal in units() {
            let nal = nal?;
            let Some(&header) = nal.first() else { continue; };
            let kind = header & 31;
            if kind == 7 {
                self.seen[0] = true;
                self.new_picture = true;
            }
            if kind == 8 {
                self.seen[1] = true;
                self.new_picture = true;
                if !self.seen[0] {
                    for sps in &self.sets[0] { append(sps)?; }
                    self.seen[0] = !self.sets[0].is_empty();
                }
            }
            if kind == 5 && nal.get(1).is_some_and(|b| b & 128 != 0) {
                self.new_picture = true;
            }
            if kind == 5 && self.new_picture && !self.seen[1] {
                for i in 0..2 {
                    if !self.seen[i] {
                        for set in &self.sets[i] { append(set)?; }
                    }
                }
                if !self.seen[0] { self.new_picture = false; }
            }
            append(nal)?;
            if kind == 1 {
                self.seen = [false; 2];
                self.new_picture = true;
            }
        }
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::Converter;

    #[test]
    fn rejects_truncated_configuration_and_packets() {
        let config = [1, 66, 0, 10, 255, 225, 0, 2, 103, 1, 1, 0, 2, 104, 2];
        for end in 0..config.len() {
            assert!(Converter::new(&config[..end]).is_err(), "configuration length {end}");
        }
        for packet in [&[0, 0, 0][..], &[0, 0, 0, 2, 101], &[255, 255, 255, 255]] {
            assert!(Converter::new(&config).unwrap().packet(packet, &mut 1024).is_err());
        }
    }

    #[test]
    fn bounds_inserted_parameter_sets_and_skips_empty_nals() {
        let config = [1, 66, 0, 10, 255, 225, 0, 2, 103, 1, 1, 0, 2, 104, 2];
        let packet = [0, 0, 0, 0, 0, 0, 0, 2, 101, 128];
        let expected = [0, 0, 0, 2, 103, 1, 0, 0, 0, 2, 104, 2, 0, 0, 0, 2, 101, 128];
        for limit in 0..expected.len() {
            assert!(Converter::new(&config).unwrap().packet(&packet, &mut {limit}).is_err());
        }
        let mut remaining = expected.len();
        assert_eq!(Converter::new(&config).unwrap().packet(&packet, &mut remaining).unwrap(), expected);
        assert_eq!(remaining, 0);
    }
}
