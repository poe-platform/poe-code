use super::adts::{Frames, Options, RATES};
use std::collections::BTreeMap;

// Boxes are nested directly in the output. Reserve a size word, then fill it
// once all children have been written; sample offsets are filled at mdat.
fn atom(out: &mut Vec<u8>, kind: &[u8; 4], body: impl FnOnce(&mut Vec<u8>)) {
    let start = out.len();
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(kind);
    body(out);
    let len = (out.len() - start) as u32;
    out[start..start + 4].copy_from_slice(&len.to_be_bytes());
}
fn words(out: &mut Vec<u8>, values: &[u32]) {
    for v in values {
        out.extend_from_slice(&v.to_be_bytes())
    }
}
const MATRIX: [u32; 9] = [65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30];
fn tags(out: &mut Vec<u8>, metadata: &BTreeMap<String, String>) {
    let keys = [
        (b"\xa9nam", "title"),
        (b"\xa9ART", "artist"),
        (b"\xa9alb", "album"),
        (b"\xa9day", "date"),
        (b"\xa9cmt", "comment"),
        (b"\xa9gen", "genre"),
        (b"\xa9too", "encoder"),
    ];
    let mut fields = keys
        .iter()
        .filter_map(|&(code, name)| {
            metadata
                .get(name)
                .or_else(|| {
                    if name == "date" {
                        metadata.get("year")
                    } else {
                        None
                    }
                })
                .filter(|v| !v.is_empty())
                .map(|v| (code, v))
        })
        .peekable();
    if fields.peek().is_none() {
        return;
    }
    atom(out, b"udta", |b| {
        atom(b, b"meta", |b| {
            words(b, &[0]);
            atom(b, b"hdlr", |b| {
                words(b, &[0, 0]);
                b.extend_from_slice(b"mdirappl");
                b.extend_from_slice(&[0; 9]);
            });
            atom(b, b"ilst", |b| {
                for (code, value) in fields {
                    atom(b, code, |b| {
                        atom(b, b"data", |b| {
                            words(b, &[1, 0]);
                            b.extend_from_slice(value.as_bytes());
                        })
                    })
                }
            });
        })
    });
}
struct Sample<'a> {
    data: &'a [u8],
    duration: u32,
}
struct Audio<'a> {
    samples: Vec<Sample<'a>>,
    scale: u32,
    channels: u32,
    object: u8,
    volume: f64,
    media_ticks: u32,
    movie_ticks: u32,
    skip: u32,
}
impl Audio<'_> {
    fn entry(&self, out: &mut Vec<u8>) {
        atom(out, b"mp4a", |b| {
            words(
                b,
                &[
                    0,
                    1,
                    0,
                    0,
                    (self.channels << 16) | 16,
                    0,
                    self.scale.min(65535) << 16,
                ],
            );
            atom(b, b"esds", |b| {
                words(b, &[0]);
                b.extend_from_slice(&[3, 25, 0, 1, 0, 4, 17, 0x40, 0x15, 0, 0, 0]);
                words(b, &[128000, 128000]);
                b.extend_from_slice(&[5, 2]);
                let frequency = RATES
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, r)| r.abs_diff(self.scale))
                    .unwrap()
                    .0 as u16;
                let asc = (u16::from(self.object) << 11)
                    | (frequency << 7)
                    | (((self.channels & 15) as u16) << 3);
                b.extend_from_slice(&asc.to_be_bytes());
                b.extend_from_slice(&[6, 1, 2]);
            });
        });
    }
    fn trak(&self, b: &mut Vec<u8>, fragmented: bool, offsets: &mut usize) {
        let samples = if fragmented { &[][..] } else { &self.samples };
        atom(b, b"trak", |b| {
            atom(b, b"tkhd", |b| {
                words(
                    b,
                    &[
                        3,
                        0,
                        0,
                        1,
                        0,
                        self.movie_ticks,
                        0,
                        0,
                        0,
                        ((self.volume * 256.).round() as i32 as u32) << 16,
                    ],
                );
                words(b, &MATRIX);
                words(b, &[0, 0]);
            });
            if self.skip != 0 {
                atom(b, b"edts", |b| {
                    atom(b, b"elst", |b| {
                        words(b, &[0, 1, self.movie_ticks, self.skip, 65536])
                    })
                })
            }
            atom(b, b"mdia", |b| {
                atom(b, b"mdhd", |b| {
                    words(
                        b,
                        &[
                            0,
                            0,
                            0,
                            self.scale,
                            if fragmented { 0 } else { self.media_ticks },
                            0x55c40000,
                        ],
                    )
                });
                atom(b, b"hdlr", |b| {
                    words(b, &[0, 0]);
                    b.extend_from_slice(b"soun");
                    words(b, &[0; 3]);
                    b.extend_from_slice(b"SoundHandler\0")
                });
                atom(b, b"minf", |b| {
                    atom(b, b"smhd", |b| words(b, &[0, 0]));
                    atom(b, b"dinf", |b| {
                        atom(b, b"dref", |b| {
                            words(b, &[0, 1]);
                            atom(b, b"url ", |b| words(b, &[1]));
                        })
                    });
                    atom(b, b"stbl", |b| {
                        atom(b, b"stsd", |b| {
                            words(b, &[0, 1]);
                            self.entry(b);
                        });
                        atom(b, b"stts", |b| {
                            let at = b.len() + 4;
                            words(b, &[0, 0]);
                            let mut runs = 0;
                            for group in samples.chunk_by(|a, c| a.duration == c.duration) {
                                words(b, &[group.len() as u32, group[0].duration]);
                                runs += 1u32;
                            }
                            b[at..at + 4].copy_from_slice(&runs.to_be_bytes());
                        });
                        atom(b, b"stsc", |b| {
                            if samples.is_empty() {
                                words(b, &[0, 0])
                            } else {
                                words(b, &[0, 1, 1, 1, 1])
                            }
                        });
                        atom(b, b"stsz", |b| {
                            words(b, &[0, 0, samples.len() as u32]);
                            for s in samples {
                                words(b, &[s.data.len() as u32]);
                            }
                        });
                        atom(b, b"stco", |b| {
                            words(b, &[0, samples.len() as u32]);
                            *offsets = b.len();
                            b.resize(b.len() + samples.len() * 4, 0);
                        });
                    });
                });
            });
        });
    }
}
pub(super) fn adts(
    input: &[u8],
    opts: Options,
    metadata: &BTreeMap<String, String>,
    mov: bool,
    fragmented: bool,
    filters: &[&str],
) -> Result<Vec<u8>, &'static str> {
    let mut frames = Frames::new(input);
    let mut samples = Vec::new();
    for data in frames.by_ref() {
        if samples.len() >= 200_000 || samples.len() >= opts.limit / size_of::<Sample>() {
            return Err("sample index exceeds memory budget");
        }
        samples.push(Sample {
            data,
            duration: 1024,
        });
    }
    let scale = frames.rate;
    let original = samples.len() as u32 * 1024;
    let start = (opts.start * f64::from(scale)).round() as u32;
    let end = opts
        .end
        .map_or(original, |s| (s * f64::from(scale)).round() as u32)
        .min(original);
    let mut base = 0;
    let mut skip = 0;
    samples.retain_mut(|s| {
        let dts = base;
        base += 1024;
        if end <= start || dts >= end || base <= start {
            return false;
        }
        if dts < start {
            skip = start - dts
        }
        s.duration = base.min(end) - dts;
        true
    });
    let mut a = Audio {
        media_ticks: samples.iter().map(|s| s.duration).sum(),
        movie_ticks: end.saturating_sub(start),
        scale,
        channels: frames.channels.into(),
        object: frames.object,
        volume: 1.,
        skip,
        samples,
    };
    if opts.clear_samples && !opts.strip_audio {
        let mut tempo = 1.;
        for f in filters.iter().flat_map(|f| f.split(',')).map(str::trim) {
            if let Some(s) = f.strip_prefix("atempo=") {
                tempo *= s.parse::<f64>().unwrap_or(1.).clamp(0.25, 4.)
            }
            if let Some(s) = f.strip_prefix("volume=") {
                a.volume *= if let Some(db) = s.strip_suffix("dB") {
                    10f64.powf(db.parse::<f64>().unwrap_or(0.) / 20.)
                } else {
                    s.parse::<f64>().ok().filter(|v| *v != 0.).unwrap_or(1.)
                }
            }
        }
        let duration = if a.movie_ticks == 0 {
            1.
        } else {
            f64::from(a.movie_ticks) / f64::from(scale)
        };
        a.scale = opts.rate.unwrap_or(scale);
        a.channels = opts.channels.unwrap_or(a.channels);
        a.object = 2;
        let ticks = (duration.max(0.05) / tempo * f64::from(a.scale))
            .round()
            .max(1.) as u64;
        let n = ticks.div_ceil(1024);
        if n > 200_000 || n > (opts.limit / size_of::<Sample>()) as u64 {
            return Err("sample index exceeds memory budget");
        }
        let data = super::adts::silent(a.channels);
        a.samples = (0..n)
            .map(|i| Sample {
                data,
                duration: (ticks - i * 1024).min(1024) as u32,
            })
            .collect();
        a.media_ticks = ticks as u32;
        if a.skip == 0 {
            a.movie_ticks = (ticks as f64 * f64::from(scale) / f64::from(a.scale)).round() as u32;
        }
    }
    if opts.strip_audio {
        a.samples.clear();
        a.movie_ticks = 0
    }
    let mut out = Vec::new();
    let mut offsets = 0;
    atom(&mut out, b"ftyp", |b| {
        b.extend_from_slice(if mov { b"qt  " } else { b"isom" });
        words(b, &[512]);
        b.extend_from_slice(if mov {
            b"qt  ".as_slice()
        } else {
            b"isomiso2avc1mp41"
        });
    });
    atom(&mut out, b"moov", |b| {
        atom(b, b"mvhd", |b| {
            words(
                b,
                &[
                    0,
                    0,
                    0,
                    scale,
                    if fragmented { 0 } else { a.movie_ticks },
                    65536,
                    0x01000000,
                    0,
                    0,
                ],
            );
            words(b, &MATRIX);
            words(b, &[0; 6]);
            words(b, &[if opts.strip_audio { 1 } else { 2 }]);
        });
        if !opts.strip_audio {
            a.trak(b, fragmented, &mut offsets);
        }
        if fragmented {
            atom(b, b"mvex", |b| {
                if !opts.strip_audio {
                    atom(b, b"trex", |b| {
                        let (duration, size) = a
                            .samples
                            .first()
                            .map_or((1024, 0), |s| (s.duration, s.data.len() as u32));
                        words(b, &[0, 1, 1, duration, size, 0]);
                    })
                }
            })
        }
        tags(b, metadata);
    });
    if fragmented {
        let moof = out.len();
        atom(&mut out, b"moof", |b| {
            atom(b, b"mfhd", |b| words(b, &[0, 1]));
            if !opts.strip_audio {
                atom(b, b"traf", |b| {
                    atom(b, b"tfhd", |b| words(b, &[0x020002, 1, 1]));
                    atom(b, b"tfdt", |b| words(b, &[0x01000000, 0, 0]));
                    atom(b, b"trun", |b| {
                        words(b, &[0x01000f01, a.samples.len() as u32]);
                        offsets = b.len();
                        words(b, &[0]);
                        for s in &a.samples {
                            words(b, &[s.duration, s.data.len() as u32, 0x02000000, 0]);
                        }
                    });
                })
            }
        });
        if !opts.strip_audio {
            let offset = (out.len() - moof + 8) as u32;
            out[offsets..offsets + 4].copy_from_slice(&offset.to_be_bytes());
        }
    }
    let payload: usize = a.samples.iter().map(|s| s.data.len()).sum();
    if payload.saturating_add(out.len()).saturating_add(8) > opts.limit {
        return Err("output byte limit exceeded");
    }
    atom(&mut out, b"mdat", |b| {
        for s in &a.samples {
            if !fragmented {
                let pos = b.len() as u32;
                b[offsets..offsets + 4].copy_from_slice(&pos.to_be_bytes());
                offsets += 4;
            }
            b.extend_from_slice(s.data);
        }
    });
    Ok(out)
}
