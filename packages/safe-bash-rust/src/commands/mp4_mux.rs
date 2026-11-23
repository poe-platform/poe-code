use super::super::adts::{Frames, Options, RATES};
use super::Original;
use super::{
    super::{
        InputTime, MediaInput, gif::Animation,
        ffmpeg_wave::{self, Wave},
        frame_output::{self, ImageSequence},
        png_pixels::Raster,
        y4m,
    },
    h264,
};
use std::borrow::Cow;
use std::collections::BTreeMap;

// Boxes are nested directly in the output. Reserve a size word, then fill it
// once all children have been written; sample offsets are filled at mdat.
pub(in super::super) fn atom(out: &mut Vec<u8>, kind: &[u8; 4], body: impl FnOnce(&mut Vec<u8>)) {
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
fn rotation_matrix(angle: i32) -> [u32; 9] {
    let mut matrix = MATRIX;
    let minus = (-65536i32) as u32;
    match angle.rem_euclid(360) {
        85..=95 => {
            matrix[0] = 0;
            matrix[1] = 65536;
            matrix[3] = minus;
            matrix[4] = 0
        }
        175..=185 => {
            matrix[0] = minus;
            matrix[4] = minus
        }
        265..=275 => {
            matrix[0] = 0;
            matrix[1] = minus;
            matrix[3] = 65536;
            matrix[4] = 0
        }
        _ => {}
    }
    matrix
}
fn tags(out: &mut Vec<u8>, metadata: &BTreeMap<String, String>, chapters: &[u8]) {
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
    if fields.peek().is_none() && chapters.is_empty() {
        return;
    }
    atom(out, b"udta", |b| {
        if !chapters.is_empty() {
            atom(b, b"chpl", |b| b.extend_from_slice(chapters));
        }
        if fields.peek().is_none() {
            return;
        }
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
                    });
                }
            });
        })
    });
}
#[derive(Clone)]
struct Sample<'a> {
    data: Cow<'a, [u8]>,
    duration: u32,
    cts: i64,
    key: bool,
    description: u32,
}
struct Track<'a> {
    id: u32,
    samples: Vec<Sample<'a>>,
    scale: u32,
    media_ticks: u32,
    movie_ticks: u32,
    first_dts: u64,
    fragment_sample_size: Option<u32>,
    stsd: Cow<'a, [u8]>,
    edits: Vec<[u32; 3]>,
    kind: &'static str,
    enabled: bool,
    field_order: Option<&'static str>,
    volume: u32,
    matrix: [u32; 9],
    width: u32,
    height: u32,
    language: u16,
    handler: [u8; 4],
    name: &'a [u8],
}
impl Track<'_> {
    fn merge_pcm_chunks(&mut self, limit: usize, boundaries: &[usize]) -> Result<usize, &'static str> {
        // Native MOV merges contiguous PCM packets only while the
        // combined chunk stays below 1 MiB. Decoding restarts packet
        // grouping at each chunk before applying presentation edits.
        let mut remaining = limit;
        let (mut start, mut chunks) = (0, 0);
        let mut boundaries = boundaries.iter().copied().chain(std::iter::once(self.samples.len())).peekable();
        while start < self.samples.len() {
            while boundaries.peek().is_some_and(|&end| end <= start) { boundaries.next(); }
            let boundary = *boundaries.peek().unwrap();
            let mut end = start + 1;
            let mut size = self.samples[start].data.len();
            while end < boundary && self.samples[end].description == self.samples[start].description && size.saturating_add(self.samples[end].data.len()) < 1 << 20 {
                size += self.samples[end].data.len();
                end += 1;
            }
            if end > start + 1 {
                remaining = remaining.checked_sub(size).ok_or("audio output exceeds memory budget")?;
                let mut data = Vec::new();
                data.try_reserve_exact(size).map_err(|_| "audio output exceeds memory budget")?;
                let mut duration = 0u32;
                for sample in &self.samples[start..end] {
                    data.extend_from_slice(&sample.data);
                    duration = duration.checked_add(sample.duration).ok_or("track duration exceeds limit")?;
                }
                self.samples[start].data = data.into();
                self.samples[start].duration = duration;
            }
            self.samples.swap(chunks, start);
            chunks += 1;
            start = end;
        }
        self.samples.truncate(chunks);
        Ok(limit - remaining)
    }

    fn audio_format(&self, default_rate: u32) -> (u32, u32) {
        use super::{atoms, audio_entry_format, esds, u16_at, u32_at};
        let mut rate = default_rate;
        let mut ch = 2;
        if let Some((tag, entry)) = atoms(self.stsd.get(8..).unwrap_or_default()).next()
            && audio_entry_format(tag)
            && entry.len() >= 28
        {
            rate = ((u64::from(u32_at(entry, 24)) + 32768) >> 16) as u32;
            ch = u32::from(u16_at(entry, 16));
            let start = match u16_at(entry, 8) {
                1 => 44,
                2 => 64,
                _ => 28,
            };
            for (tag, b) in atoms(entry.get(start..).unwrap_or_default()) {
                match tag {
                    b"esds" | b"wave" => {
                        let payload = if tag == b"wave" {
                            let Some((_, v)) = atoms(b).find(|(k, _)| *k == b"esds") else {
                                continue;
                            };
                            v
                        } else {
                            b
                        };
                        let cfg = esds(payload);
                        if cfg.rate != 0 {
                            rate = cfg.rate;
                        }
                        if cfg.channels != 0 {
                            ch = cfg.channels.into();
                        }
                    }
                    b"dOps" => {
                        rate = match u32_at(b, 4) {
                            0 => 48000,
                            n => n,
                        };
                        if let Some(&channels) = b.get(1).filter(|&&n| n != 0) {
                            ch = channels.into();
                        }
                    }
                    _ => (),
                }
            }
        }
        (rate, ch)
    }
}
fn pcm_entry(format: super::super::ffmpeg_pcm::Format, rate: u32, channels: u32, order: &[u16], mov: bool) -> Result<Vec<u8>, &'static str> {
    use super::super::ffmpeg_pcm::Format;
    if !mov {
        if channels > 1 && order.iter().any(|&speaker| !matches!(speaker, 0..=17 | 31..=42)) {
            return Err("Unsupported PCM channel layout in MP4");
        }
        let (tag, bits, big) = match format {
            Format::Signed(bits @ (16 | 24 | 32), big) => (b"ipcm", bits, big),
            Format::Float(bits @ (32 | 64), big) => (b"fpcm", bits, big),
            _ => return Err("PCM codec is not supported in MP4"),
        };
        let mut entry = Vec::new();
        words(&mut entry, &[u32::from(rate > 65535) << 24, 1]);
        atom(&mut entry, tag, |b| {
            let mut header_rate = rate;
            while header_rate > 65535 { header_rate >>= 1; }
            words(b, &[0, 1, u32::from(rate > 65535) << 16, 0, channels << 16 | 16, 0, header_rate << 16]);
            if rate > 65535 { atom(b, b"srat", |b| words(b, &[0, rate])); }
            if channels > 1 && !order.is_empty() {
                atom(b, b"chnl", |b| {
                    words(b, &[0]);b.extend_from_slice(&[1, 0]);
                    for &speaker in order {
                        b.push(match speaker {
                            0..=3 => speaker as u8, 4..=5 => speaker as u8 + 4, 6..=7 => speaker as u8,
                            8 => 10, 9..=10 => speaker as u8 - 5, 11 => 25, 12 => 17, 13 => 19, 14 => 18,
                            15 => 20, 16 => 22, 17 => 21, 31 => 15, 32 => 16, 33 => 11, 34 => 12,
                            35 => 26, 36 => 23, 37 => 24, 38 => 29, 39 => 27, 40 => 28, 41 => 13, 42 => 14,
                            _ => 127,
                        });
                    }
                });
            }
            atom(b, b"pcmC", |b| { words(b, &[0]);b.extend_from_slice(&[u8::from(!big), bits as u8]); });
        });
        return Ok(entry);
    }
    let (tag,big,flags)=match format {
        Format::Signed(8,_) => (b"sowt",false,12),
        Format::Unsigned(8,_) => (b"raw ",false,8),
        Format::Signed(16,big) => (if big {b"twos"}else{b"sowt"},big,12),
        Format::Signed(24,big) => (b"in24",big,12),
        Format::Signed(32,big) => (b"in32",big,12),
        Format::Float(32,big) => (b"fl32",big,9),
        Format::Float(64,big) => (b"fl64",big,9),
        Format::Alaw => (b"alaw",false,0),
        Format::Mulaw => (b"ulaw",false,0),
        _ => return Err("PCM codec is not supported in MOV"),
    };
    let bits=u32::from(format.bits());
    let version=if rate>65535 {2} else if bits>16 {1}else{0};
    let wide=version==2 && flags!=0;
    let mut entry=Vec::new();words(&mut entry,&[0,1]);
    atom(&mut entry,if wide {b"lpcm"}else{tag},|b| {
        words(b,&[0,1,version<<16,0,
            if version==2 {3<<16|16}else{channels<<16|if version==1||flags==0 {16}else{bits}},
            if version==2 {0xfffe0000}else{0},if version==2 {1<<16}else{rate<<16}]);
        if version==2 {
            words(b,&[72]);b.extend_from_slice(&f64::from(rate).to_be_bytes());
            words(b,&[channels,0x7f000000,bits,flags|if big{2}else{0},channels*(bits/8),1]);
        }else if version==1 {
            words(b,&[1,bits/8,channels*(bits/8),2]);
            atom(b,b"wave",|b| {
                atom(b,b"frma",|b|b.extend_from_slice(tag));
                atom(b,b"enda",|b|b.extend_from_slice(&u16::from(!big).to_be_bytes()));
                atom(b,&[0;4],|_|{});
            });
        }
        if order.iter().any(|&speaker| !matches!(speaker, 0..=17 | 29..=32 | 35)) { return; }
        atom(b,b"chan",|b| {
            let mask = super::super::audio_remix::order_mask(order);
            if mask != 0 && mask < 0x40000 { words(b,&[0,1<<16,mask,0]); }
            else if order.is_empty() { words(b,&[0,0xffff0000 | channels,0,0]); }
            else {
                words(b,&[0,0,0,channels]);
                for &speaker in order {
                    let label = match speaker { 0..=17 => u32::from(speaker)+1, 31 => 35, 32 => 36, 35 => 37, 29 => 38, 30 => 39, _ => 0 };
                    words(b,&[label,0,0,0,0]);
                }
            }
        });
    });
    Ok(entry)
}

fn audio_specific_config(scale: u32, channels: u32, object: u8) -> [u8; 2] {
    let frequency = RATES
        .iter()
        .enumerate()
        .min_by_key(|(_, r)| r.abs_diff(scale))
        .unwrap()
        .0 as u16;
    let asc =
        (u16::from(object) << 11) | (frequency << 7) | (((channels & 15) as u16) << 3);
    asc.to_be_bytes()
}
fn audio_entry(scale: u32, channels: u32, object: u8) -> Vec<u8> {
    audio_sample_entry(
        b"mp4a",
        scale,
        channels,
        16,
        &audio_specific_config(scale, channels, object),
    )
}
fn audio_sample_entry(tag: &[u8; 4], scale: u32, channels: u32, bits: u32, asc: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    words(&mut out, &[0, 1]);
    atom(&mut out, tag, |b| {
        words(
            b,
            &[
                0,
                1,
                0,
                0,
                (channels << 16) | bits,
                0,
                scale.min(65535) << 16,
            ],
        );
        if matches!(tag,b"samr"|b"sawb") {
            atom(b,b"damr",|b|b.extend_from_slice(&[0,0,0,0,0,0x81,0xff,0,1]));
        } else if tag==b"ac-3" {
            atom(b,b"dac3",|b|b.extend_from_slice(asc));
        }
        if tag != b"mp4a" {
            return;
        }
        let len = asc.len() as u8;
        atom(b, b"esds", |b| {
            words(b, &[0]);
            b.extend_from_slice(&[
                3,
                len.wrapping_add(23),
                0,
                1,
                0,
                4,
                len.wrapping_add(15),
                0x40,
                0x15,
                0,
                0,
                0,
            ]);
            words(b, &[128000, 128000]);
            b.extend_from_slice(&[5, len]);
            b.extend_from_slice(asc);
            b.extend_from_slice(&[6, 1, 2]);
        });
    });
    out
}

impl Track<'_> {
    fn pcm_stride(&self) -> Option<usize> {
        super::atoms(self.stsd.get(8..).unwrap_or_default()).next().and_then(|(tag,entry)| {
            if self.kind!="audio" {return None;}
            let wide=super::u16_at(entry,8)==2;
            let rate = if wide { f64::from_bits(super::wide(entry,32,true)) as u32 }
                else { let rate = super::u32_at(super::child(entry.get(28..).unwrap_or_default(),b"srat"),4); if rate != 0 {rate} else {super::u32_at(entry,24) >> 16} };
            // Internal staging can keep a container's millisecond clock. Its
            // packet table must not reinterpret those ticks as PCM samples.
            if self.scale != rate { return None; }
            let bits=match tag {
                b"sowt"|b"twos"|b"raw " => u32::from(super::u16_at(entry,18)),
                b"in24" => 24,b"in32"|b"fl32" => 32,b"fl64" => 64,
                b"ulaw"|b"alaw" => 8,b"lpcm" if wide => super::u32_at(entry,48),
                b"ipcm"|b"fpcm" => u32::from(*super::child(entry.get(28..).unwrap_or_default(),b"pcmC").get(5)?),_=>return None,
            };
            let channels=if wide {super::u32_at(entry,40)}else{u32::from(super::u16_at(entry,16))};
            channels.checked_mul(bits/8).filter(|&n|n>0).map(|n|n as usize)
        })
    }

    fn trak(&self, b: &mut Vec<u8>, fragmented: bool, offsets: &mut usize, chapter_id: Option<u32>) {
        let samples = if fragmented { &[][..] } else { &self.samples };
        let pcm_stride = self.pcm_stride();
        atom(b, b"trak", |b| {
            atom(b, b"tkhd", |b| {
                words(
                    b,
                    &[
                        if self.enabled { 3 } else { 0 },
                        0,
                        0,
                        self.id,
                        0,
                        self.movie_ticks,
                        0,
                        0,
                        0,
                        self.volume << 16,
                    ],
                );
                words(b, &self.matrix);
                words(b, &[self.width << 16, self.height << 16]);
            });
            if let Some(id) = chapter_id && id != self.id {
                atom(b, b"tref", |b| atom(b, b"chap", |b| words(b, &[id])));
            }
            if !self.edits.is_empty() {
                atom(b, b"edts", |b| {
                    atom(b, b"elst", |b| {
                        words(b, &[0, self.edits.len() as u32]);
                        for row in &self.edits {
                            words(b, row)
                        }
                    });
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
                            u32::from(self.language) << 16,
                        ],
                    )
                });
                atom(b, b"hdlr", |b| {
                    words(b, &[0, 0]);
                    b.extend_from_slice(&self.handler);
                    words(b, &[0; 3]);
                    b.extend_from_slice(self.name);
                    b.push(0);
                });
                atom(b, b"minf", |b| {
                    match self.kind {
                        "video" => atom(b, b"vmhd", |b| words(b, &[1, 0, 0])),
                        "audio" => atom(b, b"smhd", |b| words(b, &[0, 0])),
                        _ => atom(b, b"nmhd", |b| words(b, &[0])),
                    };
                    atom(b, b"dinf", |b| {
                        atom(b, b"dref", |b| {
                            words(b, &[0, 1]);
                            atom(b, b"url ", |b| words(b, &[1]));
                        })
                    });
                    atom(b, b"stbl", |b| {
                        atom(b, b"stsd", |b| {
                            b.extend_from_slice(&self.stsd);
                        });
                        atom(b, b"stts", |b| {
                            if let Some(stride)=pcm_stride {
                                let count=samples.iter().map(|s|s.data.len()/stride).sum::<usize>();
                                words(b,&[0,u32::from(count>0)]);
                                if count>0 {words(b,&[count as u32,1]);}
                                return;
                            }
                            let at = b.len() + 4;
                            words(b, &[0, 0]);
                            let mut runs = 0;
                            for group in samples.chunk_by(|a, c| a.duration == c.duration) {
                                words(b, &[group.len() as u32, group[0].duration]);
                                runs += 1u32;
                            }
                            b[at..at + 4].copy_from_slice(&runs.to_be_bytes());
                        });
                        if samples.iter().any(|s| s.cts != 0) {
                            atom(b, b"ctts", |b| {
                                let at = b.len() + 4;
                                let mut count = 0u32;
                                let runs = samples.chunk_by(|a, b| a.cts == b.cts);
                                words(b, &[u32::from(samples.iter().any(|s| s.cts < 0)) << 24, 0]);
                                for g in runs {
                                    count += 1;
                                    words(b, &[g.len() as u32, g[0].cts as u32]);
                                }
                                b[at..at + 4].copy_from_slice(&count.to_be_bytes());
                            });
                        }
                        atom(b, b"stsc", |b| {
                            let at = b.len() + 4;
                            let mut count = 0u32;
                            let runs = samples.chunk_by(|a, b| a.description == b.description && pcm_stride.is_none_or(|stride|a.data.len()/stride==b.data.len()/stride));
                            words(b, &[0, 0]);
                            let mut chunk = 1;
                            for g in runs {
                                count += 1;
                                words(b, &[chunk, pcm_stride.map_or(1,|stride|(g[0].data.len()/stride) as u32), g[0].description]);
                                chunk += g.len() as u32;
                            }
                            b[at..at + 4].copy_from_slice(&count.to_be_bytes());
                        });
                        atom(b, b"stsz", |b| {
                            if let Some(stride)=pcm_stride {
                                words(b,&[0,stride as u32,samples.iter().map(|s|s.data.len()/stride).sum::<usize>() as u32]);
                                return;
                            }
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
                        if self.kind == "video" && !samples.is_empty() {
                            atom(b, b"stss", |b| {
                                words(b, &[0, samples.iter().filter(|s| s.key).count() as u32]);
                                for (i, _) in samples.iter().enumerate().filter(|(_, s)| s.key) {
                                    words(b, &[i as u32 + 1]);
                                }
                            });
                        }
                    });
                });
            });
        });
    }
}
enum VideoCodec<'a> {
    Avc(u32),
    Config(&'a [u8]),
    Still(&'static [u8; 4]),
}

fn video_entry(w: usize, h: usize, codec: VideoCodec<'_>) -> Result<Vec<u8>, &'static str> {
    if w > u16::MAX as usize || h > u16::MAX as usize {
        return Err("invalid AVC sample dimensions");
    }
    let (tag, config) = match codec {
        VideoCodec::Avc(fps) => (b"avc1", Some(Cow::Owned(h264::configuration(w as i64, h as u32, fps)?))),
        VideoCodec::Config(config) => (b"avc1", Some(Cow::Borrowed(config))),
        VideoCodec::Still(tag) => (tag, None),
    };
    let mut stsd = Vec::new();
    words(&mut stsd, &[0, 1]);
    atom(&mut stsd, tag, |b| {
        words(
            b,
            &[
                0,
                1,
                0,
                0,
                0,
                0,
                (w as u32) << 16 | h as u32,
                0x00480000,
                0x00480000,
                0,
            ],
        );
        b.extend_from_slice(&1u16.to_be_bytes());
        b.extend_from_slice(&[0; 32]);
        words(b, &[0x0018ffff]);
        if let Some(config) = config {
            atom(b, b"avcC", |b| b.extend_from_slice(&config));
        }
    });
    Ok(stsd)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum VideoEncoding { Mp4, Fragmented, PreserveConfig, Matroska }

impl Remux<'_> {
    fn video_encoding(&self) -> VideoEncoding {
        if matches!(self.format,"flv"|"avi"|"mpegts") { VideoEncoding::PreserveConfig } else if matches!(self.format,"mkv"|"webm") { VideoEncoding::Matroska } else if self.fragmented || matches!(self.format, "dash" | "hls") { VideoEncoding::Fragmented } else { VideoEncoding::Mp4 }
    }
}

fn encode_video(
    track: &mut Track<'_>,
    movie_scale: u32,
    times: impl Iterator<Item = (f64, f64)>,
    opts: y4m::Options<'_>,
    encoding: VideoEncoding,
    image: impl FnMut(usize) -> Result<Raster, &'static str>,
) -> Result<(), String> {
    let limit = opts.limit;
    let mut samples: Vec<Sample> = Vec::new();
    let mut last_dts = 0;
    track.first_dts = 0;
    let mut previous = Vec::new();
    let mut ticks = 0u64;
    let mut used = 0usize;
    y4m::render_frames(
        track.width as usize,
        track.height as usize,
        f64::from(track.scale),
        times,
        opts,
        image,
        |mut im, frame| {
            let duration = frame.duration;
            if samples.is_empty() {
                track.width = im.width as u32;
                track.height = im.height as u32;
                if encoding != VideoEncoding::PreserveConfig {
                    track.stsd = video_entry(
                        im.width,
                        im.height,
                        VideoCodec::Avc(if encoding == VideoEncoding::Matroska {30} else {(1. / duration).round().max(1.) as u32}),
                    )?
                    .into();
                }
            }
            im.width = track.width as usize;
            im.height = track.height as usize;
            im.pixels.resize(im.width * im.height, [0; 4]);
            let blocks = h264::macroblocks(im, limit)?;
            let data = h264::encode_slice(
                &blocks,
                &previous,
                samples.len(),
                limit.saturating_sub(used),
            )?;
            if matches!(encoding, VideoEncoding::Mp4|VideoEncoding::Fragmented) { previous = blocks; }
            used = used.saturating_add(data.len() + size_of::<Sample>());
            if used > limit {
                return Err("output byte limit exceeded");
            }
            let duration = (duration * f64::from(track.scale)).round().max(1.) as u32;
            if matches!(encoding, VideoEncoding::PreserveConfig|VideoEncoding::Matroska) {
                let dts = (frame.pts * f64::from(track.scale)).round() as u64;
                if let Some(prior) = samples.last_mut() {
                    prior.duration = dts.saturating_sub(last_dts) as u32;
                } else { track.first_dts = dts; }
                last_dts = dts;
            }
            ticks += u64::from(duration);
            let key = data.get(4).is_some_and(|n| n & 31 == 5);
            samples.push(Sample {
                data: data.into(),
                duration,
                cts: 0,
                key,
                description: 1,
            });
            Ok(())
        },
    )?;
    if !samples.is_empty() {
        track.media_ticks = ticks as u32;
        // Fragmented headers retain the track duration before encoding. Packet
        // durations in trun describe the filtered frames independently.
        if encoding != VideoEncoding::Fragmented && track.edits.is_empty() {
            track.movie_ticks =
                (ticks as f64 * f64::from(movie_scale) / f64::from(track.scale)).round() as u32;
        }
    }
    track.samples = samples;
    Ok(())
}

fn video_track<'a>(
    w: usize,
    h: usize,
    codec: VideoCodec<'_>,
    timescale: u32,
    ticks: u64,
    movie_scale: u32,
) -> Result<Track<'a>, &'static str> {
    Ok(Track {
        id: 1,
        samples: vec![],
        scale: timescale,
        media_ticks: ticks as u32,
        movie_ticks: (ticks as f64 / f64::from(timescale) * f64::from(movie_scale)).round() as u32,
        first_dts: 0,
        fragment_sample_size: None,
        stsd: video_entry(w, h, codec)?.into(),
        edits: vec![],
        kind: "video",
        enabled: true, field_order: None,
        volume: 0,
        matrix: MATRIX,
        width: w as u32,
        height: h as u32,
        language: 0x55c4,
        handler: *b"vide",
        name: b"VideoHandler",
    })
}

fn still_track<'a>(
    input: &'a [u8],
    seek: InputTime,
    range: Option<(f64, Option<f64>)>,
    opts: &Remux<'_>,
    scale: u32,
    limit: usize,
) -> Result<Track<'a>, String> {
    let (w, h, tag) = frame_output::still_info(input, limit)?;
    let (start, end) = (seek.start.unwrap_or(0.).max(0.), seek.end().unwrap_or(0.04));
    let mut visible = start < 0.04 && end > 0.;
    let mut packet = frame_output::still_sample(start, end);
    // A sub-tick input cut can retain pixels after dropping the image packet.
    // A subsequent cut materializes those pixels as AVC before slicing.
    let materialized = visible && !packet && range.is_some();
    if let Some((start, end)) = range {
        let end = end.unwrap_or(0.04);
        visible &= packet && start < 0.04 && end > 0.;
        packet &= frame_output::still_sample(start, end);
    }
    let mut track = video_track(
        w,
        h,
        if materialized {
            VideoCodec::Avc(25)
        } else {
            VideoCodec::Still(tag)
        },
        25,
        u64::from(packet),
        scale,
    )?;
    if packet && opts.video_filters.is_empty() {
        track.samples.push(Sample {
            data: Cow::Borrowed(input),
            duration: 1,
            cts: 0,
            key: true,
            description: 1,
        });
    } else if visible {
        let im = frame_output::decode_still(input, limit)?;
        encode_video(
            &mut track,
            scale,
            std::iter::once((0., 0.04)),
            y4m::Options {
                filters: opts.video_filters,
                frames: opts.frames,
                start: 0.,
                end: None,
                no_video: false,
                limit,
            },
            opts.video_encoding(),
            |_| Ok(im.clone()),
        )?;
    }
    Ok(track)
}

fn raw_video_track(
    clip: &y4m::Clip<'_>,
    opts: &Remux<'_>,
    range: Option<(f64, Option<f64>)>,
    movie_scale: u32,
    limit: usize,
) -> Result<Track<'static>, String> {
    let scale = 90000.;
    let (start, end) = range.unwrap_or((0., None));
    let origin = clip.origin;
    let from = origin.saturating_add((start * scale).round() as u64);
    let until = if range.is_some() {
        origin.saturating_add(
            (end.unwrap_or(clip.seconds()).min(clip.seconds()) * scale).round() as u64,
        )
    } else {
        clip.media_ticks()
    };
    let mut track = video_track(
        clip.width,
        clip.height,
        VideoCodec::Still(b"raw "),
        90000,
        0,
        movie_scale,
    )?;
    let mut packets = Vec::new();
    let mut dts = 0u64;
    let mut skip = 0;
    let mut ticks = 0u64;
    for (data, duration) in clip.packets() {
        let base = dts;
        dts += u64::from(duration);
        if range.is_some() && (until <= from || base >= until || dts <= from) {
            continue;
        }
        if packets.len() >= limit / size_of::<Sample>() {
            return Err("sample index exceeds memory budget".into());
        }
        if packets.is_empty() {
            skip = from.saturating_sub(base);
        }
        let duration = (dts.min(until) - base) as u32;
        packets.push((data, duration));
        ticks += u64::from(duration);
    }
    track.media_ticks = ticks as u32;
    track.movie_ticks =
        ((ticks.saturating_sub(skip) as f64) / scale * f64::from(movie_scale)).round() as u32;
    if skip > 0 {
        // An existing input edit is still in the original 1000 Hz movie clock.
        if range.is_none() {
            track.movie_ticks = (clip.seconds() * 1000.).round() as u32;
        }
        track.edits.push([track.movie_ticks, skip as u32, 65536]);
    }
    let visible = clip
        .times()
        .filter(|&(pts, dur)| range.is_none() || pts + dur > start && end.is_none_or(|v| pts < v))
        .count();
    if !opts.video_filters.is_empty()
        || opts.frames.is_some_and(|n| visible > n as usize)
        || packets.is_empty() && visible > 0
    {
        encode_video(
            &mut track,
            movie_scale,
            clip.times(),
            y4m::Options {
                start,
                end,
                frames: opts.frames,
                filters: opts.video_filters,
                no_video: false,
                limit,
            },
            opts.video_encoding(),
            |i| Ok(clip.image(i)),
        )?;
    } else {
        if let Some(n) = opts.frames {
            packets.truncate(n as usize);
        }
        let cost = clip
            .width
            .saturating_mul(clip.height)
            .saturating_mul(4)
            .saturating_add(size_of::<Sample>());
        if packets.len() > limit / cost {
            return Err("output byte limit exceeded".into());
        }
        if range.is_none() {
            track.fragment_sample_size = clip.packet_size;
        }
        track.samples = packets
            .into_iter()
            .map(|(data, duration)| Sample {
                data: clip.raster(data).pixels.into_flattened().into(),
                duration,
                cts: 0,
                key: true,
                description: 1,
            })
            .collect();
    }
    Ok(track)
}

fn gif_track<'a>(
    input: &'a [u8],
    g: &Animation,
    opts: &Remux<'_>,
    range: Option<(f64, Option<f64>)>,
    scale: u32,
    limit: usize,
) -> Result<Track<'a>, String> {
    let (start, end) = range.unwrap_or((0., None));
    let ts = g.timescale();
    let mult = u64::from(ts / 100);
    let from = g.origin * mult + (start * f64::from(ts)).round() as u64;
    let until = if range.is_some() {
        g.origin * mult
            + (end.unwrap_or(g.seconds()).min(g.seconds()) * f64::from(ts)).round() as u64
    } else {
        g.ticks() * mult
    };
    let mut t = video_track(g.width, g.height, VideoCodec::Still(b"gif "), ts, 0, scale)?;
    let mut base = 0;
    let mut ticks = 0;
    for (k, pts, delay) in g.packets() {
        let pts = pts * mult;
        if range.is_some() && (until <= from || pts >= until) {
            break;
        }
        if k == 0 && pts <= from {
            base = pts;
            t.samples.clear();
            ticks = 0;
        }
        if t.samples.len() >= limit / size_of::<Sample>() {
            return Err("sample index exceeds memory budget".into());
        }
        let offset = if k == 0 { 0 } else { g.frames[k - 1].end };
        let delay = (u64::from(delay) * mult).min(until - pts) as u32;
        ticks += u64::from(delay);
        t.samples.push(Sample {
            data: input[offset..g.frames[k].end].into(),
            duration: delay,
            cts: 0,
            key: k == 0,
            description: 1,
        });
    }
    let skip = from.saturating_sub(base).min(ticks);
    t.media_ticks = u32::try_from(ticks).map_err(|_| "track duration exceeds limit")?;
    t.movie_ticks = ((ticks - skip) as f64 / f64::from(ts) * f64::from(scale)).round() as u32;
    if skip > 0 {
        t.edits.push([t.movie_ticks, skip as u32, 65536]);
    }
    let visible = g
        .times()
        .filter(|&(pts, d)| range.is_none() || pts + d > start && end.is_none_or(|v| pts < v))
        .count();
    if !opts.video_filters.is_empty()
        || opts.frames.is_some_and(|n| visible > n as usize)
        || t.samples.is_empty() && visible > 0
    {
        encode_video(
            &mut t,
            scale,
            g.times(),
            y4m::Options {
                filters: opts.video_filters,
                frames: opts.frames,
                start,
                end,
                no_video: false,
                limit,
            },
            opts.video_encoding(),
            |i| Ok(g.image(i)),
        )?;
    }
    Ok(t)
}

fn sequence_track(
    seq: &ImageSequence,
    scale: u32,
    filters: &[String],
    frames: Option<u32>,
    encoding: VideoEncoding,
    limit: usize,
) -> Result<Track<'static>, String> {
    let first = &seq.frames[0];
    let mut track = video_track(
        first.width,
        first.height,
        VideoCodec::Avc(seq.fps.round().max(1.) as u32),
        90000,
        (90000. / seq.fps).round().max(1.) as u64,
        scale,
    )?;
    encode_video(
        &mut track,
        scale,
        (0..seq.frames.len()).map(|i| (i as f64 / seq.fps, 1. / seq.fps)),
        y4m::Options {
            filters,
            frames,
            start: 0.,
            end: None,
            no_video: false,
            limit,
        },
        encoding,
        |i| Ok(seq.frames[i].clone()),
    )?;
    if track.samples.is_empty() {
        return Err("Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer".into());
    }
    Ok(track)
}

fn generated_video(
    video: &super::super::lavfi::Video,
    movie_scale: u32,
    filters: &[String],
    frames: Option<u32>,
    encoding: VideoEncoding,
    limit: usize,
) -> Result<Track<'static>, String> {
    let (w, h) = (video.width as usize, video.height as usize);
    let count = (video.duration * video.fps).round().max(1.) as usize;
    if count > 200_000 || count > limit / size_of::<Sample>() {
        return Err("frame index exceeds memory budget".into());
    }
    let ticks = (count as f64 / video.fps * 90000.).round() as u64;
    let mut track = video_track(
        w,
        h,
        VideoCodec::Avc(video.fps.round().max(1.) as u32),
        90000,
        ticks,
        movie_scale,
    )?;
    encode_video(
        &mut track,
        movie_scale,
        (0..count).map(|i| (i as f64 / video.fps, 1. / video.fps)),
        y4m::Options {
            filters,
            frames,
            start: 0.,
            end: None,
            no_video: false,
            limit,
        },
        encoding,
        |i| Ok(video.image(i)),
    )?;
    Ok(track)
}

struct GeneratedAudio {
    rate: u32,
    channels: u32,
    ticks: u64,
    decoded_ticks: u64,
    decoded_per_copy: u64,
    period: Option<u64>,
    duration_ticks: u64,
    origin: u64,
}
impl GeneratedAudio {
    fn track(
        &self,
        opts: &Options,
        movie_scale: u32,
        available: usize,
    ) -> Result<Track<'static>, String> {
        let (rate, channels) = (self.rate, self.channels);
        let rate_f = f64::from(rate);
        let start = (opts.start * rate_f).round() as u64;
        let end = opts.end.map_or(self.ticks, |e| (e * rate_f).round() as u64);
        let total = if (opts.start > 0. || opts.end.is_some()) && opts.clear_samples {
            self.decoded_ticks
        } else {
            self.ticks
        };
        let end = end.min(total);
        let ticks = end.saturating_sub(start);
        let payload = super::super::adts::silent(channels);
        let mut samples = Vec::new();
        let mut at = start;
        while at < end {
            if samples.len() >= (available / size_of::<Sample>()).min(200_000) {
                return Err("sample index exceeds memory budget".into());
            }
            let pos = self.period.map_or(at, |n| at % n);
            let packet = 1024 - (self.origin % 1024 + pos % 1024) % 1024;
            let duration = packet
                .min(end - at)
                .min(self.period.map_or(u64::MAX, |n| n - pos));
            samples.push(Sample {
                data: payload.into(),
                duration: duration as u32,
                cts: 0,
                key: true,
                description: 1,
            });
            at += duration;
        }
        Ok(Track {
            id: 1,
            samples,
            scale: rate,
            media_ticks: ticks as u32,
            movie_ticks: (ticks as f64 / rate_f * f64::from(movie_scale)).round() as u32,
            first_dts: 0,
            fragment_sample_size: None,
            stsd: audio_entry(rate, channels, 2).into(),
            edits: vec![],
            kind: "audio",
            enabled: true, field_order: None,
            volume: 256,
            matrix: MATRIX,
            width: 0,
            height: 0,
            language: 0x55c4,
            handler: *b"soun",
            name: b"SoundHandler",
        })
    }
}

// A WAV packet carries up to 1024 PCM frames. Trimming changes its duration,
// but the muxer keeps the entire payload, including a partial first or last packet.
struct WaveStream<'a> {
    wav: Wave<'a>,
    start: u64,
    length: u64,
    ticks: u64,
}
impl<'a> WaveStream<'a> {
    fn read(wav: Wave<'a>, seek: InputTime) -> Result<Self, &'static str> {
        let frames = if matches!(wav.tag,2|17|32) {super::super::adpcm_wav::frames(wav)? as u64}else{(wav.data.len() / wav.stride()) as u64};
        let clock = |s: f64| (s * f64::from(wav.rate)).round() as u64;
        let start = seek.start.map_or(0, clock).min(frames);
        let length = seek
            .end()
            .map_or(frames, clock)
            .min(frames)
            .saturating_sub(start);
        let ticks = length
            .checked_mul((seek.loops as u64).saturating_add(1))
            .filter(|&n| n <= u64::from(u32::MAX))
            .ok_or("audio duration exceeds limit")?;
        Ok(Self {
            wav,
            start,
            length,
            ticks,
        })
    }

    fn track(
        &self,
        seek: InputTime,
        opts: &Options,
        start: Option<f64>,
        movie_scale: u32,
        limit: usize,
    ) -> Result<Track<'a>, &'static str> {
        let w = &self.wav;
        if matches!(w.tag,2|17|32) {return Err("ADPCM copying to this container is not supported");}
        let clock = |s: f64| (s * f64::from(w.rate)).round() as i128;
        let from = clock(opts.start);
        let end = opts.end.map(clock);
        let input_end = seek.end().map(|time| clock(time - seek.start.unwrap_or(0.)));
        let stride = w.stride();
        let mut samples: Vec<Sample> = Vec::new();
        let (mut first_pts, mut previous, mut last_end) = (None, None, 0i128);
        for packet in w.input_packets(seek, limit.saturating_mul(8)) {
            let (range, pts) = packet?;
            if input_end.is_some_and(|end| pts >= end) || end.is_some_and(|end| pts >= end) { break; }
            if first_pts.is_none() && start.is_some() && pts < from { continue; }
            if samples.len() >= (limit / size_of::<Sample>()).min(200_000) { return Err("sample index exceeds memory budget"); }
            let dts = previous.map_or(pts - from, |last: i128| (pts - from).max(last + 1));
            first_pts.get_or_insert(dts);
            if let Some(last) = samples.last_mut() {
                last.duration = u32::try_from(dts - previous.unwrap()).map_err(|_| "audio duration exceeds limit")?;
            }
            let duration = range.len() / stride;
            samples.try_reserve_exact(1).map_err(|_| "sample index exceeds memory budget")?;
            samples.push(Sample { data: w.data[range].into(), duration: duration as u32, cts: 0, key: true, description: 1 });
            previous = Some(dts);
            last_end = dts + duration as i128;
        }
        let first_pts = first_pts.unwrap_or(0);
        let media_ticks = u32::try_from(last_end - first_pts).map_err(|_| "audio duration exceeds limit")?;
        let movie_ticks = (last_end as f64 * f64::from(movie_scale) / f64::from(w.rate)).round() as u32;
        let mut edits = Vec::new();
        let delay = (first_pts as f64 * f64::from(movie_scale) / f64::from(w.rate)).round() as u32;
        if delay > 0 { edits.push([delay, u32::MAX, 65536]); }
        if delay > 0 || samples.iter().map(|p| p.data.len() / stride).sum::<usize>() != media_ticks as usize {
            edits.push([movie_ticks.saturating_sub(delay), 0, 65536]);
        }
        let stsd = if samples.is_empty() {
            audio_entry(w.rate, w.channels as u32, 2)
        } else {
            let mut entry = Vec::new();
            words(&mut entry, &[0, 1]);
            let [lo, hi] = w.tag.to_le_bytes();
            atom(&mut entry, &[lo, hi, 0, 0], |b| {
                words(
                    b,
                    &[
                        0,
                        1,
                        0,
                        0,
                        ((w.channels as u32) << 16) | u32::from(w.bits),
                        0,
                        w.rate.min(65535) << 16,
                    ],
                )
            });
            entry
        };
        Ok(Track {
            id: 1,
            samples,
            scale: w.rate,
            media_ticks,
            movie_ticks,
            first_dts: 0,
            fragment_sample_size: None,
            stsd: stsd.into(),
            edits,
            kind: "audio",
            enabled: true, field_order: None,
            volume: 256,
            matrix: MATRIX,
            width: 0,
            height: 0,
            language: 0x55c4,
            handler: *b"soun",
            name: b"SoundHandler",
        })
    }
}

fn adts_track<'a>(
    input: &'a [u8],
    opts: &Options,
    movie_scale: u32,
    index_bytes: &mut usize,
) -> Result<Track<'a>, &'static str> {
    let mut frames = Frames::new(input);
    let available = opts.limit.saturating_sub(*index_bytes) / size_of::<Sample>();
    let mut samples = Vec::new();
    for data in frames.by_ref() {
        if samples.len() >= 200_000 || samples.len() >= available {
            return Err("sample index exceeds memory budget");
        }
        samples.push(Sample {
            data: data.into(),
            duration: 1024,
            cts: 0,
            key: true,
            description: 1,
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
    let media_ticks = samples.iter().map(|s| s.duration).sum();
    let movie_ticks = end.saturating_sub(start);
    *index_bytes += samples.capacity() * size_of::<Sample>();
    let movie_ticks =
        (f64::from(movie_ticks) * f64::from(movie_scale) / f64::from(scale)).round() as u32;
    Ok(Track {
        id: 1,
        samples,
        scale,
        media_ticks,
        movie_ticks,
        first_dts: 0,
        fragment_sample_size: None,
        stsd: audio_entry(scale, frames.channels.into(), frames.object).into(),
        edits: if skip != 0 {
            vec![[movie_ticks, skip, 65536]]
        } else {
            vec![]
        },
        kind: "audio",
        enabled: true, field_order: None,
        volume: 256,
        matrix: MATRIX,
        width: 0,
        height: 0,
        language: 0x55c4,
        handler: *b"soun",
        name: b"SoundHandler",
    })
}

fn chapter_track(chapters: &[super::super::ffmpeg_input::Chapter], id: u32, movie_scale: u32, limit: usize) -> Result<Track<'static>, String> {
    let scale = 1000;
    let mut stsd = Vec::new();
    words(&mut stsd, &[0, 1]);
    atom(&mut stsd, b"text", |b| {
        words(b, &[0, 1]);
        let at = b.len();
        b.extend_from_slice(&[0; 30]);
        b[at + 3] = 1;
        b[at + 23] = 1;
        atom(b, b"ftab", |b| b.extend_from_slice(&[0, 1, 0, 1, 0]));
    });
    let mut entries = chapters.iter().filter(|c| c.title.is_some()).peekable();
    let mut samples = Vec::new();
    let mut remaining = limit;
    let mut start = 0i64;
    while let Some(c) = entries.next() {
        let title = c.title.as_ref().unwrap().as_bytes();
        let len = u16::try_from(title.len()).map_err(|_| "chapter title exceeds sample limit")?;
        remaining = remaining.checked_sub(title.len() + 14 + 2 * size_of::<Sample>()).ok_or("chapter samples exceed memory budget")?;
        let mut data = Vec::with_capacity(title.len() + 14);
        data.extend_from_slice(&len.to_be_bytes());
        data.extend_from_slice(title);
        data.extend_from_slice(&[0, 0, 0, 12, b'e', b'n', b'c', b'd', 0, 0, 1, 0]);
        let end = entries.peek().map_or_else(
            || start + super::super::lrc::rescale(c.end, (1, i64::from(c.scale)), i64::from(scale))
                - super::super::lrc::rescale(c.start, (1, i64::from(c.scale)), i64::from(scale)),
            |next| super::super::lrc::rescale(next.start, (1, i64::from(next.scale)), i64::from(scale)));
        let duration = u32::try_from(end.saturating_sub(start)).map_err(|_| "chapter duration exceeds sample limit")?;
        samples.push(Sample { data: data.into(), duration, cts: 0, key: true, description: 1 });
        start = end;
    }
    let ticks = u32::try_from(start).map_err(|_| "chapter duration exceeds track limit")?;
    let movie_ticks = (u64::from(ticks) * u64::from(movie_scale)).div_ceil(u64::from(scale)).try_into().map_err(|_| "chapter duration exceeds movie limit")?;
    Ok(Track { id, samples, scale, media_ticks: ticks, movie_ticks, first_dts: 0, fragment_sample_size: None,
        stsd: stsd.into(), edits: vec![[movie_ticks, 0, 65536]], kind: "data", enabled: false, field_order: None,
        volume: 0, matrix: MATRIX, width: 0, height: 0, language: 0, handler: *b"text", name: b"ChapterHandler" })
}

fn subtitle_entry(codec: &str, private: &[u8]) -> Vec<u8> {
    let mut stsd = Vec::new();
    words(&mut stsd, &[0, 1]);
    if matches!(codec, "ass" | "webvtt") {
        atom(&mut stsd, if codec == "ass" { b"ass " } else { b"wvtt" }, |b| {
            words(b, &[0, 1]);
            b.extend_from_slice(private);
        });
        return stsd;
    }
    atom(&mut stsd, b"tx3g", |b| {
        words(b, &[0, 1, 0]);
        b.extend_from_slice(&[1, 255, 0, 0, 0, 255]); // justification and background color
        words(b, &[0, 0, 0, 0x00010010, 0xffffffff]); // text box and default style
        atom(b, b"ftab", |b| {
            b.extend_from_slice(b"\0\x01\0\x01\x05Arial")
        });
    });
    stsd
}

fn subtitle_track(
    text: &str,
    raw: bool,
    range: Option<(f64, Option<f64>)>,
    movie_scale: u32,
    index_bytes: &mut usize,
    limit: usize,
) -> Result<Track<'static>, &'static str> {
    let mut samples = Vec::new();
    let (mut ticks, mut skip, mut first_dts) = (0u64, 0, 0);
    let packets: Box<dyn Iterator<Item = _> + '_> = if raw {
        Box::new(super::super::subtitles::cues(text, false).map(|c| (c.text.into_bytes(), c.duration, 0, c.start)))
    } else {
        Box::new(super::super::subtitles::packets(text, range))
    };
    for (data, duration, preroll, start) in packets {
        *index_bytes = index_bytes
            .saturating_add(size_of::<Sample>())
            .saturating_add(data.len());
        if *index_bytes > limit {
            return Err("sample index exceeds memory budget");
        }
        if samples.is_empty() {
            skip = preroll as u32;
            if range.is_none() {
                first_dts = start.max(0) as u64;
            }
        }
        let cts = if raw { start.saturating_sub(first_dts.saturating_add(ticks).min(i64::MAX as u64) as i64) } else { 0 };
        ticks = ticks.saturating_add(duration as u64);
        samples.push(Sample {
            data: data.into(),
            duration: duration as u32,
            cts,
            key: true,
            description: 1,
        });
    }
    let ticks = ticks as u32;
    let movie_ticks =
        (f64::from(ticks.saturating_sub(skip)) * f64::from(movie_scale) / 1000.).round() as u32;
    Ok(Track {
        id: 1,
        samples,
        scale: 1000,
        media_ticks: ticks,
        movie_ticks,
        first_dts,
        fragment_sample_size: None,
        stsd: subtitle_entry("mov_text", &[]).into(),
        edits: if skip > 0 {
            vec![[movie_ticks, skip, 65536]]
        } else {
            vec![]
        },
        kind: "subtitle",
        enabled: true, field_order: None,
        volume: 0,
        matrix: MATRIX,
        width: 0,
        height: 0,
        language: 0x55c4,
        handler: *b"sbtl",
        name: b"SubtitleHandler",
    })
}

fn lyric_mov_text(ass: &str, default: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut rest = ass;
    let (mut text, mut styles) = (String::new(), Vec::new());
    let (mut flags, mut start, mut count) = (default[2], 0u16, 0u16);
    while !rest.is_empty() {
        if rest.starts_with("{\\") && let Some(end) = rest.find('}') {
            for tag in rest[1..end].split('\\') {
                for (prefix, bit) in [("b", 1), ("i", 2), ("u", 4)] {
                    if let Some(value) = tag.strip_prefix(prefix).and_then(|s| s.parse::<i32>().ok()) {
                        if (flags & bit != 0) == (value != 0) { continue; }
                        if count > start {
                            if flags != default[2] { styles.push((start, count, flags)); }
                            start = count;
                            flags = default[2];
                        }
                        if value == 0 { flags &= !bit; } else { flags |= bit; }
                    }
                }
            }
            rest = &rest[end + 1..];
            continue;
        }
        let c = if rest.starts_with("\\N") || rest.starts_with("\\n") {
            rest = &rest[2..];
            '\n'
        } else { let c = rest.chars().next().unwrap(); rest = &rest[c.len_utf8()..]; c };
        text.push(c);
        count = count.checked_add(1).ok_or("subtitle text exceeds sample limit")?;
    }
    if flags != default[2] && count > start { styles.push((start, count, flags)); }
    let length = u16::try_from(text.len()).map_err(|_| "subtitle text exceeds sample limit")?;
    let mut data = Vec::new();
    data.extend_from_slice(&length.to_be_bytes());
    data.extend_from_slice(text.as_bytes());
    if !styles.is_empty() {
        atom(&mut data, b"styl", |b| {
            b.extend_from_slice(&(styles.len() as u16).to_be_bytes());
            for (start, end, flags) in styles {
                b.extend_from_slice(&start.to_be_bytes());
                b.extend_from_slice(&end.to_be_bytes());
                b.extend_from_slice(&default[..2]);
                b.push(flags);
                b.extend_from_slice(&default[3..]);
            }
        });
    }
    Ok(data)
}

fn text_subtitle_track(
    doc: &super::super::lrc::Document,
    opts: &Remux<'_>,
    input: usize,
    movie_scale: u32,
    index_bytes: &mut usize,
) -> Result<Track<'static>, &'static str> {
    use super::super::{lrc, subtitles};
    let codec = match opts.subtitle_codec {
        Some(codec) => codec,
        None => match opts.format { "mkv" => "ass", "webm" => "webvtt", _ => return Err(lrc::NO_STREAM) },
    };
    let mov = matches!(opts.format, "" | "mp4" | "mov");
    if mov && codec != "mov_text"
        || opts.format == "webm" && codec != "webvtt"
        || opts.format == "mkv" && !matches!(codec, "ass" | "ssa" | "srt" | "subrip" | "webvtt" | "copy")
        || !matches!(opts.format, "" | "mp4" | "mov" | "mkv" | "webm")
    { return Err(lrc::MUX_ERROR); }
    let seek = (opts.input_times.get(input).and_then(|t| t.start).unwrap_or(0.) * 1000.).round() as i64;
    let from = opts.start.map(|s| (s * 1000.).round() as i64);
    let end = opts.end.map(|s| (s * 1000.).round() as i64);
    let copy = codec == "copy";
    if copy && !matches!(doc.format, "lrc" | "aqtitle" | "ass") { return Err(if opts.format == "mkv" { lrc::MATROSKA_CODEC_ERROR } else { lrc::MUX_ERROR }); }
    let ass = matches!(codec, "ass" | "ssa") || copy && doc.format == "ass";
    let mut stsd = subtitle_entry(if ass { "ass" } else { codec }, if ass { doc.ass_header.as_ref().map_or(subtitles::ASS_HEADER.as_bytes(), |h| h.text.as_bytes()) } else { &[] });
    if mov {
        let style = doc.ass_header.as_ref().and_then(|h| h.style("Default"));
        let font = style.map_or("Arial", |s| s.font.as_str()).as_bytes();
        let font = &font[..font.len().min(255)];
        stsd.truncate(66);
        stsd.push(font.len() as u8);
        stsd.extend_from_slice(font);
        let size = (stsd.len() - 8) as u32;
        stsd[8..12].copy_from_slice(&size.to_be_bytes());
        stsd[54..58].copy_from_slice(&(13 + font.len() as u32).to_be_bytes());
        if let Some(style) = style {
            stsd[48] = u8::from(style.bold) | u8::from(style.italic) << 1 | u8::from(style.underline) << 2;
            stsd[49] = style.size as u8;
            stsd[50..54].copy_from_slice(&[style.color as u8, (style.color >> 8) as u8, (style.color >> 16) as u8, 255 - (style.color >> 24) as u8]);
        }
    }
    let scale = if mov { 1_000_000 } else { 1000 };
    let mut samples: Vec<Sample> = Vec::new();
    let (mut origin, mut ticks, mut shift, mut skip) = (0, 0u64, None, 0u64);
    let mut read_order = 0;
    for p in &doc.packets {
        if !copy && (p.data.first().is_none_or(|&b| b == 0) || !doc.has_frame(p)) { continue; }
        let order = read_order;
        read_order += 1;
        let micros = lrc::rescale(p.timestamp(), doc.time_base, 1_000_000);
        if micros == i64::MIN { continue; }
        let pts = lrc::rescale(micros, (1, 1_000_000), 1000).saturating_sub(seek);
        if from.is_some_and(|start| pts < start) || end.is_some_and(|end| pts >= end) { continue; }
        let data = if mov { lyric_mov_text(&doc.ass_text(p), &stsd[46..54])? }
            else if copy || ass && doc.format == "ass" { p.data.clone() }
            else if ass { format!("{order},0,Default,,0,0,0,,{}", doc.ass_text(p)).into_bytes() }
            else { lrc::decode_ass(&doc.ass_text(p), codec == "webvtt", doc.ass_header.as_ref().map(|h| (h, if doc.format == "ass" { std::str::from_utf8(&p.data).unwrap_or("").split(',').nth(2).unwrap_or("") } else { "Default" }))).into_bytes() };
        if mov && data == [0, 0] { continue; }
        let duration = lrc::rescale(p.duration, doc.time_base, 1000);
        let duration = if !copy { u64::from(duration as u32) } else { duration.max(0) as u64 };
        let mut duration = duration.saturating_mul(u64::from(scale) / 1000);
        let pts = if mov { micros.saturating_sub(seek.saturating_mul(1000)) } else { pts };
        let pts = pts.saturating_sub(if copy { from.unwrap_or(0).saturating_mul(i64::from(scale) / 1000) } else { 0 });
        let shift = *shift.get_or_insert(pts.min(0).saturating_neg());
        let mut pts = pts.saturating_add(shift).max(0) as u64;
        if mov {
            if samples.is_empty() { skip = shift as u64; }
            duration = duration.saturating_add(skip);
            if duration > i32::MAX as u64 { return Err(lrc::DURATION_ERROR); }
            let overlap = pts < ticks;
            if overlap && let Some(previous) = samples.last_mut() {
                previous.duration = previous.duration.saturating_sub((ticks - pts).min(u64::from(u32::MAX)) as u32);
                ticks = pts;
            }
            if pts > ticks || !overlap && samples.last().is_some_and(|s: &Sample| s.duration == 0) {
                let gap = pts.saturating_sub(ticks).max(1);
                if gap > u64::from(u32::MAX) { return Err(lrc::DURATION_ERROR); }
                *index_bytes = index_bytes.saturating_add(size_of::<Sample>() + 2);
                if *index_bytes > opts.limit { return Err("sample index exceeds memory budget"); }
                samples.push(Sample { data: vec![0, 0].into(), duration: gap as u32, cts: 0, key: true, description: 1 });
                ticks += gap;
            }
            pts = pts.max(ticks);
        }
        if samples.is_empty() { origin = if mov { 0 } else { pts }; }
        *index_bytes = index_bytes.saturating_add(size_of::<Sample>()).saturating_add(data.len());
        if *index_bytes > opts.limit { return Err("sample index exceeds memory budget"); }
        let cts = (pts as i64).saturating_sub(origin.saturating_add(ticks).min(i64::MAX as u64) as i64);
        samples.push(Sample { data: data.into(), duration: duration as u32, cts, key: true, description: 1 });
        ticks = ticks.saturating_add(duration);
    }
    if mov {
        *index_bytes = index_bytes.saturating_add(size_of::<Sample>() + 2);
        if *index_bytes > opts.limit { return Err("sample index exceeds memory budget"); }
        samples.push(Sample { data: vec![0, 0].into(), duration: 0, cts: 0, key: true, description: 1 });
    }
    let movie_ticks = (ticks.saturating_sub(skip) as f64 * f64::from(movie_scale) / f64::from(scale)).ceil() as u32;
    let edit_ticks = ((ticks as f64 * f64::from(movie_scale) / f64::from(scale)).ceil() - (skip as f64 * f64::from(movie_scale) / f64::from(scale)).ceil()).max(0.) as u32;
    Ok(Track {
        id: 1, samples, scale, media_ticks: ticks.min(u64::from(u32::MAX)) as u32,
        movie_ticks,
        first_dts: origin, fragment_sample_size: None, stsd: stsd.into(),
        edits: if mov { vec![[edit_ticks, skip as u32, 65536]] } else { vec![] },
        kind: "subtitle", enabled: true, field_order: None, volume: 0, matrix: MATRIX, width: 0, height: 0,
        language: 0x55c4, handler: *b"sbtl", name: b"SubtitleHandler",
    })
}

// concatMp4 normalizes video to 90 kHz, drops edit lists, and extends the
// final packet of shorter tracks at each boundary before the next copy starts.
#[path = "mp4_concat.rs"]
mod concat;
#[path = "avi.rs"]
mod avi;
#[path = "mpegts.rs"]
mod mpegts;
#[path = "hls.rs"]
mod hls;
#[path = "flv.rs"]
mod flv;
#[path = "mkv.rs"]
mod mkv;
pub(in super::super) use concat::DecodedConcat;

fn repeat_tracks(
    tracks: &mut [Track<'_>],
    loops: usize,
    movie_scale: u32,
    duration: Option<f64>,
    end: Option<f64>,
    limit: usize,
) -> Result<(), &'static str> {
    let copies = loops
        .checked_add(1)
        .ok_or("sample index exceeds memory budget")?;
    let mut remaining = limit;
    let mut clip_ticks = Vec::with_capacity(tracks.len());
    for t in tracks.iter_mut() {
        let cost = t
            .samples
            .iter()
            .map(|s| size_of::<Sample>() + s.data.len())
            .try_fold(0usize, usize::checked_add)
            .and_then(|n| n.checked_mul(copies))
            .ok_or("output byte limit exceeded")?;
        remaining = remaining
            .checked_sub(cost)
            .ok_or("output byte limit exceeded")?;
        if t.samples.len().saturating_mul(copies) > 200_000 {
            return Err("sample index exceeds memory budget");
        }
        let ticks = t.samples.iter().try_fold(0u32, |ticks, s| ticks.checked_add(s.duration)).ok_or("track duration exceeds limit")?;
        t.media_ticks = ticks;
        clip_ticks.push(ticks);
        t.first_dts = 0;
        if duration.is_none() { t.edits.clear(); }
        t.movie_ticks = 0;
        let n = t.samples.len();
        if n != 0 {
            t.samples.reserve_exact(n * loops);
            for _ in 0..loops {
                t.samples.extend_from_within(..n);
            }
        }
    }
    if tracks.iter().all(|t| t.samples.is_empty()) {
        return Ok(());
    }
    if let Some(duration) = duration {
        for t in tracks.iter_mut() {
            let count = t.samples.len() / copies;
            if count == 0 { continue; }
            let mut previous = 0u64;
            let until = end.map(|end| (end * f64::from(t.scale)).round() as u64);
            'copies: for pass in 0..copies {
                let mut pts = (duration * pass as f64 * f64::from(t.scale)).round() as u64;
                for index in 0..count {
                    let at = pass * count + index;
                    let length = t.samples[at].duration;
                    let dts = if at == 0 { pts } else { pts.max(previous + 1) };
                    if until.is_some_and(|end| dts >= end) { t.samples.truncate(at); break 'copies; }
                    if at > 0 { t.samples[at - 1].duration = (dts - previous).try_into().map_err(|_| "track duration exceeds limit")?; }
                    previous = dts;
                    pts += u64::from(length);
                }
            }
            t.media_ticks = (previous + u64::from(t.samples.last().map_or(0, |s| s.duration))).try_into().map_err(|_| "track duration exceeds limit")?;
        }
    } else {
    for copy in 1..copies {
        let boundary = tracks
            .iter()
            .map(|t| f64::from(t.media_ticks) / f64::from(t.scale))
            .fold(0., f64::max);
        for (t, &clip) in tracks.iter_mut().zip(&clip_ticks) {
            if t.samples.is_empty() {
                continue;
            }
            let end = (boundary * f64::from(t.scale)).round() as u64;
            let padding = end.saturating_sub(u64::from(t.media_ticks));
            t.media_ticks =
                u32::try_from(end + u64::from(clip)).map_err(|_| "track duration exceeds limit")?;
            let last = copy * (t.samples.len() / copies) - 1;
            t.samples[last].duration += padding as u32;
        }
    }
    }
    for t in tracks {
        let ticks = f64::from(t.media_ticks) / f64::from(t.scale) * f64::from(movie_scale);
        t.movie_ticks = if duration.is_some() && t.kind == "video" { ticks.ceil() as u32 } else { ticks.round() as u32 };
        if let Some(edit) = t.edits.iter_mut().find(|e| e[1] != u32::MAX) {
            let origin = (f64::from(edit[1]) / f64::from(t.scale) * f64::from(movie_scale)).round() as u32;
            edit[0] = t.movie_ticks.saturating_sub(origin);
            t.movie_ticks = t.edits.iter().map(|e| e[0]).sum();
        }
    }
    Ok(())
}

// Compare DTS on each track's clock without rounding ties to microseconds.
fn interleaved_samples<'a>(tracks: &'a [Track<'_>], scale: u32) -> impl Iterator<Item = (usize, usize)> + 'a {
    let mut cursors: Vec<_> = tracks.iter().map(|t| {
        let mut dts = 0i128;
        for edit in &t.edits {
            if edit[1] != u32::MAX { dts -= i128::from(edit[1] as i32); break; }
            dts += (i128::from(edit[0]) * i128::from(t.scale) + i128::from(scale) / 2) / i128::from(scale);
        }
        (0usize, dts)
    }).collect();
    std::iter::from_fn(move || {
        let i = (0..tracks.len()).filter(|&i| cursors[i].0 < tracks[i].samples.len()).min_by(|&a,&b| {
            (cursors[a].1 * i128::from(tracks[b].scale)).cmp(&(cursors[b].1 * i128::from(tracks[a].scale))).then(a.cmp(&b))
        })?;
        let (sample, dts) = &mut cursors[i];
        let at = *sample;
        *dts += i128::from(tracks[i].samples[at].duration);
        *sample += 1;
        Some((i, at))
    })
}

fn write(
    tracks: &[Track<'_>],
    scale: u32,
    ftyp: &[u8],
    metadata: &BTreeMap<String, String>,
    chapters: &[u8],
    fragmented: bool,
    faststart: bool,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    let mut offsets = vec![0; tracks.len()];
    atom(&mut out, b"ftyp", |b| b.extend_from_slice(ftyp));
    atom(&mut out, b"moov", |b| {
        atom(b, b"mvhd", |b| {
            words(
                b,
                &[
                    0,
                    0,
                    0,
                    scale,
                    if fragmented {
                        0
                    } else {
                        tracks.iter().map(|t| t.movie_ticks).max().unwrap_or(0)
                    },
                    65536,
                    0x01000000,
                    0,
                    0,
                ],
            );
            words(b, &MATRIX);
            words(b, &[0; 6]);
            words(b, &[tracks.len() as u32 + 1]);
        });
        for (i, t) in tracks.iter().enumerate() {
            t.trak(b, fragmented, &mut offsets[i], tracks.iter().find(|t| t.kind == "data" && t.handler == *b"text").map(|t| t.id));
        }
        if fragmented {
            atom(b, b"mvex", |b| {
                for a in tracks {
                    atom(b, b"trex", |b| {
                        let (duration, size) = a
                            .samples
                            .first()
                            .map_or((1024, 0), |s| (s.duration, s.data.len() as u32));
                        words(
                            b,
                            &[
                                0,
                                a.id,
                                1,
                                duration,
                                a.fragment_sample_size.unwrap_or(size),
                                0,
                            ],
                        );
                    });
                }
            })
        }
        tags(b, metadata, chapters);
    });
    if fragmented {
        let moof = out.len();
        atom(&mut out, b"moof", |b| {
            atom(b, b"mfhd", |b| words(b, &[0, 1]));
            for (i, a) in tracks.iter().enumerate() {
                atom(b, b"traf", |b| {
                    atom(b, b"tfhd", |b| words(b, &[0x020002, a.id, 1]));
                    atom(b, b"tfdt", |b| {
                        words(
                            b,
                            &[0x01000000, (a.first_dts >> 32) as u32, a.first_dts as u32],
                        )
                    });
                    atom(b, b"trun", |b| {
                        words(b, &[0x01000f01, a.samples.len() as u32]);
                        offsets[i] = b.len();
                        words(b, &[0]);
                        for s in &a.samples {
                            words(
                                b,
                                &[
                                    s.duration,
                                    s.data.len() as u32,
                                    if s.key { 0x02000000 } else { 0x01010000 },
                                    s.cts as u32,
                                ],
                            );
                        }
                    });
                })
            }
        });
        let mut offset = (out.len() - moof + 8) as u64;
        for (a, &at) in tracks.iter().zip(&offsets) {
            out[at..at + 4].copy_from_slice(&(offset as u32).to_be_bytes());
            offset += a.samples.iter().map(|s| s.data.len() as u64).sum::<u64>();
        }
    }
    let payload = tracks
        .iter()
        .flat_map(|t| &t.samples)
        .map(|s| s.data.len() as u64)
        .sum::<u64>();
    if payload + out.len() as u64 + 8 > limit.min(u32::MAX as usize) as u64 {
        return Err("output byte limit exceeded");
    }
    let moov_start = 8 + ftyp.len();
    let moov_size = out.len() - moov_start;
    atom(&mut out, b"mdat", |b| {
        if fragmented {
            for t in tracks { for s in &t.samples { b.extend_from_slice(&s.data); } }
        } else {
            for (i, sample) in interleaved_samples(tracks, scale) {
                let at = offsets[i] + sample * 4;
                let pos = (b.len() - if faststart { 0 } else { moov_size }) as u32;
                b[at..at + 4].copy_from_slice(&pos.to_be_bytes());
                b.extend_from_slice(&tracks[i].samples[sample].data);
            }
        }
    });
    if !fragmented && !faststart { out[moov_start..].rotate_left(moov_size); }
    Ok(out)
}

#[derive(Clone, Copy)]
pub(in super::super) enum Composition {
    Horizontal,
    Vertical,
    Overlay(usize, usize),
    Fade { duration: f64, offset: Option<f64> },
}

impl Composition {
    pub(in super::super) fn parse(graph: &str) -> Option<Self> {
        if graph.contains("concat=") {
            return None;
        }
        if graph.contains("xfade") {
            let seconds = |key: &str| {
                graph.match_indices(key).find_map(|(i, _)| {
                    let text = &graph[i + key.len()..];
                    let mut dot = false;
                    let len = text
                        .bytes()
                        .take_while(|c| {
                            c.is_ascii_digit() || *c == b'.' && !std::mem::replace(&mut dot, true)
                        })
                        .count();
                    text[..len].parse::<f64>().ok()
                })
            };
            return Some(Self::Fade {
                duration: seconds("duration=").filter(|&s| s != 0.).unwrap_or(0.5),
                offset: seconds("offset="),
            });
        }
        if graph.contains("vstack") {
            return Some(Self::Vertical);
        }
        if graph.contains("hstack") {
            return Some(Self::Horizontal);
        }
        let (_, tail) = graph.split_once("overlay")?;
        let offset = tail
            .strip_prefix('=')
            .and_then(|s| s.split_once(':'))
            .and_then(|(x, y)| {
                let y = &y[..y.bytes().take_while(u8::is_ascii_digit).count()];
                if x.is_empty() || y.is_empty() || !x.bytes().all(|c| c.is_ascii_digit()) {
                    return None;
                }
                Some((
                    x.parse().unwrap_or(usize::MAX),
                    y.parse().unwrap_or(usize::MAX),
                ))
            })
            .unwrap_or_default();
        Some(Self::Overlay(offset.0, offset.1))
    }

    fn combine(
        self,
        a: &mut Raster,
        im: &Raster,
        remaining: &mut usize,
    ) -> Result<(), &'static str> {
        let (w, h, x, y) = match self {
            Self::Fade { .. } => unreachable!(),
            Self::Horizontal => (a.width + im.width, a.height.max(im.height), a.width, 0),
            Self::Vertical => (a.width.max(im.width), a.height + im.height, 0, a.height),
            Self::Overlay(x, y) => {
                let cols = a.width.saturating_sub(x).min(im.width);
                if cols != 0 {
                    for (r, row) in im
                        .pixels
                        .chunks_exact(im.width)
                        .take(a.height.saturating_sub(y))
                        .enumerate()
                    {
                        let start = (y + r) * a.width + x;
                        for (dst, src) in a.pixels[start..start + cols].iter_mut().zip(row) {
                            *dst = [src[0], src[1], src[2], 255];
                        }
                    }
                }
                a.gray = false;
                return Ok(());
            }
        };
        let n = w
            .checked_mul(h)
            .filter(|&n| n <= *remaining / 4)
            .ok_or("video frames exceed memory budget")?;
        let mut pixels = vec![[0; 4]; n];
        for (row, src) in a.pixels.chunks_exact(a.width.max(1)).enumerate() {
            pixels[row * w..row * w + a.width].copy_from_slice(src);
        }
        for (row, src) in im.pixels.chunks_exact(im.width.max(1)).enumerate() {
            let offset = (y + row) * w + x;
            pixels[offset..offset + im.width].copy_from_slice(src);
        }
        *remaining = *remaining + 4 * a.pixels.len() - 4 * n;
        a.pixels = pixels;
        a.width = w;
        a.height = h;
        a.gray = false;
        a.alpha = true;
        Ok(())
    }
}

pub(in super::super) const AUDIO_COPY_FILTER_ERROR: &str = "Filtering and streamcopy cannot be used together.";

pub(in super::super) struct Remux<'a> {
    pub apng_plays: u32,
    pub mkv_crc: bool,
    pub id3_version: u8,
    pub write_id3: bool,
    pub hls: Option<super::super::Hls<'a>>,
    pub composition: Option<Composition>,
    pub concat: Option<&'a mut DecodedConcat>,
    pub rate: Option<u32>,
    pub channels: Option<u32>,
    pub block_size: usize,
    pub trellis: u8,
    pub audio_bitrate: Option<&'a str>,
    pub strip_metadata: bool,
    pub chapter_input: Option<i32>,
    pub disable_chpl: bool,
    pub audio_codec: Option<&'a str>,
    pub video_codec: Option<&'a str>,
    pub subtitle_codec: Option<&'a str>,
    pub subtitle_language: Option<&'a str>,
    pub bitexact: bool,
    pub audio_filters: &'a [&'a str],
    pub video_filters: &'a [String],
    pub maps: &'a [&'a str],
    pub strip_audio: bool,
    pub strip_video: bool,
    pub strip_subtitles: bool,
    pub shortest: bool,
    pub start: Option<f64>,
    pub input_seek: bool,
    pub end: Option<f64>,
    pub source_end: Option<f64>,
    pub loop_duration: Option<f64>,
    pub input_times: &'a [super::super::InputTime],
    pub input_paths: &'a [String],
    pub audio_inputs: &'a [(u32, u32)],
    pub subtitle_rates: &'a [Option<&'a str>],
    pub subtitle_decode: Option<&'a std::cell::RefCell<(bool, String)>>,
    pub frames: Option<u32>,
    // Empty only for private MP4 staging, which retains the source audio.
    pub format: &'a str,
    pub fragmented: bool,
    pub faststart: bool,
    pub stdout: bool,
    pub metadata: &'a [(String, String)],
    pub rotation: Option<i32>,
    pub limit: usize,
}

enum Streams<'a> {
    Y4m(y4m::Clip<'a>),
    Wave(WaveStream<'a>),
    Nut(super::super::nut::Document<'a>, InputTime),
    Elementary(super::super::elementary_audio::Document<'a>),
    Wavpack(super::super::wavpack::Document<'a>),
    Caf(super::super::caf::Document<'a>),
    Aiff(super::super::aiff::Document<'a>),
    Au(super::super::au::Document<'a>),
    Voc(super::super::voc::Document),
    Mp4(Vec<(super::Track<'a>, &'a [u8])>),
    Captions(Cow<'a, str>),
    TextSubtitles(super::super::lrc::Document),
    GeneratedAudio(GeneratedAudio),
    GeneratedVideo(super::super::lavfi::Video),
    Images(&'a ImageSequence),
    Apng(super::super::apng::Document, InputTime),
    Gif(Animation),
    Ico(Vec<super::super::ico::Image<'a>>, InputTime),
    Still(InputTime),
    Aac {
        rate: u32,
        channels: u8,
        count: usize,
    },
}
impl Streams<'_> {
    fn len(&self) -> usize {
        match self {
            Self::Mp4(v) => v.len(),
            Self::Nut(doc, _) => doc.tracks.len(),
            Self::Ico(v, _) => v.len(),
            Self::Y4m(_)
            | Self::Wave(_)
            | Self::Voc(_)
            | Self::Elementary(_) | Self::Wavpack(_) | Self::Caf(_) | Self::Aiff(_) | Self::Au(_)
            | Self::Apng(..)
            | Self::Gif(_)
            | Self::Images(_)
            | Self::Still(_)
            | Self::GeneratedVideo(_)
            | Self::GeneratedAudio(_)
            | Self::Captions(_)
            | Self::TextSubtitles(_)
            | Self::Aac { .. } => 1,
        }
    }
    fn kind(&self, i: usize) -> &'static str {
        match self {
            Self::Mp4(v) => v[i].0.kind,
            Self::Nut(doc, _) => doc.tracks[i].kind(),
            Self::Captions(_) | Self::TextSubtitles(_) => "subtitle",
            Self::Voc(_) | Self::Elementary(_) | Self::Wavpack(_) | Self::Caf(_) | Self::Aiff(_) | Self::Au(_) | Self::Wave(_) | Self::GeneratedAudio(_) | Self::Aac { .. } => "audio",
            Self::Apng(..) | Self::Ico(..) | Self::Y4m(_) | Self::Gif(_) | Self::Still(_) | Self::Images(_) | Self::GeneratedVideo(_) => "video",
        }
    }
    fn seconds(&self, i: usize) -> f64 {
        match self {
            Self::Mp4(v) => {
                v[i].0
                    .original
                    .matroska()
                    .map_or(v[i].0.duration as f64 / f64::from(v[i].0.scale), |t| t.info.ticks / f64::from(t.info.scale))
            }
            Self::Nut(doc, seek) => (seek.end().unwrap_or(doc.tracks[i].seconds()).min(doc.tracks[i].seconds()) - seek.start.unwrap_or(0.)).max(0.) * seek.loops.saturating_add(1) as f64,
            Self::Aac { rate, count, .. } => *count as f64 * 1024. / f64::from(*rate),
            Self::Y4m(v) => v.seconds(),
            Self::Wave(w) => w.wav.fact.filter(|_| w.wav.raw.is_some()).unwrap_or(w.ticks) as f64 / f64::from(w.wav.rate),
            Self::Voc(doc) => (doc.wave().data.len()/doc.wave().stride()) as f64 / f64::from(doc.rate),
            Self::Elementary(doc) => doc.packets.len() as f64 * f64::from(doc.tick) / f64::from(doc.scale),
            Self::Wavpack(doc) => f64::from(doc.frames) / f64::from(doc.rate),
            Self::Caf(doc) => doc.frames as f64 / f64::from(doc.rate),
            Self::Aiff(doc) => doc.ticks() as f64 / f64::from(doc.rate),
            Self::Au(doc) => doc.ticks() as f64 / f64::from(doc.rate),
            Self::Images(seq) => seq.template_duration(),
            Self::Apng(doc, seek) => doc.seconds(*seek),
            Self::Gif(g) => g.seconds(),
            Self::Ico(_, seek) => 0.04 * seek.loops.saturating_add(1) as f64,
            Self::Still(seek) => {
                if frame_output::still_sample(seek.start.unwrap_or(0.), seek.end().unwrap_or(0.04))
                {
                    0.04
                } else {
                    0.
                }
            }
            Self::GeneratedVideo(v) => (v.duration * v.fps).round().max(1.) / v.fps,
            Self::GeneratedAudio(a) => a.duration_ticks as f64 / f64::from(a.rate),
            // LRC leaves the last packet's duration unknown.
            Self::TextSubtitles(_) => f64::INFINITY,
            Self::Captions(text) => {
                super::super::subtitles::cues(text, false)
                    .map(|c| c.start.saturating_add(c.duration))
                    .max()
                    .unwrap_or(0)
                    .max(0) as f64
                    / 1000.
            }
        }
    }
}

pub(in super::super) fn select_tracks(
    maps: &[&str],
    sources: usize,
    count: impl Fn(usize) -> usize,
    kind_at: impl Fn(usize, usize) -> &'static str,
) -> Result<Vec<(usize, usize)>, String> {
    let mut selected = Vec::new();
    if maps.is_empty() {
        for j in 0..sources {
            selected.extend((0..count(j)).map(|i| (j, i)));
        }
    }
    for map in maps {
        let raw = map.trim_end_matches('?');
        let mut fields = raw.trim_start_matches('-').split(':');
        let Some(j) = fields.next().and_then(|v| v.parse::<usize>().ok()) else {
            continue;
        };
        if j >= sources {
            continue;
        };
        let selector = fields.next();
        let kind = match selector {
            Some("v") => Some("video"),
            Some("a") => Some("audio"),
            Some("s") => Some("subtitle"),
            _ => None,
        };
        let ordinal = if kind.is_some() {
            fields.next()
        } else {
            selector
        };
        for (i, index) in (0..count(j))
            .filter(|&i| kind.is_none_or(|k| kind_at(j, i) == k))
            .enumerate()
        {
            if ordinal.is_some_and(|s| s.parse::<usize>() != Ok(i)) {
                continue;
            }
            if raw.starts_with('-') {
                selected.retain(|&v| v != (j, index))
            } else {
                selected.push((j, index))
            }
        }
        if selected.len() > 32 {
            return Err("output stream count exceeds limit".into());
        }
    }
    if selected.is_empty() && !maps.is_empty() && maps.iter().all(|s| s.ends_with('?') && !s.starts_with('-')) {
        for j in 0..sources { selected.extend((0..count(j)).map(|i| (j, i))); }
    }
    Ok(selected)
}

pub(in super::super) fn input_slice(
    input: &MediaInput,
    seek: InputTime,
    source_end: Option<f64>,
    loop_duration: Option<f64>,
    limit: usize,
) -> Result<Vec<u8>, String> {
    // MP4 slicing retains compressed packets; other source containers may
    // first need decoding while being materialized as MP4.
    let copy_audio = match input {
        MediaInput::Bytes("mp4" | "mov", _) | MediaInput::Joined(..) => true,
        MediaInput::Bytes("mkv" | "webm", bytes) => super::mkv_input::parse(bytes, limit)?.tracks.iter().all(|t|
            !matches!(t.info.codec, super::super::media_probe::Codec::Audio { .. })
            || matches!(t.info.codec, super::super::media_probe::Codec::Audio { tag: b"mp4a", .. })),
        _ => false,
    };
    let audio_codec = Some(if copy_audio { "copy" } else { "pcm_s16le" });
    let loops = if let Some(end) = seek.end()
        && let MediaInput::Bytes("mp4" | "mov", bytes) | MediaInput::Joined(bytes, _) = input
        && end <= loop_duration.unwrap_or(super::read_tracks(bytes, super::movie(bytes)?)?.1) { 0 } else { seek.loops };
    remux(std::slice::from_ref(input), Remux {start: seek.start, input_seek: true, end: seek.end(), source_end, loop_duration, audio_codec,
        ..Remux::passthrough(limit) }, loops, &mut Vec::new())
}

impl<'a> Remux<'a> {
    fn passthrough(limit: usize) -> Self {
        Remux {
            mkv_crc: true,
            apng_plays: 1,
            id3_version: 4,
            write_id3: false,
            hls: None,
            composition: None,
            concat: None,
            start: None,
            input_seek: false,
            end: None,
            source_end: None,
            loop_duration: None,
            input_times: &[],
            input_paths: &[],
            audio_inputs: &[],
            subtitle_rates: &[],
            subtitle_decode: None,
            limit,
            rate: None,
            channels: None,
            audio_codec: Some("pcm_s16le"),
            video_codec: Some("copy"),
            audio_bitrate: None,
            block_size: 1024,
            trellis: 0,
            strip_metadata: false,
            chapter_input: None,
            disable_chpl: false,
            subtitle_codec: None,
            subtitle_language: None,
            bitexact: false,
            audio_filters: &[],
            video_filters: &[],
            maps: &[],
            strip_audio: false,
            strip_video: false,
            strip_subtitles: false,
            shortest: false,
            frames: None,
            format: "",
            fragmented: false,
            faststart: true,
            stdout: false,
            metadata: &[],
            rotation: None,
        }
    }
}

pub(in super::super) fn assemble_segments(inputs: &[MediaInput], input_times: &[InputTime], concat: Option<&mut DecodedConcat>, limit: usize) -> Result<Vec<u8>,String> {
    remux(inputs, Remux {concat, input_times, ..Remux::passthrough(limit)}, 0, &mut Vec::new())
}

fn flv_as_mp4(input: &[u8], limit: usize) -> Result<Vec<u8>, &'static str> {
    use super::super::media_probe::Codec;
    let movie = super::flv_input::parse(input)?;
    let mut tracks = Vec::new();
    let mut remaining = limit;
    for (video, info) in &movie.tracks {
        let ticks = info.ticks as u64;
        let mut track = match info.codec {
            Codec::Video { width, height, .. } => video_track(
                width.unwrap_or_default() as usize,
                height.unwrap_or_default() as usize,
                movie
                    .avc_config
                    .map_or(VideoCodec::Avc(30), VideoCodec::Config),
                1000,
                ticks,
                1000,
            )?,
            Codec::Audio { rate, channels, .. } => Track {
                id: 1,
                samples: Vec::new(),
                scale: 1000,
                media_ticks: ticks as u32,
                movie_ticks: ticks as u32,
                first_dts: 0,
                fragment_sample_size: None,
                stsd: audio_entry(rate, channels, 2).into(),
                edits: vec![],
                kind: "audio",
                enabled: true, field_order: None,
                volume: 256,
                matrix: MATRIX,
                width: 0,
                height: 0,
                language: 0x55c4,
                handler: *b"soun",
                name: b"SoundHandler",
            },
            Codec::Subtitle { .. } => unreachable!(),
        };
        remaining = remaining
            .checked_sub(info.count.saturating_mul(size_of::<Sample>()))
            .ok_or("sample index exceeds memory budget")?;
        track.id = tracks.len() as u32 + 1;
        track.samples.reserve_exact(info.count);
        for (p, payload) in super::flv_input::packets(movie.bytes, *video) {
            track.samples.push(Sample {
                data: payload.into(),
                duration: p.ticks as u32,
                cts: p.pts - p.dts,
                key: p.key,
                description: 1,
            });
        }
        tracks.push(track);
    }
    write(
        &tracks,
        1000,
        b"isom\0\0\x02\0isomiso2avc1mp41",
        &BTreeMap::new(),
        &[],
        false,
        true,
        limit,
    )
}

pub(super) struct InputBytes<'a> {
    pub bytes: Cow<'a, [u8]>,
    matroska: Option<super::mkv_input::Document<'a>>,
    avi: Vec<super::super::avi_input::Description>,
    transport: Vec<super::mpegts_input::Description>,
}

fn materialize<'a>(
    inputs: &'a [MediaInput],
    opts: &Remux<'_>,
) -> Result<Vec<InputBytes<'a>>, String> {
    let sliced =
        opts.composition.is_none() && (opts.start.is_some() || opts.end.is_some() || opts.shortest);
    let mut materialized = Vec::new();
    let mut admitted = 0usize;
    for (j, source) in inputs.iter().enumerate() {
        let (format, input) = match source {
            MediaInput::Bytes(f, b) => (*f, b.as_slice()),
            MediaInput::Joined(b, _) => ("mp4", b.as_slice()),
            MediaInput::Images(_) => ("image2", &[][..]),
        };
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        let audio = format == "lavfi"
            && matches!(
                input.split(|&b| b == b'=').next(),
                Some(b"sine" | b"anullsrc")
            );
        let mut bytes = Cow::Borrowed(input);
        let mut matroska = None;
        let mut avi = Vec::new();
        let mut transport=Vec::new();
        if (seek.start.is_some()
            || seek.end().is_some()
            || seek.loops > 0
                && matches!(
                    format,
                    "mp4" | "mov" | "mpegts" | "avi" | "flv" | "mkv" | "webm" | "aac" | "image2" | "lavfi"
                ))
            && !audio
            && !(seek.start.is_some_and(|s| s != 0.) && opts.audio_codec == Some("copy") && super::super::ffmpeg_pcm::Format::parse(opts.format).is_some()
                && source.decoded().and_then(|c| c.timings.as_ref()).is_some_and(|times| times.iter().any(|(cut, duration)| duration.is_none() && cut.start.zip(cut.to).is_none())))
            && super::super::ffmpeg_pcm::Format::parse(format).is_none()
            && !(matches!(opts.format, "srt" | "webvtt" | "lrc" | "ass" | "ttml") && matches!(format, "mp4" | "mov"))
            && !(matches!(opts.format, "lrc" | "ttml") && matches!(format, "srt" | "webvtt"))
            && !(opts.format == "ttml" && matches!(format, "mkv" | "webm"))
            && !matches!(format, "latm" | "amr" | "ac3" | "wv" | "nut" | "apng" | "ico" | "caf" | "aiff" | "au" | "voc" | "ircam" | "nistsphere" | "wav" | "w64" | "y4m" | "gif" | "lrc" | "vplayer" | "stl" | "aqtitle" | "microdvd" | "jacosub" | "sami" | "realtext" | "subviewer" | "subviewer1" | "pjs" | "mpl2" | "ass")
            && (!matches!(source, MediaInput::Bytes("image2", _)) || seek.loops > 0)
        {
            bytes = Cow::Owned(input_slice(
                source,
                seek,
                seek.generation_end(opts.source_end),
                if seek.loops > 0 && matches!(format, "mp4" | "mov") {
                    if opts.audio_codec.is_some_and(|c| c.starts_with("pcm_"))
                        || !opts.strip_audio && matches!(opts.audio_codec, None | Some("aac"))
                        && matches!(opts.format, "aac" | "latm" | "mp4" | "mov" | "mkv" | "mpegts" | "flv") {
                        let tracks = super::read_tracks(input, super::movie(input)?)?.0;
                        let selected = select_tracks(opts.maps, inputs.len(), |k| if k == j { tracks.len() } else { 0 }, |_,i| tracks[i].kind)?;
                        let selected: Vec<_> = selected.into_iter().map(|(_,i)| i)
                            .filter(|&i| !(opts.strip_video && tracks[i].kind == "video" || opts.strip_subtitles && tracks[i].kind == "subtitle")).collect();
                        if selected.iter().any(|&i| tracks[i].pcm_format().is_some()
                            || opts.audio_codec.is_some_and(|c| c.starts_with("pcm_")) && tracks[i].tag == b"mp4a") {
                            Some(super::pcm_loop_duration(input, &selected, seek.start)?)
                        } else { None }
                    } else { None }
                } else { None },
                opts.limit.saturating_sub(admitted),
            )?);
        } else if matches!(format, "mkv" | "webm") {
            let limit = opts.limit.saturating_sub(admitted);
            let doc = super::mkv_input::parse(input, limit)?;
            bytes = Cow::Owned(mkv::as_mp4(&doc, limit)?);
            matroska = Some(doc);
        } else if format == "aiff" && opts.concat.is_some() {
            let limit=opts.limit.saturating_sub(admitted);
            let doc=super::super::aiff::Document::read(input,false,limit)?;
            bytes=Cow::Owned(doc.render(InputTime::default(),&Remux{format:"wav",audio_codec:Some("pcm_f32le"),..Remux::passthrough(limit)})?);
        } else if format == "mpegts" {
            let (mp4, descriptions) = mpegts::as_mp4(input,opts.limit.saturating_sub(admitted))?;
            bytes=Cow::Owned(mp4);
            transport=descriptions;
        } else if format == "avi" {
            let (mp4, descriptions) = avi::as_mp4(input, opts.limit.saturating_sub(admitted), opts.video_codec == Some("copy"))?;
            bytes = Cow::Owned(mp4);
            avi = descriptions;
        } else if format == "flv" {
            bytes = Cow::Owned(flv_as_mp4(input, opts.limit.saturating_sub(admitted))?);
        } else if sliced && let MediaInput::Images(seq) = source {
            let limit = opts.limit.saturating_sub(admitted);
            let track = sequence_track(seq, 1000, &[], None, VideoEncoding::Mp4, limit)?;
            bytes = Cow::Owned(write(
                &[track],
                1000,
                b"isom\0\0\x02\0isomiso2avc1mp41",
                &BTreeMap::new(),
                &[],
                false,
                true,
                limit,
            )?);
        } else if sliced
            && format == "lavfi"
            && let Some(mut video) =
                super::super::lavfi::Video::parse(std::str::from_utf8(input).unwrap_or(""))
        {
            video.duration = opts.source_end.unwrap_or(video.duration);
            let limit = opts.limit.saturating_sub(admitted);
            let track = generated_video(&video, 1000, &[], None, VideoEncoding::Mp4, limit)?;
            bytes = Cow::Owned(write(
                &[track],
                1000,
                b"isom\0\0\x02\0isomiso2avc1mp41",
                &BTreeMap::new(),
                &[],
                false,
                true,
                limit,
            )?);
        }
        admitted = admitted.saturating_add(bytes.len());
        if admitted > opts.limit {
            return Err("input byte limit exceeded".into());
        }
        materialized.push(InputBytes { bytes, matroska, avi, transport });
    }
    Ok(materialized)
}

type Source<'a> = (&'a [u8], &'a [u8], Streams<'a>);

fn read_sources<'a>(
    inputs: &'a [MediaInput],
    materialized: &'a [InputBytes<'a>],
    opts: &Remux<'_>,
) -> Result<Vec<Source<'a>>, String> {
    use super::atoms;
    let mut sources = Vec::new();
    let mut remaining=opts.limit;
    for (j, (source, data)) in inputs.iter().zip(materialized).enumerate() {
        let format = if matches!(data.bytes, Cow::Owned(_)) {
            if matches!(source,MediaInput::Bytes("aiff",_)) && opts.concat.is_some() {"wav"}else{"mp4"}
        } else {
            match source {
                MediaInput::Bytes(f, _) => *f,
                MediaInput::Joined(..) => "mp4",
                MediaInput::Images(seq) => {
                    sources.push((&[][..], &[][..], Streams::Images(seq)));
                    continue;
                }
            }
        };
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        let input = data.bytes.as_ref();
        if format == "apng" {
            sources.push((input,&[][..],Streams::Apng(super::super::apng::Document::read(input,&mut remaining)?,seek)));
            continue;
        }
        if format == "ico" {
            sources.push((input, &[][..], Streams::Ico(super::super::ico::read(input, &mut remaining)?, seek)));
            continue;
        }
        if format=="gif" {
            sources.push((input,&[][..],Streams::Gif(Animation::read(input,seek,&mut remaining)?)));
            continue;
        }
        if format == "image2" {
            sources.push((input, &[][..], Streams::Still(seek)));
            continue;
        }
        if format == "lavfi" {
            let spec = std::str::from_utf8(input).map_err(|_| "invalid lavfi source")?;
            if let Some(mut video) = super::super::lavfi::Video::parse(spec) {
                video.duration = seek
                    .generation_end(opts.source_end)
                    .unwrap_or(video.duration);
                sources.push((input, &[][..], Streams::GeneratedVideo(video)));
                continue;
            }
            let a = super::super::parse_lavfi_input_doc(spec).ok_or("invalid lavfi source")?;
            if seek.loops > 0 { return Err("Generated audio does not support loop seeking".into()); }
            let duration = seek.generation_end(opts.source_end).unwrap_or(a.duration);
            let rate = f64::from(a.sample_rate);
            // The synthetic movie's AAC packet table is timed on a 10 fps grid;
            // the decoded channel buffers retain the requested duration.
            let origin = (seek.start.unwrap_or(0.) * rate).round() as u64;
            let end = seek.end().map_or(u64::MAX, |s| (s * rate).round() as u64);
            let clip = |n: f64| ((n.round().max(1024.) as u64).min(end)).saturating_sub(origin);
            let ticks = clip((duration * 10.).round().max(1.) / 10. * rate);
            let decoded_ticks = clip(duration * rate);
            let decoded_per_copy = decoded_ticks;
            let duration_ticks = if seek.start.is_some() || seek.end().is_some() {
                decoded_ticks
            } else {
                ticks
            };
            // Concatenation repeats the original AAC packet boundaries. A cut
            // with only decoded samples first materializes new 1024-frame packets.
            let (ticks, decoded_ticks, duration_ticks, origin, period) = if seek.loops > 0 {
                let (period, origin) = if ticks == 0 {
                    (decoded_ticks, 0)
                } else {
                    (ticks, origin)
                };
                let total = period
                    .checked_mul((seek.loops as u64).saturating_add(1))
                    .filter(|&n| n <= u64::from(u32::MAX))
                    .ok_or("audio duration exceeds limit")?;
                (total, total, total, origin, (period != 0).then_some(period))
            } else {
                (ticks, decoded_ticks, duration_ticks, origin, None)
            };
            sources.push((
                input,
                &[][..],
                Streams::GeneratedAudio(GeneratedAudio {
                    rate: a.sample_rate,
                    channels: a.channels,
                    ticks,
                    decoded_ticks,
                    decoded_per_copy,
                    origin,
                    duration_ticks,
                    period,
                }),
            ));
            continue;
        }
        if format == "y4m" {
            sources.push((
                input,
                &[][..],
                Streams::Y4m(y4m::Stream::parse(input)?.clip(seek, opts.limit)?),
            ));
            continue;
        }
        if matches!(format,"latm"|"amr"|"ac3") {
            sources.push((input,&[][..],Streams::Elementary(super::super::elementary_audio::Document::read(input,format,remaining)?)));
            continue;
        }
        if format == "wv" {
            sources.push((input,&[][..],Streams::Wavpack(super::super::wavpack::Document::read(input,remaining)?)));
            continue;
        }
        if format == "nut" {
            sources.push((input,&[][..],Streams::Nut(super::super::nut::Document::read(input,remaining)?,seek)));
            continue;
        }
        if format == "caf" {
            let pipe = opts.input_paths.get(j).is_some_and(|path| matches!(path.as_str(), "-" | "pipe:" | "pipe:0"));
            sources.push((input,&[][..],Streams::Caf(super::super::caf::Document::read(input,pipe,opts.limit)?)));
            continue;
        }
        if format == "voc" {
            let doc=super::super::voc::Document::read(input,opts.limit)?;
            let wave=doc.wave();
            if opts.audio_codec!=Some("copy") && !wave.data.is_empty() && wave.data.len()<wave.stride() { return Err("Incomplete raw audio sample frame".into()); }
            sources.push((input,&[][..],Streams::Voc(doc)));
            continue;
        }
        if format == "aiff" {
            sources.push((input,&[][..],Streams::Aiff(super::super::aiff::Document::read(input,false,opts.limit)?)));
            continue;
        }
        if format == "au" {
            sources.push((input,&[][..],Streams::Au(super::super::au::Document::read(input,opts.limit)?)));
            continue;
        }
        if matches!(format, "nistsphere" | "ircam" | "wav" | "w64") || super::super::ffmpeg_pcm::Format::parse(format).is_some() {
            let wav = if let Some(raw) = super::super::ffmpeg_pcm::Format::parse(format) {
                let (rate, channels) = opts.audio_inputs.get(j).copied().unwrap_or((44100, 1));
                let mut wave = Wave::raw(raw, input, rate, channels)?;
                if opts.audio_codec != Some("copy") {
                    wave.channel_mask = match channels { 1=>4, 2=>3, 3=>0xb, 4=>0x107, 5=>0x37, 6=>0x3f, 7=>0x70f, 8=>0x63f, _=>0 };
                }
                wave
            } else if format == "nistsphere" { super::super::nistsphere::Document::read(input,opts.limit)?.wave } else if format == "ircam" { super::super::ircam::read(input)? } else { Wave::read(input)? };
            if format == "nistsphere" && !wav.data.is_empty() && wav.data.len() < wav.stride() {
                return Err("Incomplete raw audio sample frame".into());
            }
            sources.push((
                input,
                &[][..],
                Streams::Wave(WaveStream::read(wav, seek)?),
            ));
            continue;
        }
        if format == "aac" {
            let mut frames = Frames::new(input);
            let count = frames.by_ref().count();
            if count > 200_000 {
                return Err("sample index exceeds memory budget".into());
            }
            sources.push((
                input,
                &[][..],
                Streams::Aac {
                    rate: frames.rate,
                    channels: frames.channels,
                    count,
                },
            ));
            continue;
        }
        if matches!(format, "lrc" | "vplayer" | "stl" | "aqtitle" | "microdvd" | "jacosub" | "sami" | "realtext" | "subviewer" | "subviewer1" | "pjs" | "mpl2" | "ass") {
            let doc = if format == "ass" { super::super::ass::read(input, &mut remaining)? } else if format == "jacosub" { super::super::jacosub::read(input, &mut remaining, opts.input_times.get(j).and_then(|t| t.start))? } else if matches!(format, "sami" | "realtext") { super::super::smil_subtitles::read(format, input, &mut remaining, opts.input_times.get(j).and_then(|t| t.start))? } else if format != "lrc" { super::super::text_subtitles::read(format, input, &mut remaining, opts.subtitle_rates.get(j).copied().flatten())? } else { super::super::lrc::Document::read(input, &mut remaining)? };
            sources.push((input, &[][..], Streams::TextSubtitles(doc)));
            continue;
        }
        if matches!(format, "srt" | "webvtt") {
            sources.push((
                input,
                &[][..],
                Streams::Captions(String::from_utf8_lossy(input)),
            ));
            continue;
        }
        let moov = super::movie(input)?;
        let (mut tracks, _) = super::read_tracks(input, moov)?;
        if matches!(source, MediaInput::Joined(..)) {
            use super::child;
            for (track, (_, trak)) in tracks.iter_mut().zip(atoms(moov).filter(|(tag, _)| *tag == b"trak")) {
                // Assembled WAV tracks use numeric WAVE tags in their internal
                // sample descriptions. Preserve their channels and sample width.
                if matches!(track.tag, b"\x01\0\0\0" | b"\x03\0\0\0" | b"\x06\0\0\0" | b"\x07\0\0\0") {
                    let stsd = child(child(child(child(trak,b"mdia"),b"minf"),b"stbl"),b"stsd");
                    track.entry = atoms(stsd.get(8..).unwrap_or_default()).next().map_or(&[], |(_, entry)| entry);
                }
            }
        }
        if seek.start.is_none()
            && seek.end().is_none()
            && let MediaInput::Images(seq) = source
        {
            // Before materialization the PNG sequence inherits the single sample
            // duration of the synthetic movie used as its track template.
            tracks[0].duration =
                (seq.template_duration() * f64::from(tracks[0].scale)).round() as u64;
        }
        if let MediaInput::Bytes("flv", bytes) = source
            && seek.start.is_none() && seek.end().is_none() && seek.loops == 0
        {
            // FLV timestamps can have gaps even when every audio packet lasts 23 ms.
            let tags = super::flv_input::tag_bytes(bytes)?;
            for track in &mut tracks {
                track.original = Original::Flv(tags);
            }
        }
        for (track, desc) in tracks.iter_mut().zip(&data.transport) {
            track.original=Original::Transport(desc);
            track.duration=desc.ticks;
        }
        for (track, desc) in tracks.iter_mut().zip(&data.avi) {
            track.original = Original::Avi(desc);
            track.duration = desc.duration;
        }
        if let Some(doc) = &data.matroska {
            for (track, original) in tracks.iter_mut().zip(&doc.tracks) {
                track.original = Original::Matroska(original);
                track.duration = (original.info.ticks / f64::from(original.info.scale) * f64::from(track.scale)).round() as u64;
            }
        }
        let boxes = atoms(moov).filter_map(|(k, v)| (k == b"trak").then_some(v));
        sources.push((
            input,
            moov,
            Streams::Mp4(tracks.into_iter().zip(boxes).collect()),
        ));
    }
    Ok(sources)
}

fn mapped_tracks(
    sources: &[Source<'_>],
    opts: &Remux<'_>,
) -> Result<(Vec<(usize, usize)>, Option<f64>), String> {
    let mut selected = select_tracks(
        opts.maps,
        sources.len(),
        |j| sources[j].2.len(),
        |j, i| sources[j].2.kind(i),
    )?;
    let optional_fallback = !opts.maps.is_empty() && opts.maps.iter().all(|m| m.ends_with('?')) &&
        select_tracks(&opts.maps.iter().map(|m| m.trim_end_matches('?')).collect::<Vec<_>>(), sources.len(), |j| sources[j].2.len(), |j,i| sources[j].2.kind(i))?.is_empty();
    if opts.maps.is_empty() || optional_fallback {
        selected.retain(|&(j, i)| match &sources[j].2 {
            Streams::Mp4(tracks) if tracks[i].0.kind == "data" => false,
            _ => true,
        });
    }
    if selected.iter().any(|&(j, i)| matches!(&sources[j].2, Streams::Mp4(tracks) if tracks[i].0.kind == "data" && tracks[i].0.tag == b"text")) {
        if opts.format == "mov" { return Err("Tag text incompatible with output codec id '98314' ([0][0][0][0])".into()); }
        if matches!(opts.format, "mkv" | "webm") { return Err("Only audio, video, and subtitles are supported for Matroska".into()); }
        if matches!(opts.format, "" | "mp4") {
            selected.retain(|&(j, i)| !matches!(&sources[j].2, Streams::Mp4(tracks) if tracks[i].0.kind == "data" && tracks[i].0.tag == b"text"));
        }
    }
    if opts.format == "ttml" && opts.maps.is_empty() {
        selected.retain(|&(j, i)| sources[j].2.kind(i) == "subtitle");
        selected.truncate(1);
    }
    selected.retain(|&(j, i)| match sources[j].2.kind(i) {
        "video" => !opts.strip_video,
        "audio" => !opts.strip_audio,
        "subtitle" => !opts.strip_subtitles,
        _ => true,
    });
    // Private staging and concat need every source track for later maps.
    if !opts.format.is_empty() && opts.concat.is_none() && (opts.maps.is_empty() || optional_fallback) {
        let audio_only = matches!(opts.format, "aac" | "latm" | "amr" | "wv" | "wav" | "w64" | "caf" | "aiff" | "au" | "voc" | "ircam") || super::super::ffmpeg_pcm::Format::parse(opts.format).is_some();
        if audio_only { selected.retain(|&(j, i)| sources[j].2.kind(i) == "audio"); }
        if matches!(opts.format,"rawvideo"|"y4m"|"image2"|"image2pipe"|"gif"|"apng"|"ico") { selected.retain(|&(j,i)|sources[j].2.kind(i)=="video"); }
        for kind in ["video", "audio"] {
            let mut best = None;
            let mut best_score = 0;
            for (j, source) in sources.iter().enumerate() {
                let mut file_best = None;
                let mut file_score = 0;
                let mut default_bonus = 0;
                for &(_, i) in selected.iter().filter(|&&(s, i)| s == j && source.2.kind(i) == kind) {
                    let (value, packets, default) = if kind == "video" {
                        let (width, height, packets, default) = match &source.2 {
                            Streams::Mp4(t) => (t[i].0.width as usize, t[i].0.height as usize, t[i].0.stats.count != 0, t[i].0.enabled),
                            Streams::Nut(d, _) => (d.tracks[i].width, d.tracks[i].height, !d.tracks[i].packets.is_empty(), false),
                            Streams::Y4m(v) => (v.width, v.height, v.frames_per_copy != 0, false),
                            Streams::Images(seq) => seq.frames.first().map_or((0,0,false,false), |im| (im.width,im.height,true,false)),
                            Streams::Ico(images, _) => (images[i].raster.width, images[i].raster.height, true, false),
                            Streams::Apng(d, _) => (d.width,d.height,!d.frames.is_empty(),false),
                            Streams::Gif(g) => (g.width,g.height,!g.frames.is_empty(),false),
                            Streams::GeneratedVideo(v) => (v.width as usize,v.height as usize,true,false),
                            Streams::Still(_) => { let (w,h,_) = frame_output::still_info(source.0,opts.limit)?; (w,h,true,false) },
                            _ => continue,
                        };
                        ((width as u64).saturating_mul(height as u64), packets, default)
                    } else {
                        let (channels, packets, default) = match &source.2 {
                            Streams::Mp4(t) => (u32::from(t[i].0.channels()), t[i].0.stats.count != 0, t[i].0.enabled),
                            Streams::Wave(w) => (w.wav.channels as u32, !w.wav.data.is_empty(), false),
                            Streams::GeneratedAudio(a) => (a.channels, a.ticks != 0, false),
                            Streams::Aac { channels, count, .. } => (u32::from(*channels), *count != 0, false),
                            Streams::Elementary(d) => (d.channels, !d.packets.is_empty(), false),
                            Streams::Wavpack(d) => (d.channels, !d.packets.is_empty(), false),
                            Streams::Caf(d) => (d.channels, d.frames != 0, false),
                            Streams::Voc(d) => (d.channels as u32, !d.wave().data.is_empty(), false),
                            Streams::Aiff(d) => (d.channels as u32, d.frames != 0, false),
                            Streams::Au(d) => (d.channels as u32, !d.data.is_empty(), false),
                            Streams::Nut(d, _) => (d.tracks[i].channels, !d.tracks[i].packets.is_empty(), false),
                            _ => continue,
                        };
                        (u64::from(channels), packets, default)
                    };
                    let bonus = 5_000_000 * u64::from(default);
                    let score = value.saturating_add(100_000_000 * u64::from(packets) + bonus);
                    if score > file_score {
                        file_best = Some((j, i));
                        file_score = score;
                        default_bonus = bonus;
                    }
                }
                // Defaults rank streams within a file, not between inputs.
                if file_score - default_bonus > best_score {
                    best = file_best;
                    best_score = file_score - default_bonus;
                }
            }
            selected.retain(|&(j, i)| sources[j].2.kind(i) != kind || best == Some((j, i)));
        }
        selected.sort_by_key(|&(j,i)| match sources[j].2.kind(i) {"video"=>0,"audio"=>1,_=>2});
    }
    if selected.len() > 32 && opts.concat.is_none() {
        return Err("output stream count exceeds limit".into());
    }
    let shortest = opts
        .shortest
        .then(|| {
            selected
                .iter()
                .map(|&(j, i)| match &sources[j].2 {
                    Streams::Mp4(tracks) if !opts.input_seek && opts.start.is_some() && opts.video_codec == Some("copy") && tracks[i].0.kind == "video" => {
                        let t = &tracks[i].0;
                        let range = Some((opts.start.unwrap_or(0.), opts.end));
                        if cut_packets(t, &sources[j].0, range, true, Some(false), 0).3.next().is_none() {
                            opts.start.unwrap_or(0.)
                        } else { t.duration as f64 / f64::from(t.scale) }
                    }
                    Streams::GeneratedAudio(a) => a.decoded_ticks as f64 / f64::from(a.rate),
                    stream @ (Streams::Elementary(_) | Streams::Wavpack(_) | Streams::Caf(_) | Streams::Voc(_) | Streams::Aiff(_) | Streams::Au(_)) => {
                        let seek = opts.input_times.get(j).copied().unwrap_or_default();
                        let seconds = stream.seconds(i);
                        (seek.end().unwrap_or(seconds).min(seconds) - seek.start.unwrap_or(0.)).max(0.) * seek.loops.saturating_add(1) as f64
                    }
                    stream => stream.seconds(i),
                })
                .reduce(f64::min)
        })
        .flatten();
    for &(j, _) in &selected {
        if opts.composition.is_none()
            && let Streams::Y4m(clip) = &sources[j].2
        {
            if let Some(end) = shortest {
                clip.check_slice(0., end)?;
            }
            if opts.start.is_some() || opts.end.is_some() {
                let duration = shortest.unwrap_or(clip.seconds());
                clip.check_slice(
                    opts.start.unwrap_or(0.),
                    opts.end.unwrap_or(duration).min(duration),
                )?;
            }
        }
    }
    Ok((selected, shortest))
}

pub(in super::super) fn render_mapped(
    inputs: &[MediaInput],
    opts: &Remux<'_>,
    frames: Option<u32>,
    full_size: bool,
    emit: impl FnMut(Raster, y4m::TimedFrame) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    let data = materialize(inputs, opts)?;
    let sources = read_sources(inputs, &data, opts)?;
    let composed = opts
        .composition
        .map(|s| compose_frames(s, &sources, inputs, opts))
        .transpose()?;
    let sources = if composed.is_some() {
        &sources[..1]
    } else {
        &sources[..]
    };
    let (selected, shortest) = mapped_tracks(sources, opts)?;
    if opts.format == "rawvideo" && composed.is_none() && selected.iter().filter(|&&(j,i)| sources[j].2.kind(i)=="video").count()>1 {
        let mut buffered = Vec::new();
        let mut remaining = opts.limit;
        let mut geometry = (64,64,10);
        for &(j,i) in selected.iter().filter(|&&(j,i)|sources[j].2.kind(i)=="video") {
            let options = y4m::Options {start:opts.start.unwrap_or(0.),end:shortest.into_iter().chain(opts.end).reduce(f64::min),frames,filters:opts.video_filters,no_video:false,limit:remaining};
            geometry = render_source(&sources[j],i,(&inputs[j],opts.input_times[j],inputs[j].decoded().or(opts.concat.as_deref())),None,options,true,|image,time| {
                remaining = remaining.checked_sub(image.pixels.capacity()*size_of::<[u8;4]>() + size_of::<(Raster,y4m::TimedFrame,usize)>()).ok_or("video frames exceed memory budget")?;
                buffered.try_reserve_exact(1).map_err(|_|"video frames exceed memory budget")?;
                let order = buffered.len();
                buffered.push((image,time,order));
                Ok(())
            })?;
        }
        buffered.sort_unstable_by(|a,b|a.1.pts.total_cmp(&b.1.pts).then(a.2.cmp(&b.2)));
        let mut emit = emit;
        for (image,time,_) in buffered { emit(image,time)?; }
        return Ok(geometry);
    }
    let Some(&(j, i)) = selected
        .iter()
        .find(|&&(j, i)| sources[j].2.kind(i) == "video")
    else {
        if sources.iter().any(|s| matches!(s.2, Streams::Nut(..))) { return Err(super::super::lrc::NO_STREAM.into()); }
        return Ok((64, 64, 10));
    };
    let streams = &sources[j].2;
    let durations = selected.iter().map(|&(j, i)| sources[j].2.seconds(i));
    let duration = shortest
        .or_else(|| durations.reduce(f64::max))
        .unwrap_or(0.);
    let cut = opts.shortest || opts.start.is_some() || opts.end.is_some();
    let options = y4m::Options {
        start: opts.start.unwrap_or(0.).max(0.),
        end: cut.then(|| {
            opts.end
                .unwrap_or(duration)
                .min(duration)
                .min(streams.seconds(i))
        }),
        no_video: false,
        frames,
        filters: opts.video_filters,
        limit: opts.limit,
    };
    if let Some(sequence) = composed {
        let (w, h) = sequence.geometry;
        y4m::render_frames(
            w,
            h,
            90000.,
            sequence.times(),
            options,
            |i| Ok(sequence.frames[i].0.clone()),
            emit,
        )?;
        return Ok((w, h, 30));
    }
    let duration = if cut && options.filters.is_empty() && matches!(streams, Streams::Mp4(_)) {
        presentation_duration(sources, &selected, movie_scale(sources), Some((options.start, Some(opts.end.unwrap_or(duration).min(duration)))))
    } else { duration };
    render_source(
        &sources[j],
        i,
        (&inputs[j], opts.input_times[j], inputs[j].decoded().or(opts.concat.as_deref())),
        Some(duration),
        options,
        full_size,
        emit,
    )
}

fn render_source(
    (input, _, streams): &Source<'_>,
    i: usize,
    (source, seek, decoded): (&MediaInput, InputTime, Option<&DecodedConcat>),
    duration: Option<f64>,
    options: y4m::Options<'_>,
    full_size: bool,
    emit: impl FnMut(Raster, y4m::TimedFrame) -> Result<(), &'static str>,
) -> Result<(usize, usize, u32), String> {
    if let Some(seq) = decoded
        .and_then(|c| c.video.as_ref()?.get(&i))
        && let Streams::Mp4(tracks) = streams
        && !seq.visible(options.start, options.end).is_empty()
    {
        let (w, h) = (tracks[i].0.width as usize, tracks[i].0.height as usize);
        let show = seq.visible(options.start, options.end);
        let geometry = options.filters.is_empty() && !full_size;
        let limit = options.limit;
        let mut emit = emit;
        y4m::render_frames(
            w,
            h,
            f64::from(tracks[i].0.scale),
            show.iter().map(|f| (f.0, f.1)),
            options,
            |k| Ok(seq.images[show[k].2].clone()),
            |mut im, frame| {
                if geometry {
                    if w.saturating_mul(h) > limit / 4 {
                        return Err("image exceeds memory budget");
                    }
                    im.width = w;
                    im.height = h;
                    im.pixels.resize(w * h, [0; 4]);
                }
                emit(im, frame)
            },
        )?;
        return Ok((w, h, 30));
    }
    let cut = options.start != 0. || options.end.is_some();
    match streams {
        Streams::Nut(doc, seek) => {
            let track=&doc.tracks[i];let times=track.times(*seek,options.limit)?;let limit=options.limit;
            y4m::render_frames(track.width,track.height,f64::from(track.scale),times.iter().map(|t|(t.1,t.2)),options,|i|track.image(times[i].0,limit),emit)?;
            Ok((track.width,track.height,30))
        }
        Streams::Y4m(v) => v.render(options, emit),
        Streams::Images(seq) => seq.render(options, emit),
        Streams::Ico(images, seek) => {
            let im = &images[i].raster;
            let visible = seek.start.unwrap_or(0.) < 0.04 && seek.end().unwrap_or(0.04) > 0.;
            y4m::render_frames(im.width, im.height, 25., super::super::ico::times(*seek, options.limit)?.filter(move |&(pts, _)| visible && (seek.loops == 0 || pts >= options.start)), options, |_| Ok(im.clone()), emit)?;
            Ok((im.width, im.height, 30))
        }
        Streams::Apng(doc, seek) => {
            let times: Vec<_>=doc.times(*seek,options.limit)?.collect();
            y4m::render_frames(doc.width,doc.height,1000000.,times.iter().map(|t|(t.1,t.2)),options,|i|Ok(doc.frames[times[i].0].image.clone()),emit)?;
            Ok((doc.width,doc.height,30))
        }
        Streams::Gif(g) => {
            y4m::render_frames(g.width,g.height,100.,g.times(),options,|i| Ok(g.image(i)),emit)?;
            Ok((g.width,g.height,30))
        }
        Streams::Still(seek) => {
            frame_output::render_still(input, options, *seek, cut, emit)
        }
        Streams::GeneratedVideo(v) => v.render(options, false, emit),
        Streams::Mp4(tracks) => {
            if let MediaInput::Bytes("image2", bytes) = source
                && tracks[i].0.tag != b"avc1"
            {
                return frame_output::render_still(bytes, options, seek, cut, emit);
            }
            // FLV carries frame timestamps; the staged duration can end at its
            // last timestamp and must not be used to invent a faster frame rate.
            let duration = if matches!(tracks[i].0.original, Original::Flv(_)) { None } else { duration };
            super::render_track(input, &tracks[i].0, duration, options, full_size, emit)
        }
        _ => unreachable!(),
    }
}

struct ComposedFrames {
    frames: Vec<(Raster, f64)>,
    geometry: (usize, usize),
}

impl ComposedFrames {
    fn times(&self) -> impl Iterator<Item = (f64, f64)> {
        self.frames.iter().scan(0., |at, (_, duration)| {
            let pts = *at;
            *at += duration;
            Some((pts, *duration))
        })
    }
    fn encode(
        &self,
        track: &mut Track<'_>,
        scale: u32,
        opts: &Remux<'_>,
        preparing_cut: bool,
        used: &mut usize,
    ) -> Result<(), String> {
        (track.width, track.height) = (self.geometry.0 as u32, self.geometry.1 as u32);
        let limit = opts.limit.saturating_sub(*used);
        // A cut sees the original track duration even if the graph added frames.
        let hz = f64::from(track.scale);
        let origin = track
            .edits
            .first()
            .map_or(0, |r| (r[1] as i32).max(0) as u64);
        let mut remaining = u64::from(track.media_ticks) + origin;
        let times = self.times().map_while(|(pts, duration)| {
            if !preparing_cut {
                return Some((pts, duration));
            }
            let ticks = (duration * hz).round().max(1.) as u64;
            let take = remaining.min(ticks);
            remaining -= take;
            (take != 0).then_some((
                pts,
                if take == ticks {
                    duration
                } else {
                    take as f64 / hz
                },
            ))
        });
        encode_video(
            track,
            scale,
            times,
            y4m::Options {
                filters: opts.video_filters,
                frames: opts.frames,
                start: 0.,
                end: None,
                no_video: false,
                limit,
            },
            opts.video_encoding(),
            |i| Ok(self.frames[i].0.clone()),
        )?;
        *used += track.samples.len() * size_of::<Sample>()
            + track.samples.iter().map(|s| s.data.len()).sum::<usize>();
        Ok(())
    }
}

fn crossfade(
    frames: &mut Vec<(Raster, f64)>,
    next: Vec<(Raster, f64)>,
    duration: f64,
    offset: Option<f64>,
) -> Result<(), String> {
    if frames.is_empty() || next.is_empty() {
        return Err("Cannot read properties of undefined (reading 'data')".into());
    }
    let tick = frames[0].1;
    let fps = if tick > 0. { (1. / tick).round() } else { 25. };
    let overlap = ((duration * fps).round() as usize)
        .min(frames.len())
        .min(next.len())
        .max(1);
    let before = frames.len() - overlap;
    let before = offset.map_or(before, |s| before.min((s * fps).round() as usize));
    frames.truncate(before + overlap);
    for (k, (b, tick)) in next.into_iter().enumerate() {
        if k >= overlap {
            frames.push((b, tick));
            continue;
        }
        let a = &mut frames[before + k].0;
        let alpha = (k + 1) as f64 / (overlap + 1) as f64;
        for (i, p) in a.pixels.iter_mut().enumerate() {
            if let Some(other) = b.pixels.get(i) {
                for c in 0..3 {
                    p[c] = (f64::from(p[c]) * (1. - alpha) + f64::from(other[c]) * alpha).round()
                        as u8;
                }
            } else {
                p[..3].fill(0);
            }
            p[3] = 255;
        }
        a.gray = false;
    }
    Ok(())
}

fn compose_frames(
    composition: Composition,
    sources: &[Source<'_>],
    inputs: &[MediaInput],
    opts: &Remux<'_>,
) -> Result<ComposedFrames, String> {
    let mut frames = Vec::new();
    let mut next = Vec::new();
    let mut remaining = opts.limit;
    let mut geometry = (64, 64);
    for (j, source) in sources.iter().take(2).enumerate() {
        let streams = &source.2;
        let i = (0..streams.len())
            .find(|&i| streams.kind(i) == "video")
            .ok_or("Cannot read properties of undefined (reading 'decodedVideoFrames')")?;
        let mut index = 0;
        let mut last = None;
        let options = y4m::Options {
            start: 0.,
            end: None,
            filters: &[],
            frames: None,
            no_video: false,
            limit: remaining,
        };
        let (w, h, _) = render_source(
            source,
            i,
            (&inputs[j], opts.input_times[j], inputs[j].decoded()),
            None,
            options,
            true,
            |im, frame| {
                let tick = frame.duration;
                if j == 0 || matches!(composition, Composition::Fade { .. }) {
                    remaining = remaining
                        .checked_sub(im.pixels.len() * 4 + size_of::<(Raster, f64)>())
                        .ok_or("video frames exceed memory budget")?;
                    if j == 0 {
                        frames.push((im, tick));
                    } else {
                        next.push((im, tick));
                    }
                } else if let Some((a, _)) = frames.get_mut(index) {
                    composition.combine(a, &im, &mut remaining)?;
                    if matches!(composition, Composition::Overlay(..)) {
                        last = Some(im);
                    }
                }
                index += 1;
                Ok(())
            },
        )?;
        if j == 0 {
            geometry = (w, h);
        } else if let Composition::Fade { duration, offset } = composition {
            crossfade(&mut frames, std::mem::take(&mut next), duration, offset)?;
        } else if matches!(composition, Composition::Overlay(..)) {
            if let Some(im) = last {
                for (a, _) in frames.iter_mut().skip(index) {
                    composition.combine(a, &im, &mut remaining)?;
                }
            }
        } else {
            frames.truncate(index);
        }
    }
    if let Some((im, _)) = frames.first() {
        geometry = (im.width, im.height);
    }
    Ok(ComposedFrames { frames, geometry })
}

fn cut_packets<'a>(
    t: &'a super::Track<'_>,
    input: &'a [u8],
    range: Option<(f64, Option<f64>)>,
    whole_packets: bool,
    seek: Option<bool>,
    pcm_delay: u64,
) -> (usize, u64, u64, impl Iterator<Item = super::Sample> + 'a) {
    let pcm_copy = whole_packets && t.pcm_format().is_some();
    let visible = move |s: &super::Sample| !pcm_copy || s.dts < t.origin || !t.discarded_pcm_sample(s);
    let (mut first, mut start, mut end) = (0, if pcm_copy { t.origin.saturating_sub(pcm_delay) } else { 0 }, u64::MAX);
    if let Some((from, to)) = range {
        let scale = f64::from(t.scale);
        let duration = t.duration.saturating_sub(if pcm_copy { t.empty_ticks } else { 0 });
        start = t.origin.saturating_add((from * scale).round() as u64).saturating_sub(if pcm_copy || whole_packets && t.kind == "video" { pcm_delay } else { t.empty_ticks });
        end = t.origin.saturating_add(
            to.map_or(duration, |s| ((s * scale).round() as u64).min(duration)),
        ).saturating_sub(if pcm_copy || whole_packets && t.kind == "video" { pcm_delay } else { t.empty_ticks });
        first = if seek == Some(false) {
            t.samples(input.len()).filter(visible).position(|s| t.packet_key(input, &s) && s.dts >= start && s.dts < end)
                .unwrap_or(t.stats.count)
        } else if seek == Some(true) {
            let target = if let Some(m) = t.original.matroska() && t.kind == "audio" {
                m.blocks.iter().take_while(|b| b.dts as f64 <= from * f64::from(m.info.scale))
                    .last().map_or(0, |b| (b.cluster as f64 * scale / f64::from(m.info.scale)).round() as u64)
            } else if t.kind == "video" { (from * scale).round() as u64 } else { start };
            let key = t.samples(input.len()).filter(visible).enumerate().filter(|(_,s)|s.key && s.dts <= target).last();
            if let Some((_, s)) = &key && start >= end {
                start = s.dts;
                end = u64::MAX;
            }
            key.map_or(0, |(i,_)|i)
        } else if whole_packets && t.pcm_format().is_some() && t.origin > t.stats.ticks && from == 0. {
            t.samples(input.len()).filter(visible).count().saturating_sub(1)
        } else {
            let mut key = None;
            t.samples(input.len()).filter(visible).enumerate().find_map(|(i,s)| {
                if s.key { key = Some(i); }
                (end > start && s.dts < end && s.dts.saturating_add(u64::from(s.tick)) > start)
                    .then_some(if t.kind == "video" { key.unwrap_or(i) } else { i })
            }).unwrap_or(t.stats.count)
        };
    }
    if whole_packets && t.kind == "video" {
        first += t.samples(input.len()).skip(first).take_while(|s|s.dts < end && !t.packet_key(input, s)).count();
    }
    (
        first,
        start,
        end,
        t.samples(input.len())
            .filter(visible)
            .skip(first)
            .take_while(move |s| s.dts < end)
            .map(move |mut s| {
                if (pcm_copy || whole_packets && t.kind == "video") && t.origin <= t.stats.ticks
                    && s.dts.saturating_add(u64::from(s.tick)) >= t.origin.saturating_add(t.duration.saturating_sub(t.empty_ticks)) {
                    // The demuxer caps the final duration against the stream end
                    // using the packet timestamp, including its leading empty edit.
                    let remaining = t.origin.saturating_add(t.duration).saturating_sub(t.empty_ticks.saturating_mul(2)).saturating_sub(s.dts);
                    if remaining > 0 { s.tick = remaining.min(u64::from(u32::MAX)) as u32; }
                }
                if !whole_packets && t.tag != b"wvpk" { s.tick = u64::from(s.tick).min(end - s.dts) as u32; }
                s
            }),
    )
}

fn movie_scale(sources: &[Source<'_>]) -> u32 {
    match sources[0].2 {
        Streams::Wave(ref w) => w.wav.rate,
        Streams::Aac { rate, .. } => rate,
        Streams::Apng(..) => 1000000,
        Streams::Gif(_) => 100,
        Streams::Still(_) | Streams::Ico(..) => 25,
        _ => super::header_time(super::child(sources[0].1, b"mvhd"), 1000).0,
    }
}

pub(super) fn cut_duration(t: &super::Track<'_>, input: &[u8], scale: u32, range: (f64, Option<f64>)) -> f64 {
    let (_, start, end, mut packets) = cut_packets(t, input, Some(range), false, None, 0);
    let Some(first) = packets.next() else { return 0.; };
    let ticks = u64::from(first.tick) + packets.map(|s| u64::from(s.tick)).sum::<u64>();
    if first.dts >= start {
        return ticks as f64 / f64::from(t.scale);
    }
    let visible = end.min(first.dts.saturating_add(ticks)).saturating_sub(start);
    let segment = (visible as f64 * f64::from(scale) / f64::from(t.scale)).round();
    (segment * f64::from(t.scale) / f64::from(scale)).round() / f64::from(t.scale)
}

fn presentation_duration(sources: &[Source<'_>], selected: &[(usize, usize)], scale: u32, range: Option<(f64, Option<f64>)>) -> f64 {
    selected.iter().map(|&(j, i)| {
        let (bytes, _, stream) = &sources[j];
        let seconds = stream.seconds(i);
        match (range, stream) {
            (None, _) => seconds,
            (Some(range), Streams::Mp4(tracks)) => cut_duration(&tracks[i].0, bytes, scale, range),
            (Some((from, to)), _) => (to.unwrap_or(seconds).min(seconds) - from).max(0.),
        }
    }).fold(0., f64::max)
}

fn aac_track(inputs: &[MediaInput], opts: &mut Remux<'_>, source: (usize, usize), streams: &Streams<'_>, selected: &[(usize, usize)], movie_scale: u32, limit: usize, shortest: Option<f64>) -> Result<Track<'static>, String> {
    for filter in opts.audio_filters.iter().flat_map(|f|f.split(',')).map(str::trim) {
        if matches!(filter, "anull" | "areverse") { continue; }
        if let Some(value) = filter.strip_prefix("volume=")
            && value.strip_suffix("dB").unwrap_or(value).trim().parse::<f64>().is_ok_and(|v|v.is_finite()) { continue; }
        return Err("AAC audio filter is not supported".into());
    }
    if let Streams::Mp4(tracks) = streams
        && !matches!(tracks[source.1].0.tag, b"mp4a" | b"alac" | b"samr" | b"sawb" | b"wvpk")
        && tracks[source.1].0.pcm_format().is_none()
        && !(tracks[source.1].0.tag == b"sowt" && matches!(tracks[source.1].0.original, Original::Avi(_) | Original::Matroska(_)))
        && inputs[source.0].decoded().or(opts.concat.as_deref()).and_then(|d|d.audio.get(&source.1)).is_none() {
        return Err("AAC encoding requires decoded PCM audio".into());
    }
    let selector = format!("{}:{}", source.0, source.1);
    let maps = [selector.as_str()];
    let seek = opts.input_times.get(source.0).copied().unwrap_or_default();
    let original_pcm = if let Streams::Mp4(t) = streams && (t[source.1].0.pcm_format().is_some() || t[source.1].0.tag == b"mp4a")
        && !inputs[source.0].decoded().or(opts.concat.as_deref()).is_some_and(|c| c.audio.contains_key(&source.1))
        && let MediaInput::Bytes("mp4" | "mov", bytes) = &inputs[source.0] {
        Some((bytes.as_slice(), super::read_tracks(bytes, super::movie(bytes)?)?.0))
    } else { None };
    let order = original_pcm.as_ref().map_or_else(Vec::new, |(_, tracks)| tracks[source.1].channel_order());
    let limit = limit.saturating_sub(order.capacity() * size_of::<u16>());
    let timed_pcm = if let Streams::Wave(w) = streams && seek.loops > 0 && w.wav.frames.is_empty() && w.wav.packets.is_empty() {
        Some(w.wav.loop_pcm(seek, limit)?)
    } else if let Some((bytes, tracks)) = &original_pcm {
        let track = &tracks[source.1];
        if track.tag == b"mp4a" {
            let trak = super::atoms(super::movie(bytes)?).filter(|(tag,_)| *tag == b"trak").nth(source.1).ok_or("Missing AAC track")?.1;
            let selected: Vec<_> = selected.iter().filter(|(j,_)| *j == source.0).map(|&(_,i)| i).collect();
            let (_, _, pcm, frames) = track.decode_aac(bytes, trak, seek, &selected, limit)?;
            Some((pcm, frames))
        } else {
            let selected: Vec<_> = selected.iter().filter(|(j,_)| *j == source.0).map(|&(_,i)| i).collect();
            Some(track.decode_pcm(bytes, seek, if seek.loops > 0 { super::pcm_loop_duration(bytes, &selected, None)? } else { 0. }, limit.saturating_sub(selected.capacity() * size_of::<usize>()))?)
        }
    } else { None };
    let limit = limit.saturating_sub(timed_pcm.as_ref().map_or(0, |(data, frames)| data.capacity() + frames.capacity() * size_of::<ffmpeg_wave::Frame>()));
    let original_wave = if let Some((data, frames)) = &timed_pcm && let Some((_, tracks)) = &original_pcm {
        let track = &tracks[source.1];
        let mut wave = Wave::raw(track.pcm_format().unwrap_or(super::super::ffmpeg_pcm::Format::Float(32, false)), data, track.audio_rate().unwrap(), u32::from(track.channels()))?;
        wave.channel_mask = super::super::audio_remix::order_mask(&order);
        if wave.channel_mask == 0 { wave.channel_order = &order; }
        Some(Wave { frames, ..wave })
    } else if let Streams::Wave(w) = streams {
        Some(if let Some((data, frames)) = &timed_pcm { Wave { data, frames, ..w.wav } } else { w.wav })
    } else { None };
    let bytes = if let Some(mut wave) = original_wave {
        wave.raw = Some(wave.format());
        let seek = if timed_pcm.is_some() { InputTime::default() } else { seek };
        ffmpeg_wave::Input::Wave(wave).render(seek, &Remux {
            format: "wav", audio_codec: Some("pcm_f32le"), maps: &[], hls: None, concat: None, shortest: false, limit, ..*opts
        })?
    } else if let MediaInput::Bytes("lavfi", input) = &inputs[source.0] {
        let Some(ffmpeg_wave::Input::Generated { frequency, rate, channels, duration }) = ffmpeg_wave::Input::parse("lavfi", input)? else { return Err("invalid audio generator".into()); };
        let seek = opts.input_times.get(source.0).copied().unwrap_or_default();
        let frames = (seek.generation_end(opts.source_end).unwrap_or(duration) * f64::from(rate)).round().max(0.) as usize;
        let pcm = super::super::lavfi::sine(frequency, rate, channels, frames, limit)?;
        let wave = Wave::raw(super::super::ffmpeg_pcm::Format::Signed(16, false), &pcm, rate, channels as u32)?;
        ffmpeg_wave::Input::Wave(wave).render(seek, &Remux {
            format: "wav", audio_codec: Some("pcm_f32le"), maps: &[],
            hls: None, concat: None, limit: limit.saturating_sub(pcm.capacity()), ..*opts
        })?
    } else {
        remux(inputs, Remux {
            format: "wav", audio_codec: Some("pcm_f32le"), maps: &maps,
            strip_video: true, strip_subtitles: true, composition: None, shortest: false,
            hls: None, concat: opts.concat.as_deref_mut(), limit, ..*opts
        }, 0, &mut Vec::new())?
    };
    let mut wave = Wave::read(&bytes)?;
    let mut timings = Vec::new();
    if let Some(original) = original_wave.filter(|w| !w.frames.is_empty()) {
        let full = ((original.data.len() / original.stride()) as f64 * f64::from(wave.rate) / f64::from(original.rate)).ceil() as usize;
        let mut start = 0;
        for (range, pts) in original.output_frames(wave.rate, full, opts.start, opts.end) {
            bytes.capacity().checked_add((timings.len() + 1) * size_of::<ffmpeg_wave::Frame>())
                .filter(|&n| n <= limit).ok_or("AAC timeline exceeds memory budget")?;
            timings.try_reserve_exact(1).map_err(|_| "AAC timeline exceeds memory budget")?;
            timings.push(ffmpeg_wave::Frame { start, len: range.len(), pts });
            start += range.len();
        }
    }
    let limit = limit.saturating_sub(timings.capacity() * size_of::<ffmpeg_wave::Frame>());
    let pts = |frame: usize| -> i64 {
        if let Some(timing) = timings.get(timings.partition_point(|p| p.start <= frame).saturating_sub(1)) {
            return (timing.pts + frame as i128 - timing.start as i128) as i64;
        }
        frame as i64
    };
    if opts.end.is_some_and(|end| pts(0) as f64 >= (end - opts.start.unwrap_or(0.)) * f64::from(wave.rate)) { wave.data = &[]; }
    let frames = wave.data.len() / wave.stride();
    let packet_count = frames.div_ceil(1024) + usize::from(frames > 0);
    let keep = shortest.map_or(packet_count, |end| {
        let end = ((end - opts.start.unwrap_or(0.)).max(0.) * f64::from(wave.rate)).round() as i64;
        (0..packet_count).take_while(|&i| {
            if i == 0 { pts(0) < end }
            else { let frame = (i - 1) * 1024; pts(frame) + (frames - frame).min(1024) as i64 <= end }
        }).count()
    });
    // Each retained packet needs its current input frame, including the
    // priming packet. Do not encode the rest of a longer shortest input.
    let pcm = &wave.data[..frames.min(keep.saturating_mul(1024)) * wave.stride()];
    let mut packets = super::super::aac::encode(pcm, wave.rate, wave.channels as u32, opts.audio_bitrate, limit.saturating_sub(bytes.capacity()))?;
    packets.truncate(keep);
    let first = pts(0);
    let skip = u32::try_from((1024 - first).max(0)).map_err(|_| "AAC start exceeds limit")?;
    let delay = ((first - 1024).max(0) as f64 * f64::from(movie_scale) / f64::from(wave.rate)).floor() as u32;
    let ticks = (0..frames).step_by(1024).take(packets.len().saturating_sub(1))
        .map(|frame| pts(frame) + (frames - frame).min(1024) as i64).max().unwrap_or(first);
    let media_ticks = u32::try_from(ticks - first + 1024).map_err(|_| "AAC duration exceeds limit")?;
    let movie_ticks = ((f64::from(media_ticks) * f64::from(movie_scale) / f64::from(wave.rate)).ceil()
        - (f64::from(skip) * f64::from(movie_scale) / f64::from(wave.rate)).ceil()) as u32;
    packets.iter().try_fold(bytes.capacity() + packets.capacity() * size_of::<Vec<u8>>() + packets.len() * size_of::<Sample>(), |n,p| n.checked_add(p.capacity())).filter(|&n| n <= limit).ok_or("AAC samples exceed memory budget")?;
    let mut samples = Vec::with_capacity(packets.len());
    let mut start = 0;
    for (i, data) in packets.into_iter().enumerate() {
        let end = if i * 1024 < frames { pts(i * 1024) - first + 1024 } else { i64::from(media_ticks) }.max(start + 1);
        let duration = u32::try_from(end - start).map_err(|_| "AAC packet timestamps are not monotonic")?;
        samples.push(Sample { data: data.into(), duration, cts: 0, key: true, description: 1 });
        start = end;
    }
    Ok(Track {
        id: 1, samples, scale: wave.rate, media_ticks, movie_ticks: movie_ticks.saturating_add(delay),
        first_dts: 0, fragment_sample_size: None,
        stsd: audio_entry(wave.rate, wave.channels as u32, 2).into(),
        edits: if delay > 0 { vec![[delay, u32::MAX, 65536], [movie_ticks, 0, 65536]] } else { vec![[movie_ticks, skip, 65536]] }, kind: "audio", enabled: true,
        field_order: None, volume: 256, matrix: MATRIX, width: 0, height: 0,
        language: 0x55c4, handler: *b"soun", name: b"SoundHandler",
    })
}

pub(in super::super) fn remux(
    inputs: &[MediaInput],
    mut opts: Remux<'_>,
    loops: usize,
    resources: &mut Vec<(String, Vec<u8>)>,
) -> Result<Vec<u8>, String> {
    use super::{atoms, child, rows, u16_at, u32_at, wide};
    if opts.concat.as_ref().is_some_and(|c|c.align_durations) && inputs.len() > 128 {
        return Err(format!(
            "Resource limit exceeded for maxConcatInputs: {} exceeds maximum allowed 128",
            inputs.len()
        ));
    }
    let data = materialize(inputs, &opts)?;
    let sources = read_sources(inputs, &data, &opts)?;
    let &(input, ..) = sources.first().ok_or("no MP4 inputs")?;
    let scale = movie_scale(&sources);
    let composed = opts
        .composition
        .map(|s| compose_frames(s, &sources, inputs, &opts))
        .transpose()?;
    let sources = if composed.is_some() {
        &sources[..1]
    } else {
        &sources[..]
    };
    let preparing_cut = composed.is_some() && (opts.start.is_some() || opts.end.is_some());
    if preparing_cut {
        opts.start = None;
        opts.end = None;
    }
    let (selected, shortest) = mapped_tracks(sources, &opts)?;
    let encode_pcm = if matches!(opts.format, "mp4" | "mov") {
        opts.audio_codec.and_then(|s| s.strip_prefix("pcm_")).map(|codec|
            super::super::ffmpeg_pcm::Format::parse(codec).ok_or("PCM codec is not supported in this container")
        ).transpose()?
    } else { None };
    // PCM output uses the encoded sample clock for audio-only movies, so an
    // edit does not lose samples when resampling changes the input clock.
    let scale = if encode_pcm.is_some() && selected.len() == 1 && sources[selected[0].0].2.kind(selected[0].1) == "audio"
        && !matches!(&sources[selected[0].0].2, Streams::Mp4(t) if t[selected[0].1].0.tag == b"mp4a") {
        let (j, i) = selected[0];
        opts.rate.or_else(|| inputs[j].decoded().or(opts.concat.as_deref())
            .and_then(|c| c.audio.get(&i)).map(|pcm| pcm.rate))
            .map_or(scale, |rate| rate.max(1000))
    } else { scale };
    let encode_aac = matches!(opts.audio_codec, None | Some("aac")) && matches!(opts.format, "aac" | "latm" | "mp4" | "mov" | "mkv" | "mpegts" | "flv");
    for &(j,i) in &selected {
        if (matches!(&sources[j].2,Streams::Elementary(doc) if doc.format=="latm"||matches!(doc.tag,b"samr"|b"sawb")) || matches!(&sources[j].2,Streams::Mp4(t) if matches!(t[i].0.tag,b"samr"|b"sawb"))) && opts.audio_codec!=Some("copy")
            && !matches!(opts.format,"null"|"ffmetadata"|"caf"|"aiff"|"au"|"voc"|"ircam"|"wav"|"w64")
            && super::super::ffmpeg_pcm::Format::parse(opts.format).is_none() && !encode_aac && encode_pcm.is_none() {
            return Err("Audio encoding is not supported for this codec".into());
        }
        if opts.audio_codec==Some("copy")
            && (matches!(&sources[j].2,Streams::Aac{..}) || matches!(&sources[j].2,Streams::Mp4(t) if t[i].0.tag==b"mp4a"))
            && (matches!(opts.format,"caf"|"aiff"|"au"|"voc"|"ircam"|"wav"|"w64") || super::super::ffmpeg_pcm::Format::parse(opts.format).is_some()) {
            return Err("AAC packet copying to PCM output is not supported".into());
        }
        let elementary=matches!(&sources[j].2,Streams::Elementary(doc) if (doc.format!="latm"&&!matches!(doc.tag,b"samr"|b"sawb")) || opts.audio_codec==Some("copy")) || matches!(&sources[j].2,Streams::Mp4(t) if t[i].0.tag==b"ac-3" || matches!(t[i].0.tag,b"samr"|b"sawb")&&opts.audio_codec==Some("copy"));
        if elementary && opts.audio_codec!=Some("copy") && opts.format!="ffmetadata" {
            return Err("Audio decoding is not supported for this codec".into());
        }
        if elementary && !matches!(opts.format,""|"mp4"|"mov"|"amr"|"latm"|"null"|"ffmetadata") {
            return Err("Elementary audio copying to this container is not supported".into());
        }
    }
    if matches!(opts.format,"amr"|"latm") && opts.audio_codec!=Some("copy") && !encode_aac {
        return Err("Audio encoding is not supported for this codec".into());
    }
    if opts.format == "latm" && opts.audio_codec == Some("copy")
        && selected.iter().any(|&(j, i)| sources[j].2.kind(i) == "audio" && !match &sources[j].2 {
            Streams::Aac { .. } => true,
            Streams::Mp4(t) => t[i].0.tag == b"mp4a",
            Streams::Elementary(d) => d.format == "latm",
            _ => false,
        }) {
        return Err("LATM output requires AAC audio".into());
    }
    if opts.format == "wv" {
        if selected.len()!=1 || sources[selected[0].0].2.kind(selected[0].1)!="audio" {return Err(super::super::ffmpeg_pcm::STREAMS_ERROR.into());}
        if opts.audio_codec.is_none() {opts.audio_codec=Some("wavpack");}
        if !matches!(opts.audio_codec,Some("copy"|"wavpack")) || opts.audio_codec==Some("copy") && !match &sources[selected[0].0].2 { Streams::Wavpack(_) => true, Streams::Mp4(tracks) => tracks[selected[0].1].0.tag == b"wvpk", _ => false } {
            return Err("WavPack output requires compressed WavPack packets".into());
        }
    }
    if !matches!(opts.format, "wv" | "nut" | "caf" | "aiff" | "au" | "voc" | "ircam" | "wav" | "w64" | "null" | "ffmetadata")
        && super::super::ffmpeg_pcm::Format::parse(opts.format).is_none()
        && !(opts.audio_codec == Some("wavpack") && matches!(opts.format,"mkv"|"webm"))
        && !encode_aac && encode_pcm.is_none()
        && selected.iter().any(|&(j, _)| match &sources[j].2 {Streams::Caf(_)|Streams::Voc(_)|Streams::Aiff(_)|Streams::Au(_)=>true,Streams::Wave(w)=>w.wav.raw.is_some(),_=>false})
    {
        return Err(format!("Raw audio conversion to {} is not supported", opts.format));
    }

    if let Some(codec @ ("microdvd" | "jacosub" | "realtext" | "sami")) = opts.subtitle_codec { return Err(format!("Unknown encoder '{codec}'")); }
    if opts.subtitle_codec == Some("ttml") && opts.format != "ttml" { return Err(super::super::lrc::MUX_ERROR.into()); }
    if opts.subtitle_codec != Some("copy") && opts.format != "ffmetadata" && let Some(decode) = opts.subtitle_decode {
        let mut decode = decode.borrow_mut();
        for &(j, _) in &selected {
            if let Streams::TextSubtitles(doc) = &sources[j].2 {
                let errors = doc.packets.iter().filter(|p| std::str::from_utf8(&p.data).is_err() || doc.format == "realtext" && super::super::smil_subtitles::realtext(&p.data).is_err() || doc.decoded.get(&p.pos).is_some_and(Result::is_err)).count();
                if errors > 0 && errors == doc.packets.len() { decode.0 = true; }
                for packet in &doc.packets {
                    if let Some(Err(reason)) = doc.decoded.get(&packet.pos) {
                        if reason.len() + 9 > opts.limit.saturating_sub(decode.1.len()) { return Err("output byte limit exceeded".into()); }
                        decode.1.push_str("ffmpeg: "); decode.1.push_str(reason); decode.1.push('\n');
                    }
                }
            }
        }
    }
    if opts.audio_codec == Some("copy")
        && !opts.audio_filters.is_empty()
        && !matches!(opts.format, "srt" | "webvtt" | "lrc" | "ass" | "ffmetadata")
        && selected.iter().any(|&(j, i)| sources[j].2.kind(i) == "audio")
    {
        return Err(AUDIO_COPY_FILTER_ERROR.into());
    }
    if selected.is_empty() && !matches!(opts.format, "null" | "ffmetadata") { return Err(super::super::lrc::NO_STREAM.into()); }
    if opts.format == "null" {
        if opts.audio_codec != Some("copy") {
            for &(j, i) in &selected {
                if let MediaInput::Bytes("aac"|"adts", original)=&inputs[j] {
                    super::super::aac::decode_adts(original,0,opts.limit)?;
                    continue;
                }
                match &sources[j].2 {
                    Streams::Elementary(doc) if matches!(doc.tag,b"samr"|b"sawb") => {doc.decode_amr(InputTime::default(),opts.limit)?;},
                    Streams::Mp4(tracks) if matches!(tracks[i].0.tag,b"samr"|b"sawb") => {tracks[i].0.decode_amr(&sources[j].0,tracks[i].1,InputTime::default(),opts.limit)?;},
                    Streams::Aac { .. } => { super::super::aac::decode_adts(&sources[j].0, 0, opts.limit)?; },
                    Streams::Elementary(doc) if doc.format == "latm" => { doc.decode_latm(0,opts.limit)?; },
                    Streams::Mp4(tracks) if tracks[i].0.tag == b"mp4a" => {
                        tracks[i].0.decode_aac(&sources[j].0, tracks[i].1, InputTime::default(), &[i], opts.limit)?;
                    },
                    Streams::Wave(w) if matches!(w.wav.tag,2|17|32) => {super::super::adpcm_wav::decode(w.wav,opts.limit)?;},
                    Streams::Wavpack(doc) => { doc.decode(opts.limit,super::super::ffmpeg_pcm::Format::Float(64,false))?; },
                    Streams::Mp4(tracks) if tracks[i].0.tag == b"wvpk" => {
                        let MediaInput::Bytes("mkv" | "webm", original) = &inputs[j] else { return Err("WavPack packets require their container description".into()); };
                        let movie = super::mkv_input::parse(original, opts.limit)?;
                        let encoded = movie.tracks[i].wavpack(opts.limit)?;
                        let remaining = opts.limit.saturating_sub(encoded.capacity());
                        super::super::wavpack::Document::read(&encoded,remaining)?.decode(remaining,super::super::ffmpeg_pcm::Format::Float(64,false))?;
                    },
                    _ => (),
                }
            }
        }
        return Ok(Vec::new());
    }
    if opts.format == "apng" {
        if opts.video_codec==Some("copy") {return Err("APNG output requires video encoding".into());}
        if opts.frames==Some(0) {return Ok(Vec::new());}
        let &(j,i)=selected.iter().find(|&&(j,i)|sources[j].2.kind(i)=="video").ok_or("No video frame in the requested presentation interval")?;
        let mut frames=Vec::new();let mut remaining=opts.limit;
        render_source(&sources[j],i,(&inputs[j],opts.input_times[j],inputs[j].decoded().or(opts.concat.as_deref())),None,
            y4m::Options {start:opts.start.unwrap_or(0.),end:opts.end,frames:opts.frames,filters:opts.video_filters,no_video:false,limit:remaining},true,
            |image,time| {remaining=remaining.checked_sub(image.pixels.len()*4+size_of::<(Raster,y4m::TimedFrame)>()).ok_or("APNG exceeds memory budget")?;frames.push((image,time));Ok(())})?;
        return super::super::apng::write(&frames,opts.apng_plays,remaining).map_err(str::to_owned);
    }
    if opts.format == "ico" {
        if opts.frames == Some(0) { return Ok(Vec::new()); }
        let mut images = Vec::new();
        let mut remaining = opts.limit;
        for &(j, i) in &selected {
            if sources[j].2.kind(i) != "video" { return Err("ICO output supports only video streams".into()); }
            render_source(&sources[j], i, (&inputs[j], opts.input_times[j], inputs[j].decoded().or(opts.concat.as_deref())), None,
                y4m::Options { start: opts.start.unwrap_or(0.), end: opts.end, frames: Some(1), filters: opts.video_filters, no_video: false, limit: remaining }, true,
                |image, _| { remaining = remaining.checked_sub(image.pixels.len() * 4).ok_or("image exceeds memory budget")?; images.push(image); Ok(()) })?;
        }
        if images.len() != selected.len() { return Err("No video frame in the requested presentation interval".into()); }
        return super::super::ico::write(&images, remaining).map_err(str::to_owned);
    }
    if opts.format == "ffmetadata" {
        return super::ffmetadata(
            &inputs[..sources.len()],
            &data,
            &opts,
        );
    }
    let end = shortest.map(|s| s.min(opts.end.unwrap_or(s))).or(opts.end);
    let range =
        (opts.start.is_some() || end.is_some()).then_some((opts.start.unwrap_or(0.).max(0.), end));
    let mut audio = Options {
        start: opts.start.unwrap_or(0.).max(0.),
        end,
        rate: opts.rate,
        channels: opts.channels,
        clear_samples: opts.rate.is_some()
            || opts.channels.is_some()
            || !opts.audio_filters.is_empty(),
        strip_audio: opts.strip_audio,
        limit: opts.limit,
    };
    if opts.format == "nut" {
        let mut pcm = Vec::new();
        for &(j,i) in &selected {
            let track = match &sources[j].2 {
                Streams::Nut(_, _) => { pcm.push(None); continue; },
                Streams::Wave(w) => super::super::nut::Track::wave(w.wav, opts.limit)?,
                Streams::Voc(doc) => super::super::nut::Track::wave(doc.wave(), opts.limit)?,
                Streams::Aiff(doc) => super::super::nut::Track::wave(doc.wave()?, opts.limit)?,
                Streams::Au(doc) => super::super::nut::Track::wave(ffmpeg_wave::Wave::raw(super::super::au::pcm(doc.encoding).ok_or("NUT output requires PCM audio streams")?, doc.data, doc.rate, doc.channels)?, opts.limit)?,
                Streams::Mp4(tracks) if tracks[i].0.pcm_format().is_some() => {
                    let t = &tracks[i].0;
                    let wave = Wave::raw(t.pcm_format().unwrap(), &[], t.audio_rate().unwrap_or(t.scale), u32::from(t.channels()))?;
                    let mut track = super::super::nut::Track::wave(wave, opts.limit)?;
                    if t.stats.count > opts.limit / size_of::<super::super::nut::Packet>() { return Err("NUT packets exceed memory budget".into()); }
                    track.packets.try_reserve_exact(t.stats.count).map_err(|_| "NUT packets exceed memory budget")?;
                    track.scale = t.scale;
                    track.duration = t.duration as f64;
                    for s in t.samples(sources[j].0.len()) {
                        if s.description != 1 { return Err("Changing PCM sample descriptions is not supported".into()); }
                        track.packets.push(super::super::nut::Packet {
                            data: sources[j].0[s.offset..s.offset + s.size as usize].into(), offset: s.offset,
                            pts: s.dts as i64 - t.origin as i64, ticks: f64::from(s.tick), key: true,
                        });
                    }
                    track
                },
                _ => return Err("NUT output requires PCM audio streams".into()),
            };
            pcm.push(Some(track));
        }
        let mut tracks = Vec::new();
        let mut remaining = opts.limit;
        for (n, &(j,i)) in selected.iter().enumerate() {
            let track = match &sources[j].2 { Streams::Nut(doc,_) => &doc.tracks[i], _ => pcm[n].as_ref().unwrap() };
            let converted = track.convert(opts.input_times.get(j).copied().unwrap_or_default(), &Remux { end, maps: &[], limit: remaining, hls: None, concat: None, ..opts })?;
            let used = converted.packets.capacity()*size_of::<super::super::nut::Packet>() + converted.packets.iter().map(|p|match &p.data { Cow::Owned(v)=>v.capacity(), _=>0 }).sum::<usize>();
            remaining = remaining.checked_sub(used).ok_or("NUT output exceeds memory budget")?;
            tracks.push(converted);
        }
        return super::super::nut::write(&tracks,remaining);
    }
    if opts.format=="wv" && opts.audio_codec==Some("copy") || matches!(opts.format, "caf" | "aiff" | "au" | "voc" | "ircam" | "wav" | "w64") || super::super::ffmpeg_pcm::Format::parse(opts.format).is_some() {
        if selected.len() != 1 || sources[selected[0].0].2.kind(selected[0].1) != "audio" {
            return Err(super::super::ffmpeg_pcm::STREAMS_ERROR.into());
        }
        opts.end = end;
        opts.maps = &[]; // mapped_tracks has already resolved selectors across all inputs.
        let (j, i) = selected[0];
        if opts.audio_codec != Some("copy") && let Some(pcm) = inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c| c.audio.get(&i)) {
            return ffmpeg_wave::Input::Wave(pcm.wave()).render(opts.input_times.get(j).copied().unwrap_or_default(), &opts);
        }
        let (bytes, movie, stream) = &sources[j];
        let seek = opts.input_times.get(j).copied().unwrap_or_default();
        if let MediaInput::Bytes("aac" | "adts", original) = &inputs[j] {
            if opts.audio_codec == Some("copy") {return Err("AAC packet copying to PCM output is not supported".into());}
            let (rate, channels, pcm) = super::super::aac::decode_adts(original, seek.loops, opts.limit)?;
            let wave = ffmpeg_wave::Wave::raw(super::super::ffmpeg_pcm::Format::Float(32,false), &pcm, rate, channels)?;
            return ffmpeg_wave::Input::Wave(wave).render(InputTime{loops:0,..seek}, &Remux{limit:opts.limit.saturating_sub(pcm.capacity()),..opts});
        }
        match stream {
            Streams::Nut(doc,_) => return doc.tracks[i].render_audio(seek,&opts),
            Streams::Wavpack(doc) => return doc.render(seek,&opts),
            Streams::Caf(doc) => return doc.render(seek,&opts),
            Streams::Voc(doc) => return ffmpeg_wave::Input::Wave(doc.wave()).render(seek,&opts),
            Streams::Aiff(doc) => {
                let mut metadata=if opts.strip_metadata {Vec::new()}else{doc.tags.iter().filter(|(k,_)|!super::super::aiff::METADATA_FIELDS.contains(&k.as_str())).chain(doc.tags.iter().filter(|(k,_)|super::super::aiff::METADATA_FIELDS.contains(&k.as_str()))).cloned().collect()};
                if opts.format=="wav"&&!opts.bitexact {metadata.push(("encoder".into(),"Lavf61.7.100".into()));}
                metadata.extend_from_slice(opts.metadata);
                return doc.render(seek,&Remux { metadata: &metadata, ..opts });
            }
            Streams::Au(doc) => {
                let mut metadata=if opts.strip_metadata {Vec::new()}else{doc.tags.iter().map(|(k,v)|(k.clone(),v.clone())).collect::<Vec<_>>()};
                metadata.extend_from_slice(opts.metadata);
                return doc.render(seek,&Remux { metadata: &metadata, ..opts });
            }
            Streams::Wave(w) => return ffmpeg_wave::Input::Wave(w.wav).render(seek, &opts),
            Streams::GeneratedAudio(_) => {
                return ffmpeg_wave::Input::parse("lavfi", bytes)?
                    .ok_or("invalid audio generator")?
                    .render(seek, &opts);
            }
            Streams::Aac { .. } | Streams::Elementary(_) => {
                let (rate,channels,pcm)=if let Streams::Elementary(doc)=stream {if matches!(doc.tag,b"samr"|b"sawb") {doc.decode_amr(seek,opts.limit)?}else{doc.decode_latm(seek.loops,opts.limit)?}}else{super::super::aac::decode_adts(bytes,seek.loops,opts.limit)?};
                let wave=ffmpeg_wave::Wave::raw(super::super::ffmpeg_pcm::Format::Float(32,false),&pcm,rate,channels)?;
                return ffmpeg_wave::Input::Wave(wave).render(if matches!(stream,Streams::Elementary(doc) if matches!(doc.tag,b"samr"|b"sawb")) {InputTime::default()}else{InputTime{loops:0,..seek}},&Remux{limit:opts.limit.saturating_sub(pcm.capacity()),..opts});
            },
            Streams::Mp4(t) => {
                let (track, _) = &t[i];
                if track.pcm_format().is_some() && matches!(inputs[j],MediaInput::Bytes("mp4"|"mov",_)|MediaInput::Joined(..)) {
                    let original=match &inputs[j] {MediaInput::Bytes(_,bytes)|MediaInput::Joined(bytes,_)=>bytes.as_slice(),_=>unreachable!()};
                    let (tracks,_)=super::read_tracks(original,super::movie(original)?)?;
                    let track=&tracks[i];
                    let mut packets=Vec::new();
                    let (pcm,frames)=if opts.audio_codec==Some("copy") {
                        let size=track.samples(original.len()).try_fold(0usize,|n,s|n.checked_add(s.size as usize))
                            .filter(|&n|n<=opts.limit).ok_or("PCM decoding exceeds memory budget")?;
                        let count=track.samples(original.len()).count();
                        count.checked_mul(size_of::<ffmpeg_wave::Packet>()).and_then(|n|n.checked_add(size))
                            .filter(|&n|n<=opts.limit).ok_or("PCM packet index exceeds memory budget")?;
                        packets.reserve_exact(count);
                        let mut pcm=Vec::with_capacity(size);
                        for s in track.samples(original.len()) {
                            if s.description!=1 {return Err("Changing PCM sample descriptions is not supported".into());}
                            packets.push(ffmpeg_wave::Packet{pos:pcm.len(),size:s.size as usize,pts:s.dts});
                            pcm.extend_from_slice(&original[s.offset..s.offset+s.size as usize]);
                        }
                        (pcm,Vec::new())
                    }else{
                        track.decode_pcm(original,seek,if seek.loops>0 {super::pcm_loop_duration(original, &[i], None)?}else{0.},opts.limit)?
                    };
                    let mut wave=ffmpeg_wave::Wave::raw(track.pcm_format().ok_or("Invalid PCM sample description")?,&pcm,track.audio_rate().ok_or("Invalid PCM sample rate")?,u32::from(track.channels()))?;
                    let order = track.channel_order();
                    wave.channel_mask=super::super::audio_remix::order_mask(&order);
                    if wave.channel_mask == 0 { wave.channel_order=&order; }
                    wave.packet_frames=Some(1024);
                    wave.packets=&packets;
                    wave.frames=&frames;
                    let mut seek=if opts.audio_codec==Some("copy") {seek}else{InputTime::default()};
                    if !packets.is_empty() {seek.start=seek.start.map(|start|start.min((pcm.len()/wave.stride()).saturating_sub(1) as f64/f64::from(wave.rate)));}
                    return ffmpeg_wave::Input::Wave(wave).render(seek,&Remux{limit:opts.limit.saturating_sub(pcm.capacity()+packets.capacity()*size_of::<ffmpeg_wave::Packet>()+frames.capacity()*size_of::<ffmpeg_wave::Frame>()+order.capacity()*size_of::<u16>()),..opts});
                }
                if track.tag == b"wvpk" {
                    let MediaInput::Bytes("mkv" | "webm", original) = &inputs[j] else { return Err("WavPack packets require their container description".into()); };
                    let movie = super::mkv_input::parse(original, opts.limit)?;
                    let encoded = movie.tracks[i].wavpack(opts.limit)?;
                    let doc = super::super::wavpack::Document::read(&encoded, opts.limit.saturating_sub(encoded.capacity()))?;
                    return doc.render(seek, &Remux {limit:opts.limit.saturating_sub(encoded.capacity()),..opts});
                }
                if matches!(track.tag,b"samr"|b"sawb") && opts.audio_codec!=Some("copy") {
                    let original=match &inputs[j] {MediaInput::Bytes(_,bytes)|MediaInput::Joined(bytes,_)=>bytes.as_slice(),_=>bytes};
                    let original_movie=super::movie(original)?;let (tracks,_)=super::read_tracks(original,original_movie)?;
                    let original_trak=super::atoms(original_movie).filter(|(tag,_)|*tag==b"trak").nth(i).ok_or("Missing AMR track")?.1;
                    let pcm=tracks[i].decode_amr(original,original_trak,seek,opts.limit)?;
                    let wave=ffmpeg_wave::Wave::raw(super::super::ffmpeg_pcm::Format::Float(32,false),&pcm,tracks[i].audio_rate().ok_or("Missing AMR sample rate")?,1)?;
                    return ffmpeg_wave::Input::Wave(wave).render(InputTime::default(),&Remux{limit:opts.limit.saturating_sub(pcm.capacity()),..opts});
                }
                if track.tag == b"mp4a" && opts.audio_codec != Some("copy") {
                    let original = match &inputs[j] { MediaInput::Bytes("mp4" | "mov", bytes) | MediaInput::Joined(bytes, _) => bytes.as_slice(), _ => bytes };
                    let original_movie = super::movie(original)?;
                    let (tracks, _) = super::read_tracks(original, original_movie)?;
                    let original_trak = super::atoms(original_movie).filter(|(tag,_)| *tag==b"trak").nth(i).ok_or("Missing AAC track")?.1;
                    let (rate, channels, pcm, frames) = tracks[i].decode_aac(original, original_trak, seek, &[i], opts.limit)?;
                    let mut wave = ffmpeg_wave::Wave::raw(super::super::ffmpeg_pcm::Format::Float(32, false), &pcm, rate, channels)?;
                    wave.frames = &frames;
                    let mut metadata = if opts.strip_metadata { Vec::new() } else { super::text_tags(movie).map(|(k,v)|(k.to_owned(),v)).collect() };
                    if opts.format == "wav" && !opts.bitexact {metadata.push(("encoder".into(),"Lavf61.7.100".into()));}
                    metadata.extend_from_slice(opts.metadata);
                    return ffmpeg_wave::Input::Wave(wave).render(InputTime::default(), &Remux {metadata:&metadata,limit:opts.limit.saturating_sub(pcm.capacity()+frames.capacity()*size_of::<ffmpeg_wave::Frame>()),..opts});
                }
                if track.tag == b"alac" && opts.audio_codec != Some("copy") {
                    // Decode original packets before seeking in PCM; packet cuts can shorten their durations.
                    let original = match &inputs[j] { MediaInput::Bytes(_, bytes) | MediaInput::Joined(bytes, _) => bytes.as_slice(), _ => bytes };
                    let original_movie = super::movie(original)?;
                    let (tracks, _) = super::read_tracks(original, original_movie)?;
                    let track = &tracks[i];
                    let config = track.alac_config()?;
                    let pcm = config.decode(track.samples(original.len()).map(|s| (&original[s.offset..s.offset + s.size as usize], s.tick)), opts.limit)?;
                    let mut wave = ffmpeg_wave::Wave::raw(super::super::ffmpeg_pcm::Format::Signed(32, false), &pcm, config.rate, config.channels as u32)?;
                    wave.channel_mask = if config.channels == 2 { 3 } else { 4 };
                    let mut metadata = if opts.strip_metadata { Vec::new() } else { super::text_tags(movie).map(|(k, v)| (k.to_owned(), v)).collect() };
                    if opts.format == "wav" && !opts.bitexact { metadata.push(("encoder".into(), "Lavf61.7.100".into())); }
                    metadata.extend_from_slice(opts.metadata);
                    return ffmpeg_wave::Input::Wave(wave).render(seek, &Remux { metadata: &metadata, limit: opts.limit.saturating_sub(pcm.capacity()), ..opts });
                }
                if matches!(track.original, Original::Avi(_) | Original::Matroska(_)) && track.tag == b"sowt"
                    || matches!(inputs[j], MediaInput::Joined(..)) && matches!(track.tag, b"\x01\0\0\0" | b"\x03\0\0\0" | b"\x06\0\0\0" | b"\x07\0\0\0") && opts.audio_codec == Some("copy")
                {
                    let failed_seek = super::super::ffmpeg_pcm::Format::parse(opts.format).is_some() && seek.start.is_some_and(|s| s != 0.) && inputs[j].decoded().and_then(|c| c.timings.as_ref())
                        .is_some_and(|times| times.iter().any(|(cut, duration)| duration.is_none() && cut.start.zip(cut.to).is_none()));
                    let range = if failed_seek {
                        let offset = seek.start.unwrap_or(0.);
                        let end = opts.end.map(|s| s + offset).into_iter().chain(seek.end()).reduce(f64::min);
                        Some((opts.start.map_or(0., |s| s + offset), end))
                    } else { range };
                    // Failed concat seeking discards the packet read during
                    // probing, while output seeks retain the requested offset.
                    let discarded = failed_seek.then(|| track.samples(bytes.len()).next().map(|s| s.offset)).flatten();
                    let packets = || cut_packets(track, bytes, range, false, (opts.audio_codec == Some("copy")).then_some(false), 0).3
                        .filter(|s| Some(s.offset) != discarded);
                    let size = packets().try_fold(0usize, |n, s| n.checked_add(s.size as usize))
                        .filter(|&n| n <= opts.limit).ok_or("audio output exceeds memory budget")?;
                    let mut data = Vec::with_capacity(size);
                    for s in packets() {
                        data.extend_from_slice(&bytes[s.offset..s.offset + s.size as usize]);
                    }
                    let wave = ffmpeg_wave::Wave {
                        block_align: 0, fmt: &[],
                        rate: track.original.matroska().and_then(|t| t.sample_rate).unwrap_or(track.scale),
                        channels: usize::from(track.channels()), bits: if track.tag == b"sowt" {16} else {u16_at(track.entry,18)},
                        tag: if track.tag == b"sowt" {1} else {u16::from(track.tag[0])},
                        data: &data, data_pos: 0, truncated: false, fact: None, channel_mask: 0, channel_order: &[], raw: None, packet_frames: None, packets: &[], frames: &[],
                    };
                    return ffmpeg_wave::Input::Wave(wave).render(InputTime::default(), &Remux { start: None, end: None, limit: opts.limit.saturating_sub(data.capacity()), ..opts });
                }
            }
            _ => unreachable!(),
        }
        return Err("Audio decoding is not supported for this codec".into());
    }
    if opts.format == "aac" {
        if selected.len() != 1 || sources[selected[0].0].2.kind(selected[0].1) != "audio" { return Err("ADTS output requires one audio stream".into()); }
        if let Some(codec) = opts.audio_codec && !matches!(codec, "aac" | "copy") { return Err("ADTS output requires AAC audio".into()); }
        if opts.audio_codec == Some("copy") && selected.iter().any(|&(j,i)| sources[j].2.kind(i) == "audio" && !matches!(&sources[j].2, Streams::Aac {..}) && !matches!(&sources[j].2, Streams::Mp4(t) if t[i].0.tag==b"mp4a")) { return Err("ADTS output requires AAC audio".into()); }
        if encode_aac && let Some(&(j, i)) = selected.iter().find(|&&(j,i)| sources[j].2.kind(i) == "audio")
            && (inputs[j].decoded().or(opts.concat.as_deref()).is_some_and(|c| c.audio.contains_key(&i)) || opts.audio_codec == Some("aac") || audio.clear_samples || matches!(sources[j].2, Streams::Wave(_) | Streams::GeneratedAudio(_) | Streams::Elementary(_)) || matches!(&sources[j].2, Streams::Mp4(t) if matches!(t[i].0.tag,b"samr"|b"sawb") || t[i].0.pcm_format().is_some())) {
            let limit = opts.limit;
            let track = aac_track(inputs, &mut opts, (j,i), &sources[j].2, &selected, scale, limit, shortest)?;
            if track.samples.is_empty() { return Ok(Vec::new()); }
            let retained = track.samples.capacity() * size_of::<Sample>() + track.samples.iter().map(|s| match &s.data { Cow::Owned(v)=>v.capacity(), _=>0 }).sum::<usize>();
            return Options { clear_samples: false, rate: None, channels: None, limit: audio.limit.saturating_sub(retained), ..audio }.encode(track.scale, u32::from(u16_at(&track.stsd, 32)), track.samples.iter().map(|s|s.data.as_ref())).map_err(str::to_owned);
        }
        for &(j, i) in &selected {
            let (input, _, streams) = &sources[j];
            match streams {
                Streams::Wave(w) => {
                    let t = w.track(opts.input_times.get(j).copied().unwrap_or_default(), &audio, opts.start, scale, opts.limit)?;
                    return audio
                        .encode(
                            w.wav.rate,
                            w.wav.channels as u32,
                            t.samples.iter().map(|s| s.data.as_ref()),
                        )
                        .map_err(str::to_owned);
                }
                Streams::GeneratedAudio(a) => {
                    let t = a.track(&audio, scale, opts.limit)?;
                    return audio
                        .encode(
                            a.rate,
                            a.channels,
                            t.samples.iter().map(|s| s.data.as_ref()),
                        )
                        .map_err(str::to_owned);
                }
                Streams::Mp4(v) if v[i].0.kind == "audio" => {
                    if let Some(pcm) = inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c| c.audio.get(&i)) {
                        audio.rate.get_or_insert(pcm.rate);
                        audio.channels.get_or_insert(pcm.channels as u32);
                    }
                    return v[i].0.extract_adts(input, &audio).map_err(str::to_owned);
                }
                Streams::Aac { rate, channels, .. } => {
                    return super::super::adts::remux(input, *rate, *channels, &audio)
                        .map_err(str::to_owned);
                }
                _ => {}
            }
        }
        audio.strip_audio = true;
        return audio
            .encode(44100, 2, std::iter::empty())
            .map_err(str::to_owned);
    }
    if matches!(opts.format, "srt" | "webvtt" | "lrc" | "ass" | "microdvd" | "ttml") {
        if opts.format == "microdvd" && opts.subtitle_codec.is_none() { return Err(if opts.maps.is_empty() { super::super::lrc::NO_STREAM } else { "Automatic encoder selection failed" }.into()); }
        if opts.format == "microdvd" && opts.subtitle_codec != Some("copy") { return Err(super::super::lrc::MUX_ERROR.into()); }
        if opts.format == "ass" && opts.subtitle_codec.is_some_and(|codec| !matches!(codec, "ass" | "ssa" | "copy")) { return Err(super::super::lrc::MUX_ERROR.into()); }
        if opts.format == "ttml" && let Some(codec) = opts.subtitle_codec
            && !matches!(codec, "ttml" | "copy" | "subrip" | "srt" | "webvtt" | "ass" | "ssa" | "mov_text" | "dvdsub" | "dvbsub" | "xsub") { return Err(format!("Unknown encoder '{codec}'")); }
        if opts.format == "ttml" && (opts.subtitle_codec.is_some_and(|c| c != "ttml") || selected.len() != 1) { return Err(super::super::lrc::MUX_ERROR.into()); }
        let mut writer = super::super::subtitles::Writer::new(opts.format, opts.limit);
        let mut language = "";
        if !selected.iter().any(|&(j, i)| sources[j].2.kind(i) == "subtitle") { return Err(super::super::lrc::NO_STREAM.into()); }
        if opts.format == "microdvd" && (selected.len() != 1 || !matches!(&sources[selected[0].0].2, Streams::TextSubtitles(doc) if doc.format == "microdvd")) { return Err(super::super::lrc::MUX_ERROR.into()); }
        if opts.format == "lrc" {
            let mut tags: Vec<_> = if let Streams::TextSubtitles(doc) = &sources[0].2 { doc.tags.clone() } else if matches!(inputs[0], MediaInput::Bytes("mp4" | "mov", _)) {
                super::tags(sources[0].0, sources[0].1).into_iter().filter_map(|(key, value)| {
                    if let super::super::super::structured::JVal::Str(value) = value { Some((key, value)) } else { None }
                }).collect()
            } else { super::text_tags(sources[0].1).map(|(k, v)| (k.to_owned(), v)).collect() };
            for (key, value) in opts.metadata {
                if let Some((_, old)) = tags.iter_mut().find(|(k, _)| k == key) { *old = value.clone(); }
                else { tags.push((key.clone(), value.clone())); }
            }
            writer.output = super::super::lrc::header(&tags, opts.bitexact, opts.limit)?;
        }
        for (j, i) in selected {
            match &sources[j].2 {
                Streams::Mp4(v) if v[i].0.kind == "subtitle" => {
                    language = if matches!(inputs[j], MediaInput::Bytes("mov", _)) && v[i].0.language == "und" { "" } else { &v[i].0.language };
                    if opts.format == "ass" && opts.subtitle_codec == Some("copy") && v[i].0.tag != b"ass " { return Err(super::super::lrc::MUX_ERROR.into()); }
                    if let Some(track) = v[i].0.original.matroska()
                        && (range.is_none() || matches!(opts.format, "ass" | "ttml"))
                    {
                        let scale = f64::from(track.info.scale);
                        language = if track.info.language == "und" { "" } else { &track.info.language };
                        let mut shift = None;
                        let mut header_budget = opts.limit;
                        let header = if matches!(track.info.codec, super::super::media_probe::Codec::Subtitle { name: "ass" }) {
                            let mut doc = super::super::ass::read(track.private, &mut header_budget)?;
                            if opts.format == "ass" {
                                doc.time_base = (1, 1000);
                                for b in &track.blocks {
                                    header_budget = header_budget.checked_sub(size_of::<super::super::lrc::Packet>() + b.data.len()).ok_or("subtitle packets exceed memory budget")?;
                                    doc.packets.push(super::super::lrc::Packet {
                                        pts: (b.dts as f64 / scale * 1000.).round() as i64,
                                        duration: (b.ticks / scale * 1000.).round() as i64,
                                        pos: 0, data: b.data.to_vec(),
                                    });
                                }
                                writer.output = doc.convert("ass", opts.subtitle_codec == Some("copy"), 0., (opts.start, end), opts.limit)?;
                                break;
                            }
                            doc.ass_header
                        } else { None };
                        for b in &track.blocks {
                            let bytes = if track.codec_id.starts_with("D_WEBVTT/") {
                                b.data.splitn(3, |&b| b == b'\n').nth(2).ok_or("invalid Matroska WebVTT packet")?
                            } else { b.data };
                            let text = String::from_utf8_lossy(bytes);
                            let text = if opts.format == "ttml" {
                                Cow::Owned(if matches!(track.info.codec, super::super::media_probe::Codec::Subtitle { name: "ass" }) { text.splitn(9, ',').nth(8).unwrap_or("").to_owned() }
                                else { super::super::ttml::caption(&text, track.codec_id.contains("WEBVTT"), opts.limit)? })
                            } else if matches!(track.info.codec, super::super::media_probe::Codec::Subtitle { name: "ass" }) {
                                Cow::Owned(super::super::lrc::decode_ass(text.splitn(9, ',').nth(8).unwrap_or(""), opts.format == "webvtt", header.as_ref().map(|h| (h, text.split(',').nth(2).unwrap_or("")))))
                            } else if track.codec_id == "S_TEXT/UTF8" {
                                Cow::Owned(super::super::lrc::encode_text(&text, false))
                            } else if matches!(track.info.codec, super::super::media_probe::Codec::Subtitle { name: "webvtt" }) {
                                Cow::Owned(super::super::lrc::encode_text(&text, true))
                            } else { text };
                            let seek = if opts.format == "ttml" { (opts.input_times.get(j).and_then(|s| s.start).unwrap_or(0.) * 1000.).round() as i64 } else { 0 };
                            let pts = ((b.dts as f64 / scale * 1000.).round() as i64).saturating_sub(seek);
                            if opts.format == "ttml" && (opts.start.is_some_and(|s| pts < (s * 1000.).round() as i64) || opts.end.is_some_and(|e| pts >= (e * 1000.).round() as i64)) { continue; }
                            let shift = if opts.format == "ttml" { *shift.get_or_insert(pts.min(0).saturating_neg()) } else { 0 };
                            writer.cue(pts.saturating_add(shift), (((b.dts as f64 + b.ticks) / scale * 1000.).round() as i64).saturating_sub(seek).saturating_add(shift), &text)?;
                        }
                        break;
                    }
                    v[i].0.write_subtitles(
                        sources[j].0,
                        &mut writer,
                        (opts.start, end),
                        if matches!(inputs[j], MediaInput::Bytes("mp4" | "mov", _)) {
                            opts.input_times.get(j).copied().unwrap_or_default()
                        } else { InputTime::default() },
                    )?
                }
                Streams::TextSubtitles(doc) => {
                    let output = doc.convert(opts.format, opts.subtitle_codec == Some("copy"),
                        opts.input_times.get(j).and_then(|s| s.start).unwrap_or(0.), (opts.start, end),
                        if opts.format == "lrc" { opts.limit.saturating_sub(writer.output.len()) } else { opts.limit })?;
                    if opts.format == "lrc" { writer.output.push_str(&output); }
                    else { writer.output = output; }
                }
                Streams::Captions(text) => {
                    if opts.format == "ass" && opts.subtitle_codec == Some("copy") { return Err(super::super::lrc::MUX_ERROR.into()); }
                    if matches!(opts.format, "lrc" | "ass" | "ttml") {
                        let webvtt = matches!(inputs[j], MediaInput::Bytes("webvtt", _));
                        let seek = (opts.input_times.get(j).and_then(|s| s.start).unwrap_or(0.) * 1000.).round() as i64;
                        let start = (opts.start.unwrap_or(0.) * 1000.).round() as i64;
                        let end = opts.end.map(|n| (n * 1000.).round() as i64);
                        let mut shift = None;
                        let skip = if opts.format == "ttml" && opts.input_times.get(j).is_some_and(|s| s.start.is_some()) {
                            let mut timings = Vec::new();
                            for cue in super::super::subtitles::cues(text, true) {
                                if timings.len() >= opts.limit / size_of::<(i64, i64)>() { return Err("subtitle timings exceed memory budget".into()); }
                                timings.push((cue.start, cue.duration));
                            }
                            super::super::subtitles::seek_index(&timings, seek, |&t| t)
                        } else { 0 };
                        for cue in super::super::subtitles::cues(text, true).skip(skip) {
                            if opts.format != "ttml" && cue.start.saturating_add(cue.duration) <= seek { continue; }
                            let pts = cue.start.saturating_sub(seek);
                            if opts.start.is_some() && pts < start || end.is_some_and(|end| pts >= end) { continue; }
                            let text = if opts.format == "ttml" { super::super::ttml::caption(&cue.text, webvtt, opts.limit)? } else if opts.subtitle_codec == Some("copy") { cue.text } else { super::super::lrc::encode_text(&cue.text, webvtt) };
                            let pts = if opts.format == "ttml" { pts.saturating_add(*shift.get_or_insert(pts.min(0).saturating_neg())) } else { pts };
                            writer.cue(pts, pts.saturating_add(cue.duration), &text)?;
                        }
                    } else { super::super::subtitles::convert(text, &mut writer, range)?; }
                }
                _ => continue,
            }
            break;
        }
        if opts.format == "ttml" { return super::super::ttml::document(&writer.output, opts.subtitle_language.unwrap_or(language), opts.limit).map_err(str::to_owned); }
        return Ok(writer.output.into_bytes());
    }
    let temporal = opts
        .video_filters
        .iter()
        .flat_map(|f| f.split(|c: char| !c.is_ascii_alphanumeric() && c != '_'))
        .any(|word| {
            ["fps", "select", "reverse", "trim", "tile", "setpts"]
                .iter()
                .any(|name| word.eq_ignore_ascii_case(name))
        });
    let mut tracks = Vec::new();
    // A manifest describes the presentation timeline. Packet durations can include
    // preroll hidden by edits, and applying filters leaves the movie duration intact.
    let mut stream_seconds: Vec<_> = selected.iter().filter(|_| matches!(opts.format, "dash" | "hls"))
        .map(|&source| presentation_duration(sources, &[source], scale, range)).collect();
    let stream_duration = stream_seconds.iter().copied().fold(0., f64::max);
    let mut index_bytes = 0usize;
    for (ordinal, &(j, i)) in selected.iter().enumerate() {
        let (input, _, source) = &sources[j];
        if let Some(format)=encode_pcm && source.kind(i)=="audio" {
            let available=opts.limit.saturating_sub(index_bytes);
            let (rate,channels)=if let Some(pcm)=inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c|c.audio.get(&i)) {(pcm.rate,pcm.channels as u32)}else{match source {
                Streams::Mp4(t)=>(t[i].0.audio_rate().unwrap_or(t[i].0.scale),u32::from(t[i].0.channels())),
                Streams::Wave(w)=>(w.wav.rate,w.wav.channels as u32),Streams::GeneratedAudio(a)=>(a.rate,a.channels),
                Streams::Aac{rate,channels,..}=>(*rate,u32::from(*channels)),Streams::Elementary(d)=>(d.rate,d.channels),
                Streams::Wavpack(d)=>(d.rate,d.channels),Streams::Caf(d)=>(d.rate,d.channels),
                Streams::Voc(d)=>(d.rate,d.channels as u32),Streams::Aiff(d)=>(d.rate,d.channels as u32),Streams::Au(d)=>(d.rate,d.channels),
                Streams::Nut(d,_)=>(d.tracks[i].rate,d.tracks[i].channels),_=>unreachable!(),
            }};
            let rate=opts.rate.unwrap_or(rate);let channels=opts.channels.unwrap_or(channels);
            let mut order = if opts.channels.is_some() { Vec::new() }
                else if let Some(pcm) = inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c|c.audio.get(&i)) { pcm.channel_order.clone() }
                else if let Streams::Mp4(t) = source { t[i].0.channel_order() } else { Vec::new() };
            let mask = if opts.channels.is_some() { 0 } else if let Some(pcm)=inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c|c.audio.get(&i)) { pcm.channel_mask } else { match source {
                Streams::Mp4(_) => super::super::audio_remix::order_mask(&order), Streams::Wave(w) => w.wav.channel_mask,
                Streams::Wavpack(d) => d.channel_mask, Streams::Caf(d) => d.channel_mask(),
                Streams::Aiff(d) => d.channel_mask, _ => 0,
            }};
            if order.is_empty() {
                let mask = if mask == 0 { super::super::audio_remix::default_mask(channels as usize) } else { mask };
                order = (0..32).filter(|&i| mask & (1 << i) != 0).collect();
            }
            let stsd=pcm_entry(format,rate,channels,&order,opts.format=="mov")?;
            let raw=format.name();let selector=format!("{j}:{i}");let maps=[selector.as_str()];
            let seek = opts.input_times.get(j).copied().unwrap_or_default();
            let original_pcm = if let Streams::Mp4(t) = source && (t[i].0.pcm_format().is_some() || t[i].0.tag == b"mp4a")
                && !inputs[j].decoded().or(opts.concat.as_deref()).is_some_and(|c| c.audio.contains_key(&i))
                && let MediaInput::Bytes("mp4" | "mov", bytes) = &inputs[j] {
                Some((bytes.as_slice(), super::read_tracks(bytes, super::movie(bytes)?)?.0))
            } else { None };
            let input_order = original_pcm.as_ref().map_or_else(Vec::new, |(_, tracks)| tracks[i].channel_order());
            let available = available.saturating_sub(input_order.capacity() * size_of::<u16>());
            let timed_pcm = if let Streams::Wave(w) = source && w.wav.frames.is_empty() && w.wav.packets.is_empty() && !matches!(w.wav.tag, 2 | 17 | 32) {
                Some(w.wav.loop_pcm(seek, available)?)
            } else if let Some((bytes, tracks)) = &original_pcm {
                let track = &tracks[i];
                if track.tag == b"mp4a" {
                    let trak = super::atoms(super::movie(bytes)?).filter(|(tag,_)| *tag == b"trak").nth(i).ok_or("Missing AAC track")?.1;
                    let selected: Vec<_> = selected.iter().filter(|(k,_)| *k == j).map(|&(_,i)| i).collect();
                    let (_, _, pcm, frames) = track.decode_aac(bytes, trak, seek, &selected, available)?;
                    Some((pcm, frames))
                } else {
                    Some(track.decode_pcm(bytes, seek, if seek.loops > 0 { super::pcm_loop_duration(bytes, &[], None)? } else { 0. }, available)?)
                }
            } else { None };
            let available = available.saturating_sub(timed_pcm.as_ref().map_or(0, |(data, frames)| data.capacity() + frames.capacity() * size_of::<ffmpeg_wave::Frame>()));
            let render=Remux{format:&raw,maps:&maps,strip_video:true,strip_subtitles:true,composition:None,shortest:false,limit:available,hls:None,concat:None,..opts};
            let wave = if let Streams::Wave(w) = source { Some(w.wav) } else { None };
            let wave = if let Some((data, _)) = &timed_pcm && let Some((_, tracks)) = &original_pcm {
                let track = &tracks[i];
                let mut wave = Wave::raw(track.pcm_format().unwrap_or(super::super::ffmpeg_pcm::Format::Float(32, false)), data, track.audio_rate().unwrap(), u32::from(track.channels()))?;
                wave.channel_mask = super::super::audio_remix::order_mask(&input_order);
                if wave.channel_mask == 0 { wave.channel_order = &input_order; }
                Some(wave)
            } else { wave };
            let wave = wave.map(|wave| if let Some((data, frames)) = &timed_pcm { Wave { data, frames, ..wave } } else { wave });
            let pcm=if let Some(mut wave)=wave {
                wave.raw=Some(wave.format());
                let seek = if timed_pcm.is_some() { InputTime::default() } else { seek };
                ffmpeg_wave::Input::Wave(wave).render(seek,&Remux{maps:&[],..render})?
            }else if let Streams::GeneratedAudio(a)=source {
                let Some(ffmpeg_wave::Input::Generated{frequency,duration,..})=ffmpeg_wave::Input::parse("lavfi",input)? else{return Err("Invalid audio generator".into());};
                let seek=opts.input_times.get(j).copied().unwrap_or_default();
                let frames=(seek.generation_end(opts.source_end).unwrap_or(duration)*f64::from(a.rate)).round().max(0.) as usize;
                let pcm=super::super::lavfi::sine(frequency,a.rate,a.channels as usize,frames,available)?;
                let wave=Wave::raw(super::super::ffmpeg_pcm::Format::Signed(16,false),&pcm,a.rate,a.channels)?;
                ffmpeg_wave::Input::Wave(wave).render(seek,&Remux{maps:&[],limit:available.saturating_sub(pcm.capacity()),..render})?
            }else{remux(inputs,Remux{concat:opts.concat.as_deref_mut(),..render},0,&mut Vec::new())?};
            let stride=channels as usize*usize::from(format.bits()/8);
            let wave = wave.filter(|w| !w.frames.is_empty()).or_else(|| inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c| c.audio.get(&i)).map(|pcm| pcm.wave()));
            let count = pcm.len() / stride;
            let frames = wave.into_iter().flat_map(|wave| {
                let full = ((wave.data.len() / wave.stride()) as f64 * f64::from(rate) / f64::from(wave.rate)).ceil() as usize;
                wave.output_frames(rate, full, opts.start, opts.end)
            }).chain((0..count).step_by(1024).take(if wave.is_some() { 0 } else { usize::MAX })
                .map(|start| (start..(start + 1024).min(count), start as i128)));
            let shortest = if opts.shortest && original_pcm.as_ref().is_some_and(|(_,t)| t[i].tag == b"mp4a") {
                // A decoded AAC tail can extend past its compressed duration.
                // Only the other selected streams can shorten this audio.
                selected.iter().filter(|&&(k,n)| (k,n) != (j,i)).map(|&(k,n)| sources[k].2.seconds(n)).reduce(f64::min)
            } else { shortest };
            let end = shortest.map(|end| ((end - opts.start.unwrap_or(0.)).max(0.) * f64::from(rate)).round() as usize);
            let mut samples: Vec<Sample> = Vec::new();
            let (mut ticks, mut duration, mut previous, mut cost, mut first) = (0usize, 0i128, None, 0usize, 0i128);
            for (range, pts) in frames {
                let kept = range.len().min(count - ticks);
                if kept == 0 || end.is_some_and(|end| pts + kept as i128 > end as i128) { break; }
                let dts = previous.map_or(pts, |last: i128| pts.max(last + 1));
                if samples.is_empty() { first = dts; }
                if let Some(last) = samples.last_mut() {
                    last.duration = u32::try_from(dts - previous.unwrap()).map_err(|_|"audio duration exceeds limit")?;
                }
                cost = cost.checked_add(kept * stride + size_of::<Sample>()).filter(|&n|n<=available.saturating_sub(pcm.capacity())).ok_or("PCM output exceeds memory budget")?;
                samples.try_reserve_exact(1).map_err(|_|"PCM output exceeds memory budget")?;
                samples.push(Sample { data:pcm[ticks * stride..(ticks + kept) * stride].to_vec().into(), duration:kept.try_into().map_err(|_|"audio duration exceeds limit")?,cts:0,key:true,description:1 });
                ticks += kept;
                duration = dts.checked_add(kept as i128).ok_or("audio duration exceeds limit")?;
                previous = Some(dts);
            }
            if samples.is_empty() { continue; }
            let ticks = u32::try_from(ticks).map_err(|_|"audio duration exceeds limit")?;
            // MOV PCM tables count samples continuously even when packet DTS
            // has gaps; retain those timestamps only for physical interleaving.
            let duration = u32::try_from(if original_pcm.as_ref().is_some_and(|(_,t)| t[i].pcm_format().is_some()) { i128::from(ticks) } else { duration - first }).map_err(|_|"audio duration exceeds limit")?;
            let delay = i64::try_from((first * i128::from(scale)).div_euclid(i128::from(rate))).map_err(|_|"audio start exceeds limit")?;
            let skip = u32::try_from((-first).max(0)).map_err(|_|"audio start exceeds limit")?;
            let movie_ticks = i64::try_from((u64::from(duration) * u64::from(scale)).div_ceil(u64::from(rate))).map_err(|_|"audio duration exceeds limit")? + delay.min(0);
            let delay = delay.max(0) as u32;
            tracks.push(Track{id:ordinal as u32+1,samples,scale:rate,media_ticks:duration,movie_ticks:(movie_ticks.max(0) as u32).saturating_add(delay),
                first_dts:0,fragment_sample_size:None,stsd:stsd.into(),edits:if delay > 0 {vec![[delay,u32::MAX,65536],[movie_ticks as u32,0,65536]]} else if duration != ticks || skip > 0 {vec![[movie_ticks as u32,skip,65536]]} else {vec![]},kind:"audio",enabled:true,field_order:None,volume:256,matrix:MATRIX,width:0,height:0,language:0x55c4,handler:*b"soun",name:b"SoundHandler"});
            index_bytes+=cost;
            continue;
        }
        if encode_aac && source.kind(i) == "audio" && (inputs[j].decoded().or(opts.concat.as_deref()).is_some_and(|c| c.audio.contains_key(&i)) || opts.audio_codec == Some("aac") || opts.format == "latm" || audio.clear_samples || matches!(source, Streams::Wave(_) | Streams::GeneratedAudio(_) | Streams::Elementary(_)) || matches!(source, Streams::Mp4(t) if matches!(t[i].0.tag,b"samr"|b"sawb") || t[i].0.pcm_format().is_some())) {
            let available = opts.limit.saturating_sub(index_bytes);
            let mut track = aac_track(inputs, &mut opts, (j,i), source, &selected, scale, available, shortest)?;
            track.id = ordinal as u32 + 1;
            index_bytes += track.samples.capacity() * size_of::<Sample>() + track.samples.iter().map(|s| s.data.len()).sum::<usize>();
            if !track.samples.is_empty() { tracks.push(track); }
            continue;
        }
        if opts.audio_codec == Some("wavpack") && source.kind(i) == "audio" {
            if !matches!(opts.format,"wv"|"mkv"|"webm") { return Err("WavPack encoding to this container is not supported".into()); }
            let filtered_float=opts.audio_filters.iter().flat_map(|f|f.split(',')).any(|f|f.trim().starts_with("volume="));
            if opts.audio_filters.iter().flat_map(|f|f.split(',')).any(|f|f.trim()!="anull" && !f.trim().starts_with("volume=")) {
                return Err("WavPack audio filter is not supported".into());
            }
            let floating=filtered_float || match source { Streams::Wave(w)=>matches!(w.wav.format(),super::super::ffmpeg_pcm::Format::Float(..)),Streams::Wavpack(doc)=>doc.floating,_=>false };
            let available=opts.limit.saturating_sub(index_bytes);
            let seek=opts.input_times.get(j).copied().unwrap_or_default();
            let pcm_format=if floating {super::super::ffmpeg_pcm::Format::Float(32,false)} else {super::super::ffmpeg_pcm::Format::Signed(if match source {Streams::Wave(w)=>w.wav.bits>16,Streams::Wavpack(doc)=>doc.bits>16,_=>false} {32}else{16},false)};
            let render=Remux{format:&pcm_format.name(),audio_codec:None,maps:&[],hls:None,concat:None,limit:available,end,..opts};
            let (rate,channels,bits,pcm)=match source {
                Streams::Wave(w)=>{
                    let mut wave=w.wav;wave.raw=Some(wave.format());
                    (wave.rate,wave.channels as u32,wave.bits,ffmpeg_wave::Input::Wave(wave).render(seek,&render)?)
                },
                Streams::GeneratedAudio(a)=>{
                    let Some(ffmpeg_wave::Input::Generated { frequency, duration, .. }) = ffmpeg_wave::Input::parse("lavfi",input)? else { return Err("invalid audio generator".into()); };
                    let frames=(seek.generation_end(opts.source_end).unwrap_or(duration)*f64::from(a.rate)).round().max(0.) as usize;
                    let pcm=super::super::lavfi::sine(frequency,a.rate,a.channels as usize,frames,available)?;
                    let wave=Wave::raw(super::super::ffmpeg_pcm::Format::Signed(16,false),&pcm,a.rate,a.channels)?;
                    (a.rate,a.channels,16,ffmpeg_wave::Input::Wave(wave).render(seek,&Remux {limit:available.saturating_sub(pcm.capacity()),..render})?)
                },
                Streams::Wavpack(doc)=>(doc.rate,doc.channels,doc.bits as u16,doc.render(seek,&render)?),
                _=>return Err("WavPack encoding requires decoded PCM audio".into()),
            };
            let bits=if floating || bits>16 && (opts.rate.is_some_and(|r|r!=rate) || opts.channels.is_some()) {32}else{bits};
            let rate=opts.rate.unwrap_or(rate);let channels=opts.channels.unwrap_or(channels);
            let mut wave=Wave::raw(pcm_format,&pcm,rate,channels)?;
            wave.channel_mask=match source {
                Streams::Wave(w) if opts.channels.is_none() && w.wav.channels==channels as usize=>w.wav.channel_mask,
                Streams::Wavpack(doc) if opts.channels.is_none() && doc.channels==channels && channels>2=>doc.channel_mask,
                _=>0,
            };
            if wave.channel_mask==0 {
                wave.channel_mask=super::super::audio_remix::default_mask(channels as usize);
            }
            let packets=super::super::wavpack::encode(wave,bits,available.saturating_sub(pcm.capacity()))?;
            let cost=packets.iter().try_fold(packets.capacity()*size_of::<Vec<u8>>(),|n,p|n.checked_add(p.capacity()+size_of::<Sample>())).filter(|&n|n<=available.saturating_sub(pcm.capacity())).ok_or("WavPack encoding exceeds memory budget")?;
            let ticks=u32::try_from(pcm.len()/wave.stride()).map_err(|_|"audio duration exceeds limit")?;
            if opts.format=="wv" {
                let remaining=available.saturating_sub(pcm.capacity()).saturating_sub(cost);
                let size=packets.iter().try_fold(0usize,|n,p|n.checked_add(p.len())).filter(|n|*n<=remaining).ok_or("WavPack output exceeds memory budget")?;
                let mut output=Vec::new();output.try_reserve_exact(size).map_err(|_|"WavPack output exceeds memory budget")?;
                for packet in packets {
                    let mut at=output.len();output.extend_from_slice(&packet);
                    while at<output.len() {
                        output[at+12..at+16].fill(0);
                        at+=u32::from_le_bytes(output[at+4..at+8].try_into().unwrap()) as usize+8;
                    }
                }
                let tags=if let Streams::Wavpack(doc)=source {doc.tags.as_slice()} else {&[]};
                super::super::wavpack::finish(&mut output,ticks,tags,&Remux{limit:remaining,..opts})?;
                return Ok(output);
            }
            let stsd=audio_sample_entry(b"wvpk",rate,channels,if bits>24 {32}else if bits>16 {24}else{16},&[]);
            tracks.push(Track{id:ordinal as u32+1,samples:packets.into_iter().map(|data|Sample{duration:u32::from_le_bytes(data[20..24].try_into().unwrap()),data:data.into(),cts:0,key:true,description:1}).collect(),
                scale:rate,media_ticks:ticks,movie_ticks:(f64::from(ticks)/f64::from(rate)*f64::from(scale)).round() as u32,first_dts:0,fragment_sample_size:None,
                stsd:stsd.into(),edits:vec![],kind:"audio",enabled:true,field_order:None,volume:256,matrix:MATRIX,width:0,height:0,language:0x55c4,handler:*b"soun",name:b"SoundHandler"});
            index_bytes+=cost;
            continue;
        }

        if let Some(sequence) = &composed
            && !matches!(source, Streams::Mp4(_))
            && source.kind(i) == "video"
        {
            let (w, h) = sequence.geometry;
            let ts = match source {
                Streams::Apng(_,seek) => if seek.loops>0 {90000} else {1000000},
                Streams::Gif(g) => g.timescale(),
                Streams::Still(_) | Streams::Ico(..) => 25,
                _ => 90000,
            };
            let mut t = video_track(
                w,
                h,
                VideoCodec::Avc(30),
                ts,
                (source.seconds(i) * f64::from(ts)).round() as u64,
                scale,
            )?;
            if matches!(opts.format,"mpegts"|"avi"|"flv") {
                t.stsd = match source {
                    Streams::GeneratedVideo(v) => video_entry(v.width as usize, v.height as usize, VideoCodec::Avc(v.fps.round().max(1.) as u32))?,
                    _ => Vec::new(),
                }.into();
            }
            sequence.encode(&mut t, scale, &opts, preparing_cut, &mut index_bytes)?;
            tracks.push(t);
            continue;
        }
        let Streams::Mp4(v) = source else {
            let limit = opts.limit.saturating_sub(index_bytes);
            let mut track = match source {
                Streams::Still(seek) => {
                    still_track(input, *seek, range, &opts, scale, limit)?
                }
                Streams::Ico(images, seek) => {
                    let image = &images[i];
                    let timescale = if seek.loops > 0 { 90000 } else { 25 };
                    let mut track = video_track(image.raster.width, image.raster.height, VideoCodec::Still(image.tag), timescale, u64::from(timescale / 25), scale)?;
                    let start = range.map_or(0., |r| r.0);
                    let end = range.and_then(|r| r.1).unwrap_or(source.seconds(i));
                    if (opts.video_codec == Some("copy") || opts.concat.is_some() && sources.len() > 1) && opts.video_filters.is_empty() {
                        for (pts, _) in super::super::ico::times(*seek, limit)? {
                            if frame_output::still_sample(start - pts, end - pts) && frame_output::still_sample(seek.start.unwrap_or(0.), seek.end().unwrap_or(0.04)) {
                                if track.samples.len() >= limit / (size_of::<Sample>() + image.data.len()) {
                                    return Err("output byte limit exceeded".into());
                                }
                                track.samples.push(Sample { data: image.data.into(), duration: timescale / 25, cts: 0, key: true, description: 1 });
                            }
                        }
                        track.media_ticks = (track.samples.len() as u64 * u64::from(timescale / 25)).try_into().map_err(|_| "track duration exceeds limit")?;
                        track.movie_ticks = (track.samples.len() as f64 / 25. * f64::from(scale)).round() as u32;
                    } else {
                        encode_video(&mut track, scale, super::super::ico::times(*seek, limit)?.filter(|&(pts, _)| seek.start.unwrap_or(0.) < 0.04 && seek.end().unwrap_or(0.04) > 0. && (seek.loops == 0 || pts >= start)), y4m::Options { filters: opts.video_filters, frames: opts.frames, start, end: Some(end), no_video: false, limit }, opts.video_encoding(), |_| Ok(image.raster.clone()))?;
                        if seek.loops > 0 && start > 0. && !track.samples.is_empty() {
                            let gap = (((start * 25.).ceil() / 25. - start) * f64::from(scale)).round() as u32;
                            if gap > 0 {
                                track.edits = vec![[gap, u32::MAX, 65536], [track.movie_ticks, 0, 65536]];
                                track.movie_ticks += gap;
                            }
                        }
                    }
                    if track.samples.is_empty() { continue; }
                    track
                }
                Streams::Apng(doc,seek) => {
                    let ts=if seek.loops>0 {90000} else {1000000};
                    let mut t=video_track(doc.width,doc.height,VideoCodec::Still(b"apng"),ts,0,scale)?;
                    let times:Vec<_>=doc.times(*seek,limit)?.collect();
                    let (start,end)=range.unwrap_or((0.,None));
                    if opts.video_codec==Some("copy") || opts.concat.is_some() && sources.len()>1 {
                        let mut remaining=limit;
                        for &(index,pts,duration) in &times {
                            if pts<start || end.is_some_and(|end|pts>=end) {continue;}
                            if opts.frames.is_some_and(|n| t.samples.len() >= n as usize) {break;}
                            let packet=&doc.frames[index].packet;
                            remaining=remaining.checked_sub(packet.len()+size_of::<Sample>()).ok_or("APNG packets exceed memory budget")?;
                            let ticks=(duration*f64::from(ts)).round() as u64;
                            t.samples.push(Sample {data:packet.clone().into(),duration:ticks.try_into().map_err(|_|"APNG duration exceeds limit")?,cts:0,key:true,description:1});
                        }
                        let ticks:u64=t.samples.iter().map(|s|u64::from(s.duration)).sum();
                        t.media_ticks=ticks.try_into().map_err(|_|"APNG duration exceeds limit")?;
                        t.movie_ticks=(ticks as f64/f64::from(ts)*f64::from(scale)).round() as u32;
                    } else {
                        encode_video(&mut t,scale,times.iter().map(|t|(t.1,t.2)),y4m::Options {filters:opts.video_filters,frames:opts.frames,start,end,no_video:false,limit},opts.video_encoding(),|i|Ok(doc.frames[times[i].0].image.clone()))?;
                    }
                    t
                }
                Streams::Gif(g) => gif_track(input,g,&opts,range,scale,limit)?,
                Streams::Y4m(clip) => raw_video_track(clip, &opts, range, scale, limit)?,
                Streams::Images(seq) => sequence_track(
                    seq,
                    scale,
                    opts.video_filters,
                    opts.frames,
                    opts.video_encoding(),
                    limit,
                )?,
                Streams::GeneratedVideo(v) => generated_video(
                    v,
                    scale,
                    opts.video_filters,
                    opts.frames,
                    opts.video_encoding(),
                    limit,
                )?,
                Streams::GeneratedAudio(a) => a.track(&audio, scale, limit)?,
                Streams::Nut(doc,seek) => {
                    let source=&doc.tracks[i];
                    if let Some(format) = source.format {
                        if opts.audio_codec != Some("copy") || !matches!(opts.format, "" | "mp4" | "mov") { return Err("NUT audio conversion to this container is not supported".into()); }
                        let copied = source.convert(*seek, &Remux {end, limit, hls: None, concat: None, ..opts})?;
                        let rate = copied.rate;
                        let clock = |ticks: f64| (ticks * f64::from(rate) / f64::from(copied.scale)).round() as u32;
                        let first = copied.packets.first().map_or(0, |p| p.pts.max(0));
                        if copied.packets.len() > limit.saturating_sub(copied.packets.capacity() * size_of::<super::super::nut::Packet>()) / size_of::<Sample>() { return Err("sample index exceeds memory budget".into()); }
                        let mut samples = Vec::with_capacity(copied.packets.len());
                        for (n, packet) in copied.packets.iter().enumerate() {
                            let ticks = copied.packets.get(n + 1).map_or(packet.ticks, |next| (next.pts - packet.pts) as f64);
                            samples.push(Sample {data: packet.data.clone(), duration: clock(ticks), cts: 0, key: true, description: 1});
                        }
                        let ticks = samples.iter().try_fold(0u32, |n, s| n.checked_add(s.duration)).ok_or("audio duration exceeds limit")?;
                        let delay = (first as f64 * f64::from(scale) / f64::from(copied.scale)).round() as u32;
                        let movie_ticks = (f64::from(ticks) * f64::from(scale) / f64::from(rate)).round() as u32;
                        let mask = super::super::audio_remix::default_mask(copied.channels as usize);
                        let order: Vec<_> = (0..32).filter(|&i| mask & (1 << i) != 0).collect();
                        let stsd = pcm_entry(format, rate, copied.channels, &order, opts.format == "mov")?;
                        tracks.push(Track {id: ordinal as u32 + 1, samples, scale: rate, media_ticks: ticks, movie_ticks: movie_ticks.saturating_add(delay), first_dts: 0, fragment_sample_size: None,
                            stsd: stsd.into(), edits: if delay == 0 {vec![]} else {vec![[delay,u32::MAX,65536],[movie_ticks,0,65536]]}, kind: "audio", enabled: true, field_order: None,
                            volume: 256, matrix: MATRIX, width: 0, height: 0, language: 0x55c4, handler: *b"soun", name: b"SoundHandler"});
                        index_bytes += tracks.last().unwrap().samples.capacity() * size_of::<Sample>();
                        continue;
                    }
                    let times=source.times(*seek,limit)?;
                    let mut track=video_track(source.width,source.height,VideoCodec::Still(b"raw "),source.scale,0,scale)?;
                    let (start,end)=range.unwrap_or((0.,None));
                    encode_video(&mut track,scale,times.iter().map(|t|(t.1,t.2)),y4m::Options {filters:opts.video_filters,frames:opts.frames,start,end,no_video:false,limit},opts.video_encoding(),|i|source.image(times[i].0,limit))?;
                    track
                }
                Streams::Elementary(doc) => {
                    if !matches!(opts.format,""|"mp4"|"mov"|"amr"|"latm") || doc.format=="latm" && opts.format!="latm" {
                        return Err("Elementary audio copying to this container is not supported".into());
                    }
                    let seek=opts.input_times.get(j).copied().unwrap_or_default();
                    let clock=|s:f64|(s.max(0.)*f64::from(doc.scale)).round() as u64;
                    let from=seek.start.map_or(0,clock);let until=seek.end().map_or(u64::MAX,clock);
                    let start=opts.start.map_or(0,clock);let end=opts.end.map_or(u64::MAX,clock);
                    let copies=seek.loops.checked_add(1).ok_or("audio packets exceed memory budget")?;
                    if copies.saturating_mul(doc.packets.len())>limit/size_of::<Sample>() {return Err("audio packets exceed memory budget".into());}
                    let mut samples=Vec::new();let mut base=0u64;
                    for _ in 0..copies {
                        for (i,packet) in doc.packets.iter().enumerate() {
                            let pts=i as u64*u64::from(doc.tick);
                            if pts<from || pts>=until {continue;}
                            let time=base+pts-from;
                            if time>=start && time<end {samples.push(Sample {data:(*packet).into(),duration:doc.tick,cts:0,key:true,description:1});}
                        }
                        base=base.saturating_add((doc.packets.len() as u64*u64::from(doc.tick)).min(until).saturating_sub(from));
                    }
                    if doc.format=="latm" && samples.first().is_some_and(|s|s.data[3]&128!=0) {return Err("LATM copy requires an initial StreamMuxConfig".into());}
                    let ticks=samples.iter().map(|s|u64::from(s.duration)).sum::<u64>();
                    Track {id:ordinal as u32+1,samples,scale:doc.scale,media_ticks:ticks.try_into().map_err(|_|"audio duration exceeds limit")?,movie_ticks:(ticks as f64/f64::from(doc.scale)*f64::from(scale)).round() as u32,first_dts:0,fragment_sample_size:None,
                        stsd:audio_sample_entry(doc.tag,doc.rate,doc.channels,16,&doc.config).into(),edits:vec![],kind:"audio",enabled:true,field_order:None,volume:256,matrix:MATRIX,width:0,height:0,language:0x55c4,handler:*b"soun",name:b"SoundHandler"}
                },
                Streams::Wavpack(doc) => {
                    if !matches!(opts.format, "mkv" | "webm") || opts.audio_codec != Some("copy") { return Err("WavPack audio conversion to this container is not supported".into()); }
                    let seek = opts.input_times.get(j).copied().unwrap_or_default();
                    let clock = |s: f64| (s.max(0.) * f64::from(doc.rate)).round() as u64;
                    let (from, until) = (seek.start.map_or(0, clock), seek.end().map_or(u64::MAX, clock));
                    let (start, end) = (opts.start.map_or(0, clock), opts.end.map_or(u64::MAX, clock));
                    let copies = seek.loops.checked_add(1).ok_or("WavPack packets exceed memory budget")?;
                    if copies.saturating_mul(doc.packets.len()) > limit / size_of::<Sample>() { return Err("WavPack packets exceed memory budget".into()); }
                    let mut base = 0u64;
                    let mut samples = Vec::new();
                    for _ in 0..copies {
                        for packet in &doc.packets {
                            if u64::from(packet.pts) + u64::from(packet.frames) <= from || u64::from(packet.pts) >= until { continue; }
                            let tick = base.saturating_add(u64::from(packet.pts));
                            if (opts.start.is_none() || tick >= from.saturating_add(start)) && tick < from.saturating_add(end) {
                                samples.push(Sample { data: packet.data.into(), duration:packet.frames, cts:0, key:true, description:1 });
                            }
                        }
                        base = base.saturating_add(u64::from(doc.frames));
                    }
                    let ticks = samples.iter().map(|s|u64::from(s.duration)).sum::<u64>();
                    Track {id:ordinal as u32 + 1, samples, scale:doc.rate, media_ticks:ticks.try_into().map_err(|_|"audio duration exceeds limit")?, movie_ticks:(ticks as f64/f64::from(doc.rate)*f64::from(scale)).round() as u32,first_dts:0,fragment_sample_size:None,
                        stsd:audio_sample_entry(b"wvpk",doc.rate,doc.channels,doc.bits,&[]).into(),edits:vec![],kind:"audio",enabled:true,field_order:None,volume:256,matrix:MATRIX,width:0,height:0,language:0x55c4,handler:*b"soun",name:b"SoundHandler"}
                },
                Streams::Caf(_) => return Err("CAF audio conversion to this container is not supported".into()),
                Streams::Voc(_) => return Err("VOC audio conversion to this container is not supported".into()),
                Streams::Aiff(_) => return Err("AIFF audio conversion to this container is not supported".into()),
                Streams::Au(_) => return Err("AU audio conversion to this container is not supported".into()),
                Streams::Wave(w) => {
                    let mut track = w.track(opts.input_times.get(j).copied().unwrap_or_default(), &audio, opts.start, scale, limit)?;
                    if matches!(opts.format, "mp4" | "mov") {
                        let mask = if w.wav.channel_mask == 0 { super::super::audio_remix::default_mask(w.wav.channels) } else { w.wav.channel_mask };
                        let order = (0..32).filter(|&i| mask & (1 << i) != 0).collect::<Vec<_>>();
                        track.stsd = pcm_entry(w.wav.format(), w.wav.rate, w.wav.channels as u32, &order, opts.format == "mov")?.into();
                    }
                    track
                },
                Streams::Aac { .. } => {
                    tracks.push(adts_track(input, &audio, scale, &mut index_bytes)?);
                    continue;
                }
                Streams::Mp4(_) => unreachable!(),
                Streams::TextSubtitles(doc) => {
                    tracks.push(text_subtitle_track(doc, &opts, j, scale, &mut index_bytes)?);
                    continue;
                }
                Streams::Captions(text) => {
                    tracks.push(subtitle_track(
                        text,
                        range.is_none() && matches!(opts.format,"mkv"|"webm"),
                        range,
                        scale,
                        &mut index_bytes,
                        opts.limit,
                    )?);
                    continue;
                }
            };
            if track.kind == "audio" {
                if track.samples.is_empty() && opts.audio_codec == Some("copy") && matches!(opts.format, "mov" | "mp4") { continue; }
                if track.samples.is_empty() && matches!(opts.format, "mkv" | "webm") && track.stsd.get(12..16) != Some(b"wvpk") {
                    let channels = u16_at(&track.stsd, 32).into();
                    track.samples.push(Sample {
                        data: super::super::adts::silent(channels).into(),
                        duration: 1024, cts: 0, key: true, description: 1,
                    });
                }
                index_bytes += track.samples.capacity() * size_of::<Sample>() + track.samples.iter().map(|s| match &s.data { Cow::Owned(v) => v.capacity(), _ => 0 }).sum::<usize>();
                if index_bytes > opts.limit { return Err("output byte limit exceeded".into()); }
                tracks.push(track);
                continue;
            }
            track.matrix = rotation_matrix(opts.rotation.unwrap_or(0));
            index_bytes =
                index_bytes.saturating_add(track.samples.capacity() * size_of::<Sample>());
            for sample in &track.samples {
                index_bytes = index_bytes.saturating_add(sample.data.len());
            }
            if index_bytes > opts.limit {
                return Err("output byte limit exceeded".into());
            }
            tracks.push(track);
            continue;
        };
        let (t, trak) = &v[i];
        let video = t.kind == "video";
        let audio = t.kind == "audio";
        let tk = child(trak, b"tkhd");
        let long = tk.first() == Some(&1);
        let mdia = child(trak, b"mdia");
        let stbl = child(child(mdia, b"minf"), b"stbl");
        let stsd = child(stbl, b"stsd");
        let hdlr = child(mdia, b"hdlr");
        let handler = hdlr
            .get(8..12)
            .and_then(|s| s.try_into().ok())
            .unwrap_or(*b"vide");
        let name: &[u8] = if !t.handler.is_empty() {
            t.handler
        } else if video {
            b"VideoHandler"
        } else if audio {
            b"SoundHandler"
        } else {
            b"SubtitleHandler"
        };
        let language = t
            .language
            .bytes()
            .fold(0u16, |a, b| (a << 5) | u16::from(b - 96));
        let angle = opts.rotation.filter(|_| video).unwrap_or_else(|| {
            let i = if long { 52 } else { 40 };
            let a = u32_at(tk, i) as i32;
            let b = u32_at(tk, i + 4) as i32;
            (f64::from(b).atan2(f64::from(a)).to_degrees().round() as i32).rem_euclid(360)
        });
        let matrix = rotation_matrix(angle);
        let elst = child(child(trak, b"edts"), b"elst");
        let v1 = elst.first() == Some(&1);
        let source_scale = super::header_time(child(sources[j].1, b"mvhd"),1000).0;
        let mut edits: Vec<_> = rows(elst, if v1 { 20 } else { 12 })
            .map(|r| {
                let segment = wide(r, 0, v1);
                let time = if v1 {
                    wide(r, 8, true) as i64
                } else {
                    i64::from(u32_at(r, 4) as i32)
                };
                let segment = if segment == 0 && !t.runs.is_empty() && time >= 0 {
                    ((t.stats.media_end - i128::from(time)).max(0) as f64 * f64::from(scale)
                        / f64::from(t.scale))
                    .round() as u64
                } else {
                    (segment as f64 * f64::from(scale) / f64::from(source_scale)).round() as u64
                };
                [
                    segment as u32,
                    time as u32,
                    u32_at(r, if v1 { 16 } else { 8 }),
                ]
            })
            .collect();
        let composed_video = composed.as_ref().filter(|_| video);
        let count = if composed_video.is_some() {
            0
        } else {
            t.stats.count
        };
        index_bytes = index_bytes.saturating_add(count.saturating_mul(size_of::<Sample>()));
        if index_bytes > opts.limit {
            return Err("sample index exceeds memory budget".into());
        }
        let mut samples = Vec::with_capacity(count);
        let mut first_dts = 0;
        let mut begin = 0;
        let pcm_copy = opts.audio_codec == Some("copy") && t.pcm_format().is_some();
        let sliced = (range.is_some() || pcm_copy && !t.negative_edit && t.origin <= t.stats.ticks) && !(opts.start.is_none() && t.pcm_format().is_some()
            && edits.iter().any(|r| (r[0] as i32) < 0)
            && end.is_some_and(|end| end >= source.seconds(i)));
        let pcm = inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c| c.audio.get(&i));
        let copied_video = video && opts.video_codec == Some("copy");
        let copied_audio = t.kind == "audio" && opts.audio_codec == Some("copy");
        let pcm_delay = if pcm_copy || copied_video {
            let input_start = if copied_video && !opts.input_seek && opts.input_times.get(j)
                .is_some_and(|s| s.start.is_some() || s.end().is_some() || s.loops > 0) { 0. } else {
                v.iter().filter(|(track, _)| track.kind != "data")
                    .map(|(track, _)| track.stats.start as f64 / f64::from(track.scale)).reduce(f64::min).unwrap_or(0.)
            };
            t.empty_ticks.saturating_sub((input_start * f64::from(t.scale)).round() as u64)
        } else { 0 };
        if copied_video && !sliced && let Some(edit) = edits.first_mut().filter(|e| e[1] == u32::MAX) {
            edit[0] = (pcm_delay as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32;
            if edit[0] == 0 { edits.remove(0); }
        }
        let (first, start, end, packets) = cut_packets(t, input, range, copied_video || copied_audio, ((copied_video || copied_audio) && opts.start.is_some()).then_some(opts.input_seek), pcm_delay);
        let original_video = if copied_video && opts.shortest && opts.input_times.get(j).is_some_and(|s| s.loops > 0)
            && let MediaInput::Bytes("mov" | "mp4", bytes) = &inputs[j] {
            Some((bytes, super::read_tracks(bytes, super::movie(bytes)?)?.0))
        } else { None };
        let video_tick = |index: usize| original_video.as_ref().and_then(|(bytes, tracks)| {
            let track = &tracks[i];
            if track.stats.count == 0 { return None; }
            let sample = track.samples(bytes.len()).nth(index % track.stats.count)?;
            let remaining = track.origin.saturating_add(track.duration).saturating_sub(track.empty_ticks.saturating_mul(2)).saturating_sub(sample.dts);
            Some(if index % track.stats.count + 1 == track.stats.count && remaining > 0 {
                u64::from(sample.tick).min(remaining) as u32
            } else { sample.tick })
        });
        let mut presentation_end = 0i128;
        for s in packets.take(count) {
            let tail = video_tick(first + samples.len()).unwrap_or(s.tick);
            if copied_video && opts.shortest && s.pts + i128::from(tail) > i128::from(end) { break; }
            presentation_end = presentation_end.max(s.pts + i128::from(s.tick));
            if t.tag == b"wvpk" && opts.audio_codec == Some("copy") && opts.start.is_some() && s.dts < start { continue; }
            if samples.is_empty() {
                first_dts = if sliced { 0 } else { s.dts };
                begin = s.dts;
            }
            samples.push(Sample {
                data: input[s.offset..s.offset + s.size as usize].into(),
                duration: if sliced && pcm.is_some() && !copied_audio {
                    s.tick
                        .saturating_sub(start.saturating_sub(s.dts).min(u64::from(u32::MAX)) as u32)
                } else {
                    s.tick
                },
                key: if copied_video { t.packet_key(input, &s) } else { s.key },
                cts: (s.pts - i128::from(s.dts)) as i64,
                description: s.description,
            });
        }
        if let Some(tail) = samples.len().checked_sub(1).and_then(|n| video_tick(first + n))
            && let Some(last) = samples.last_mut() {
            presentation_end -= i128::from(last.duration.saturating_sub(tail));
            last.duration = last.duration.min(tail);
        }
        if sliced {
            if video && !copied_video
                && let Some(sample) = samples.first_mut()
                && sample.data.get(4).is_some_and(|v| v & 31 == 1)
            {
                let mut decoder = super::VideoDecoder::new(t, opts.limit);
                let key = t
                    .samples(input.len())
                    .take(first + 1)
                    .enumerate()
                    .filter(|(_, s)| s.size > 4 && input[s.offset + 4] & 31 == 5)
                    .map(|(i, _)| i)
                    .last()
                    .unwrap_or(0);
                for (i, s) in t
                    .samples(input.len())
                    .enumerate()
                    .skip(key)
                    .take(first - key + 1)
                {
                    let picture = decoder
                        .decode(s.description, &input[s.offset..s.offset + s.size as usize])?;
                    if i == first {
                        picture.promote(t.width as usize, t.height as usize, opts.limit)?;
                        sample.data = picture.idr(opts.limit)?.into();
                    }
                }
                sample.key = true;
            }
            edits.clear();
            if (copied_video || copied_audio) && samples.first().is_some_and(|s|begin.saturating_add(s.cts.max(0) as u64) >= start) {
                let past_end = opts.input_seek && opts.start.is_some_and(|s| s * f64::from(t.scale) >= t.duration as f64);
                let cts = if past_end { 0 } else { samples[0].cts.max(0) as u64 };
                let gap = if past_end { 0 } else { begin + cts - start + pcm_delay.saturating_sub(t.origin.saturating_add((opts.start.unwrap_or(0.) * f64::from(t.scale)).round() as u64)) };
                let visible = if past_end { samples.iter().map(|s|u64::from(s.duration)).sum() }
                    else { (presentation_end - i128::from(begin + cts)).max(0) as u64 };
                if gap > 0 {
                    edits.push([(gap as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32, u32::MAX, 65536]);
                }
                edits.push([
                    (visible as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32,
                    cts as u32, 65536,
                ]);
            }
            if edits.is_empty() && !samples.is_empty() && begin < start && pcm.is_none() {
                let ticks = samples.iter().map(|s| u64::from(s.duration)).sum::<u64>();
                let visible = if copied_video || copied_audio {
                    (presentation_end - i128::from(start)).max(0) as u64
                } else { end.min(begin.saturating_add(ticks)).saturating_sub(start) };
                edits.push([
                    (visible as f64 * f64::from(scale) / f64::from(t.scale)).round() as u32,
                    (start - begin) as u32,
                    65536,
                ]);
            }
        }
        if copied_audio && t.pcm_format().is_some() && opts.input_seek && !samples.is_empty()
            && opts.start.is_some_and(|s| i128::from(t.origin.saturating_add((s * f64::from(t.scale)).round() as u64).saturating_sub(pcm_delay)) > presentation_end) {
            // Native MOV retains the final packet beyond EOF with a negative
            // edit duration. Its media offset suppresses all decoded samples.
            let requested = t.origin.saturating_add((opts.start.unwrap() * f64::from(t.scale)).round() as u64).saturating_sub(pcm_delay);
            let offset = requested.saturating_sub(begin);
            let ticks = samples.iter().map(|s| i64::from(s.duration)).sum::<i64>();
            edits = vec![[((ticks as f64 - offset as f64) * f64::from(scale) / f64::from(t.scale)).round() as i64 as u32, offset as u32, 65536]];
        }
        let repeated_still = match &inputs[j] {
            MediaInput::Bytes("image2", bytes)
                if t.tag != b"avc1"
                    && !samples.is_empty()
                    && (!opts.video_filters.is_empty()
                        || opts.frames.is_some_and(|n| samples.len() > n as usize)) =>
            {
                Some(bytes)
            }
            _ => None,
        };
        if video
            && repeated_still.is_none()
            && !temporal
            && let Some(n) = opts.frames
            && samples.len() > n.max(1) as usize
        {
            samples.truncate(n.max(1) as usize);
            if let Some(seconds) = stream_seconds.get_mut(ordinal) {
                *seconds = samples.iter().map(|s| f64::from(s.duration)).sum::<f64>() / f64::from(t.scale);
            }
        }
        let ticks = if copied_audio && t.pcm_format().is_some() && !sliced && (t.negative_edit || t.origin > t.stats.ticks) {
            super::header_time(child(child(trak, b"mdia"), b"mdhd"), t.scale).1 as f64
        } else if copied_video && !sliced && samples.len() == t.stats.count
            && matches!(inputs[j], MediaInput::Joined(..)) {
            // A complete copy keeps the media duration, including presentation
            // tails whose decode durations were shortened by overlapping clips.
            super::header_time(child(child(trak, b"mdia"), b"mdhd"), t.scale).1 as f64
        } else if copied_video {
            (presentation_end - i128::from(begin) - i128::from(samples.first().map_or(0, |s|s.cts))).max(0) as f64
        } else if t.tag == b"wvpk" {
            samples.iter().map(|s| f64::from(s.duration)).sum()
        } else if !sliced && samples.is_empty() {
            t.original
                .matroska()
                .map_or(t.duration as f64, |m| m.info.ticks)
        } else if let Some(m) = t.original.matroska() {
            m.packets()
                .skip(first)
                .take(samples.len())
                .map(|(p, _)| p.ticks.min(end.saturating_sub(p.dts as u64) as f64))
                .sum()
        } else {
            samples.iter().map(|s| f64::from(s.duration)).sum()
        };
        let movie_ticks = if copied_audio && t.pcm_format().is_some() && edits.iter().any(|r| (r[0] as i32) < 0) {
            0
        } else if edits.is_empty() {
            let ticks = ticks * f64::from(scale) / f64::from(t.scale);
            if copied_video { ticks.ceil() as u32 } else { ticks.round() as u32 }
        } else {
            edits.iter().map(|r| u64::from(r[0])).sum::<u64>() as u32
        };
        let mut track = Track {
            id: t.id,
            samples,
            scale: t.scale,
            media_ticks: ticks as u32,
            movie_ticks,
            first_dts,
            fragment_sample_size: None,
            stsd: if stsd.len() >= 8 { stsd } else { &[0; 8] }.into(),
            edits,
            kind: t.kind,
            enabled: t.enabled,
            field_order: t.sequence.as_ref().filter(|s| s.frame_only).map(|_| "progressive"),
            volume: if audio {
                if tk.len() < 24 {
                    256
                } else {
                    u32::from(u16_at(tk, if long { 48 } else { 36 }))
                }
            } else {
                0
            },
            matrix,
            width: if video { t.width } else { 0 },
            height: if video { t.height } else { 0 },
            language,
            handler,
            name,
        };
        if copied_audio && matches!(opts.format, "mp4" | "mov") && let Some(format) = t.pcm_format() {
            if t.original.matroska().is_some() {
                let rate = t.audio_rate().unwrap_or(t.scale);
                let clock = |ticks: u32| (f64::from(ticks) * f64::from(rate) / f64::from(track.scale)).round() as u32;
                for sample in &mut track.samples { sample.duration = clock(sample.duration); }
                track.media_ticks = clock(track.media_ticks);
                track.first_dts = (track.first_dts as f64 * f64::from(rate) / f64::from(track.scale)).round() as u64;
                for edit in &mut track.edits { if edit[1] != u32::MAX { edit[1] = clock(edit[1]); } }
                track.scale = rate;
            }
            let mut order = t.channel_order();
            if (opts.format == "mp4") != matches!(t.tag, b"ipcm" | b"fpcm") || order.is_empty()
                || order.iter().any(|&speaker| !matches!(speaker, 0..=17 | 29..=32 | 35)) {
                if order.is_empty() {
                    let mask = super::super::audio_remix::default_mask(usize::from(t.channels()));
                    order = (0..32).filter(|&i| mask & (1 << i) != 0).collect();
                }
                track.stsd = pcm_entry(format, t.audio_rate().unwrap_or(t.scale), u32::from(t.channels()), &order, opts.format == "mov")?.into();
            }
        }
        if copied_audio && t.tag == b"mp4a" && matches!(opts.format, "" | "mp4" | "mov")
            && let Some(m) = t.original.matroska() && !track.samples.is_empty()
        {
            // Stream copying from millisecond timestamps keeps AAC's sample
            // cadence, clamping it only when the source clock requires it.
            let rate = t.audio_rate().unwrap_or(44100).max(1);
            let source_scale = i128::from(m.info.scale);
            let offset = (range.map_or(0., |r| r.0) * f64::from(m.info.scale)).round() as i64;
            let mut next: Option<i128> = None;
            let mut previous = 0;
            let mut first_stamp = 0;
            for (index, (p, _)) in m.packets().skip(first).take(track.samples.len()).enumerate() {
                let ts = i128::from(p.dts.saturating_sub(offset));
                let low = ((2 * ts - 1) * i128::from(rate)).div_euclid(source_scale) >> 1;
                let high = (((2 * ts + 1) * i128::from(rate) + source_scale - 1).div_euclid(source_scale) + 1) >> 1;
                let stamp = if let Some(last) = next && last >= 2 * low - high && last <= 2 * high - low {
                    last.clamp(low, high)
                } else { i128::from(super::super::lrc::rescale(ts as i64, (1, m.info.scale.into()), rate.into())) };
                next = Some(stamp + 1024);
                if index > 0 { track.samples[index - 1].duration = u32::try_from(stamp - previous).map_err(|_| "audio timestamp exceeds sample limit")?; }
                else { first_stamp = stamp; }
                previous = stamp;
            }
            track.samples.last_mut().unwrap().duration = super::super::lrc::rescale(
                1024 * i64::from(m.info.scale) / i64::from(rate), (1, m.info.scale.into()), rate.into()) as u32;
            track.scale = rate;
            track.media_ticks = track.samples.iter().map(|s| u64::from(s.duration)).sum::<u64>().try_into().map_err(|_| "audio duration exceeds track limit")?;
            track.first_dts = first_stamp.max(0) as u64;
            track.edits.clear();
            let visible = (i128::from(track.media_ticks) + first_stamp.min(0)).max(0) as u64;
            let visible_movie = (visible * u64::from(scale)).div_ceil(u64::from(rate)) as u32;
            let gap = (first_stamp.max(0) * i128::from(scale) / i128::from(rate)) as u32;
            if gap > 0 { track.edits.push([gap, u32::MAX, 65536]); }
            if first_stamp != 0 { track.edits.push([visible_movie, (-first_stamp).max(0) as u32, 65536]); }
            track.movie_ticks = visible_movie.saturating_add(gap);
        }
        // AVI can label a video sample entry as JPEG while also describing its AVC
        // packets. MP4 drops those parameters; the transport writers retain them on cuts.
        if matches!(opts.format, "avi" | "flv" | "mpegts" | "mkv" | "webm")
            && let Some(desc) = t.original.avi()
            && !desc.jpeg_avcc.is_empty()
            && opts.video_codec != Some("copy")
        {
            track.stsd = video_entry(t.width as usize, t.height as usize, VideoCodec::Config(&desc.jpeg_avcc))?.into();
        }
        let (from, to) = range.unwrap_or((0., None));
        let joined = inputs[j].decoded().or(opts.concat.as_deref())
            .and_then(|c| c.video.as_ref()?.get(&i))
            .map(|v| (v, v.visible(from, to)))
            .filter(|(_, v)| {
                !v.is_empty()
                    && (track.samples.is_empty()
                        || t.tag != b"avc1" && opts.video_codec != Some("copy")
                        || !opts.video_filters.is_empty()
                        || opts.frames.is_some_and(|n| v.len() > n as usize))
            });
        if let Some((seq, show)) = joined.filter(|_| composed_video.is_none()) {
            let limit = opts.limit.saturating_sub(index_bytes);
            encode_video(
                &mut track,
                scale,
                show.iter().map(|f| ((f.0 - from).max(0.), f.1)),
                y4m::Options {
                    filters: opts.video_filters,
                    frames: opts.frames,
                    start: 0.,
                    end: None,
                    no_video: false,
                    limit,
                },
                opts.video_encoding(),
                |k| Ok(seq.images[show[k].2].clone()),
            )?;
            index_bytes = index_bytes
                .saturating_add(track.samples.iter().map(|s| s.data.len()).sum::<usize>());
        } else if let Some(sequence) = composed_video {
            sequence.encode(
                &mut track,
                scale,
                &opts,
                preparing_cut,
                &mut index_bytes,
            )?;
        } else if let Some(bytes) = repeated_still {
            let limit = opts.limit.saturating_sub(index_bytes);
            let im = frame_output::decode_still(bytes, limit)?;
            let (start, end) = range.unwrap_or((0., None));
            encode_video(
                &mut track,
                scale,
                (0..t.stats.count).map(|i| (i as f64 / 25., 0.04)),
                y4m::Options {
                    start,
                    end,
                    frames: opts.frames,
                    filters: opts.video_filters,
                    no_video: false,
                    limit,
                },
                opts.video_encoding(),
                |_| Ok(im.clone()),
            )?;
            index_bytes = index_bytes
                .saturating_add(track.samples.iter().map(|s| s.data.len()).sum::<usize>());
        } else if video && !opts.video_filters.is_empty() && !track.samples.is_empty() {
            let mut decoder = super::VideoDecoder::new(t, opts.limit);
            let input_samples = std::mem::take(&mut track.samples);
            let times = input_samples.iter().scan(0u64, |dts, s| {
                let at = *dts;
                *dts += u64::from(s.duration);
                Some((
                    (at as f64 + s.cts as f64) / f64::from(t.scale),
                    f64::from(s.duration) / f64::from(t.scale),
                ))
            });
            let limit = opts.limit.saturating_sub(index_bytes);
            encode_video(
                &mut track,
                scale,
                times,
                y4m::Options {
                    filters: opts.video_filters,
                    frames: opts.frames,
                    start: 0.,
                    end: None,
                    no_video: false,
                    limit,
                },
                        opts.video_encoding(),
                |i| {
                    let picture = decoder.picture(
                        i,
                        |n| {
                            let s = &input_samples[n];
                            (s.description, s.data.as_ref())
                        },
                        None,
                    )?;
                    picture.image((t.width as usize, t.height as usize), true, limit)
                },
            )?;
            if track.samples.is_empty() && !track.edits.is_empty() {
                track.media_ticks = (f64::from(track.movie_ticks) * f64::from(track.scale)
                    / f64::from(scale))
                .round() as u32;
            }
            index_bytes = index_bytes
                .saturating_sub(input_samples.capacity() * size_of::<Sample>())
                .saturating_add(
                    track.samples.capacity() * size_of::<Sample>()
                        + track.samples.iter().map(|s| s.data.len()).sum::<usize>(),
                );
        }
        tracks.push(track);
    }
    if audio.clear_samples && !encode_aac && encode_pcm.is_none() && !matches!(opts.format,"mpegts"|"avi"|"flv"|"mkv"|"webm") {
        for (track, &(j, i)) in tracks.iter_mut().zip(&selected) {
            if track.kind != "audio" {
                continue;
            }
            let (rate, channels) =
                if let Some(pcm) = inputs[j].decoded().or(opts.concat.as_deref()).and_then(|c| c.audio.get(&i)) {
                    (pcm.rate, pcm.channels as u32)
                } else {
                    match &sources[j].2 {
                        Streams::Mp4(v) => (
                            v[i].0.audio_rate().unwrap_or(v[i].0.scale),
                            u32::from(v[i].0.channels()),
                        ),
                        Streams::Aac { rate, channels, .. } => (*rate, u32::from(*channels)),
                        Streams::GeneratedAudio(a) => (a.rate, a.channels),
                        Streams::Wave(w) => (w.wav.rate, w.wav.channels as u32),
                        Streams::Nut(doc,_) => (doc.tracks[i].rate,doc.tracks[i].channels),
                        Streams::Elementary(doc) => (doc.rate, doc.channels),
                        Streams::Wavpack(doc) => (doc.rate, doc.channels),
                        Streams::Caf(doc) => (doc.rate, doc.channels),
                        Streams::Voc(doc) => (doc.rate, doc.channels),
                        Streams::Aiff(doc) => (doc.rate, doc.channels),
                        Streams::Au(doc) => (doc.rate, doc.channels),
                        Streams::Y4m(_)
                        | Streams::Ico(..)
                        | Streams::Apng(..)
                        | Streams::Gif(_)
                        | Streams::Still(_)
                        | Streams::Images(_)
                        | Streams::GeneratedVideo(_)
                        | Streams::Captions(_) | Streams::TextSubtitles(_) => continue,
                    }
                };
            // Slicing can keep a partial first packet hidden by an edit list.
            let duration = if range.is_none() {
                sources[j].2.seconds(i)
            } else if track.edits.is_empty() {
                f64::from(track.media_ticks) / f64::from(track.scale)
            } else {
                (f64::from(track.movie_ticks) * f64::from(track.scale) / f64::from(scale)).round()
                    / f64::from(track.scale)
            };
            let seconds = if duration == 0. {
                f64::from(rate) / f64::from(track.scale)
            } else {
                duration
            };
            let mut tempo = 1.;
            let mut volume = f64::from(track.volume as i16) / 256.;
            for f in opts
                .audio_filters
                .iter()
                .flat_map(|f| f.split(','))
                .map(str::trim)
            {
                if let Some(s) = f.strip_prefix("atempo=") {
                    tempo *= s
                        .trim()
                        .parse::<f64>()
                        .ok()
                        .filter(|v| *v != 0. && !v.is_nan())
                        .unwrap_or(1.)
                        .clamp(0.25, 4.);
                }
                if let Some(s) = f.strip_prefix("volume=") {
                    let s = s.trim();
                    volume *= if let Some(db) = s.strip_suffix("dB") {
                        10f64.powf(db.parse::<f64>().unwrap_or(0.) / 20.)
                    } else {
                        s.parse::<f64>().ok().filter(|v| *v != 0.).unwrap_or(1.)
                    }
                }
            }
            let rate = opts.rate.unwrap_or(rate);
            let channels = opts.channels.unwrap_or(channels);
            let ticks = (seconds.max(0.05) / tempo * f64::from(rate))
                .round()
                .max(1.) as u64;
            let count = ticks.div_ceil(1024);
            index_bytes =
                index_bytes.saturating_sub(track.samples.capacity() * size_of::<Sample>());
            track.samples = Vec::new();
            if count > 200_000
                || count > (opts.limit.saturating_sub(index_bytes) / size_of::<Sample>()) as u64
            {
                return Err("sample index exceeds memory budget".into());
            }
            let data = super::super::adts::silent(channels);
            track.samples = (0..count)
                .map(|i| Sample {
                    data: data.into(),
                    duration: (ticks - i * 1024).min(1024) as u32,
                    cts: 0,
                    key: true,
                    description: 1,
                })
                .collect();
            index_bytes += track.samples.capacity() * size_of::<Sample>();
            track.scale = rate;
            track.media_ticks = ticks as u32;
            if track.edits.is_empty() {
                track.movie_ticks =
                    (ticks as f64 * f64::from(scale) / f64::from(rate)).round() as u32;
            }
            track.volume = (volume * 256.).round() as i32 as u32;
            track.first_dts = 0;
            track.stsd = audio_entry(rate, channels, 2).into();
        }
    }
    if (sources.len() > 1 || opts.concat.as_ref().is_some_and(|c|c.timings.is_some()))
        && let Some(decoded) = opts.concat.as_deref_mut()
    {
        tracks = concat::join(tracks, sources, inputs, opts.input_times, scale, opts.limit, decoded)?;
    }
    if opts.concat.is_none() {
        for (i, t) in tracks.iter_mut().enumerate() {
            t.id = i as u32 + 1;
        }
    }
    if loops != 0 {
        repeat_tracks(&mut tracks, loops, scale, opts.loop_duration, opts.end.map(|end| end - opts.start.unwrap_or(0.)), opts.limit)?;
    }
    let mut metadata = BTreeMap::new();
    let mut chapters = Vec::new();
    let output_chapters = super::output_chapters(inputs, &opts)?;
    for (j, &(_, movie, ..)) in sources[..if opts.maps.is_empty() && opts.concat.is_none() {
        sources.len()
    } else {
        1
    }]
        .iter()
        .enumerate()
    {
        if matches!(inputs[j], MediaInput::Images(_) | MediaInput::Bytes("lavfi", _))
            && !(opts.audio_codec == Some("wavpack") && matches!(sources[j].2, Streams::GeneratedAudio(_))) {
            metadata.insert("encoder".into(), "@poe-code/mp4-ast".into());
        }
        if let Streams::TextSubtitles(doc) = &sources[j].2 { metadata.extend(doc.tags.iter().cloned()); }
        if let Streams::Wavpack(doc) = &sources[j].2 { metadata.extend(doc.tags.iter().cloned()); }
        metadata.extend(super::text_tags(movie).map(|(k, v)| (k.to_owned(), v)));
    }
    if !output_chapters.is_empty() {
        chapters.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0, output_chapters.len().min(255) as u8]);
        for c in output_chapters.iter().take(255) {
            let start = super::super::lrc::rescale(c.start, (1, i64::from(c.scale)), 10_000_000);
            chapters.extend_from_slice(&(start as u64).to_be_bytes());
            let title = c.title.as_deref().unwrap_or("").as_bytes();
            let take = title.len().min(255);
            chapters.push(take as u8);
            chapters.extend_from_slice(&title[..take]);
        }
    }
    if opts.disable_chpl { chapters.clear(); }
    metadata.extend(opts.metadata.iter().cloned());
    if !opts.metadata.iter().any(|(key, _)| key == "date")
        && let Some((_, year)) = opts.metadata.iter().find(|(key, _)| key == "year")
    {
        metadata.insert("date".into(), year.clone());
    }
    if matches!(opts.format,"mpegts"|"avi"|"flv"|"mkv"|"webm") {
        if encode_aac { audio.clear_samples = false; audio.rate = None; audio.channels = None; }
        let duration = if let Some(sequence) = &composed && matches!(opts.composition, Some(Composition::Fade { .. })) {
            sequence.frames.iter().map(|(_, dur)| dur).sum()
        } else if sources.len() > 1 && opts.concat.is_some() {
            sources.iter().map(|(_, _, stream)| (0..stream.len()).map(|i| stream.seconds(i)).fold(0., f64::max)).sum()
        } else {
            presentation_duration(sources, &selected, scale, range)
        };
        // Numbered images release the template MP4 backing their codec description.
        if matches!(opts.format,"flv"|"avi"|"mpegts") && selected.iter().find(|&&(j,i)| sources[j].2.kind(i)=="video").is_some_and(|&(j,_)|matches!(sources[j].2,Streams::Images(_))) {
            return Err("Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer".into());
        }
        if matches!(opts.format, "mkv" | "webm") && opts.video_codec == Some("copy") && opts.frames.is_some() {
            let stop = tracks.iter().filter(|t| t.kind == "video").map(|t| {
                let mut dts = t.first_dts;
                t.samples.iter().map(|s| {
                    dts += u64::from(s.duration);
                    (dts as f64 + s.cts as f64) / f64::from(t.scale)
                }).last().unwrap_or(0.)
            }).reduce(f64::min);
            if let Some(stop) = stop {
                for t in &mut tracks {
                    if t.kind == "audio" && opts.audio_codec != Some("copy") || t.kind == "subtitle" && opts.subtitle_codec != Some("copy") { continue; }
                    let mut dts = t.first_dts;
                    t.samples.retain(|s| {
                        dts += u64::from(s.duration);
                        (dts as f64 + s.cts as f64) / f64::from(t.scale) <= stop + 1e-9
                    });
                }
            }
        }
        let mut source_tags = vec![Original::None; tracks.len()];
        if range.is_none() && opts.concat.is_none() && opts.composition.is_none() && loops == 0 {
            for (tags,&(j,i)) in source_tags.iter_mut().zip(&selected) {
                if encode_aac && sources[j].2.kind(i)=="audio" && (opts.audio_codec==Some("aac") || opts.rate.is_some() || opts.channels.is_some() || !opts.audio_filters.is_empty()) { continue; }
                if sources[j].2.kind(i)=="video" && !opts.video_filters.is_empty() {continue;}
                if let Streams::Mp4(tracks)=&sources[j].2 {
                    *tags=tracks[i].0.packet_origin(sources[j].0.len());
                }
            }
        }
        if opts.format=="mpegts" {return mpegts::write(&tracks,&audio,&source_tags).map_err(str::to_owned);}
        if opts.format=="avi" {return avi::write(&tracks,duration,&audio,&source_tags).map_err(str::to_owned);}
        if opts.format=="flv" {
            let tags=["video","audio"].map(|kind|tracks.iter().position(|t|t.kind==kind).map_or(Original::None,|i|source_tags[i]));
            return flv::write(&tracks,duration,&audio,tags).map_err(str::to_owned);
        }
        let mut duration = if opts.audio_codec == Some("wavpack") {
            tracks.iter().map(|t| f64::from(t.media_ticks) / f64::from(t.scale)).fold(0., f64::max)
        } else if duration.is_finite() { duration } else { 0. };
        if opts.audio_codec != Some("copy") && range.is_none() {
            // AAC decoding retains the final full frame beyond the presentation edit.
            for &(j, i) in &selected {
                if let Streams::Mp4(tracks) = &sources[j].2 {
                    let track = &tracks[i].0;
                    if track.codec().0 == "aac" {
                        let rate = track.audio.as_ref().map_or(track.scale, |a| a.rate);
                        duration = duration.max(track.stats.count as f64 * 1024. / f64::from(rate));
                    }
                }
            }
        }
        if opts.format == "webm" {
            for (t, &(j, i)) in tracks.iter().zip(&selected) {
                let codec = match t.kind { "video" => opts.video_codec, "audio" => opts.audio_codec, _ => opts.subtitle_codec };
                if codec != Some("copy") { continue; }
                let tag = t.stsd.get(12..16).unwrap_or_default();
                let allowed = match t.kind {
                    "video" => matches!(tag, b"vp08" | b"vp09" | b"av01"),
                    "audio" => matches!(tag, b"vorb" | b"Opus"),
                    "subtitle" => tag == b"wvtt",
                    _ => false,
                };
                if !allowed {
                    let name = match &sources[j].2 {
                        Streams::Mp4(tracks) => tracks[i].0.codec().0,
                        Streams::Wavpack(_) => "wavpack",
                        Streams::Captions(_) => "subrip",
                        Streams::TextSubtitles(doc) => doc.format,
                        _ => std::str::from_utf8(tag).unwrap_or("unknown").trim(),
                    };
                    return Err(format!("Cannot copy {} codec '{name}' to webm; use {} transcoding.", t.kind, t.kind));
                }
            }
        }
        if opts.audio_codec==Some("wavpack") {audio.clear_samples=false;audio.limit=opts.limit.saturating_sub(index_bytes);}
        return mkv::write(&tracks,duration,opts.format=="webm",opts.mkv_crc,&metadata,&audio,&source_tags,&output_chapters).map_err(str::to_owned);
    }
    if matches!(opts.format,"amr"|"latm") {
        if tracks.len()!=1 || tracks[0].kind!="audio" {return Err("Elementary audio output requires one audio stream".into());}
        let track=&tracks[0];let tag=track.stsd.get(12..16).unwrap_or_default();
        if opts.format=="latm" && tag==b"mp4a" {
            if track.samples.iter().any(|s|s.description!=1) {return Err("LATM does not support changing AAC configurations".into());}
            let esds=super::child(track.stsd.get(44..).unwrap_or_default(),b"esds");
            let (indication,config)=super::decoder_config(esds);
            if indication!=0x40 {return Err("LATM output requires AAC-LC".into());}
            return super::super::elementary_audio::write_latm(config.ok_or("Missing AAC AudioSpecificConfig")?,track.samples.iter().map(|s|s.data.as_ref()),opts.limit.saturating_sub(index_bytes)).map_err(str::to_owned);
        }
        let header:&[u8]=match (opts.format,tag) {("amr",b"samr")=>b"#!AMR\n",("amr",b"sawb")=>b"#!AMR-WB\n",("latm",b"\0\0\0\0")=>b"",_=>return Err("Audio codec is incompatible with this elementary container".into())};
        let mut out=header.to_vec();
        for sample in &track.samples {
            if sample.data.len()>opts.limit.saturating_sub(out.len()) {return Err("output byte limit exceeded".into());}
            out.extend_from_slice(&sample.data);
        }
        return Ok(out);
    }
    let brands = atoms(input)
        .find(|(k, _)| *k == b"ftyp")
        .or_else(|| atoms(input).find(|(k, _)| *k == b"styp"))
        .map_or(&[][..], |(_, b)| b);
    // An explicit MP4 output must not inherit QuickTime's file brand: it
    // changes how readers interpret ISO PCM entries and high sample rates.
    let brands = if opts.format == "mp4" && (brands.get(..4) == Some(b"qt  ")
        || brands.get(8..).is_some_and(|b| b.chunks_exact(4).any(|tag| tag == b"qt  "))) {
        &[][..]
    } else { brands };
    let mov = opts.format == "mov"
        || brands.get(..4) == Some(b"qt  ")
        || brands
            .get(8..)
            .is_some_and(|b| b.chunks_exact(4).any(|v| v == b"qt  "));
    let mut ftyp = Vec::new();
    ftyp.extend_from_slice(if mov {
        b"qt  "
    } else {
        brands.get(..4).unwrap_or(b"isom")
    });
    words(
        &mut ftyp,
        &[if brands.len() >= 8 {
            u32_at(brands, 4)
        } else {
            512
        }],
    );
    ftyp.extend_from_slice(if mov {
        b"qt  "
    } else if brands.len() >= 12 {
        &brands[8..brands.len() / 4 * 4]
    } else {
        b"isomiso2avc1mp41"
    });
    if let Some(hls) = opts.hls.as_ref() {
        for (i,t) in tracks.iter().enumerate() {
            if t.kind == "audio" && audio.clear_samples { stream_seconds[i] = f64::from(t.media_ticks) / f64::from(t.scale); }
        }
        let video = selected.iter().position(|&(j,i)| sources[j].2.kind(i) == "video");
        let decoded = video.is_some_and(|v| {
            let (j,_) = selected[v];
            !opts.video_filters.is_empty() || composed.is_some() || !matches!(sources[j].2, Streams::Mp4(_))
        });
        let originals = vec![Original::None; tracks.len()];
        audio.clear_samples = false;
        let timestamps: Vec<Vec<u64>> = tracks.iter().zip(&selected).map(|(t,&(j,i))| {
            if range.is_none() && opts.concat.is_none() && composed.is_none()
                && !(t.kind == "audio" && (opts.rate.is_some() || opts.channels.is_some() || !opts.audio_filters.is_empty()))
                && !(t.kind == "video" && decoded)
                && let Streams::Mp4(v) = &sources[j].2 {
                v[i].0.packet_origin(sources[j].0.len()).timestamps(t.kind == "video").take(t.samples.len()).collect()
            } else { Vec::new() }
        }).collect();
        return hls::segments(hls, tracks, &timestamps, &stream_seconds, stream_duration, decoded, scale, opts.limit, |segment| {
            if hls.fmp4 { write(segment, scale, &ftyp, &metadata, &chapters, true, true, opts.limit) }
            else { mpegts::write(segment, &audio, &originals) }
        });
    }
    if opts.format == "dash" {
        let duration = stream_duration;
        let mut manifest = format!(r#"<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT{duration:.6}S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-live:2011">
<Period id="0" start="PT0S">
"#);
        let mut remaining = opts.limit;
        for (i, track) in tracks.iter().enumerate() {
            let kind = track.kind;
            if !matches!(kind, "video" | "audio") {
                return Err("DASH output supports video and audio tracks".into());
            }
            let mut init = write(std::slice::from_ref(track), scale, &ftyp, &metadata, &chapters, true, true, remaining)?;
            remaining -= init.len();
            let bandwidth = (init.len() as f64 * 8. / duration.max(0.001)).ceil().max(1.) as u64;
            let offset = super::spans(&init).find(|(_, tag, _)| *tag == b"moof").ok_or("DASH output requires fragmented MP4 samples")?.0;
            let segment = init.split_off(offset);
            resources.push((format!("init-stream{i}.m4s"), init));
            resources.push((format!("chunk-stream{i}-00001.m4s"), segment));
            let (tag, entry) = atoms(track.stsd.get(8..).unwrap_or_default()).next().unwrap_or((b"    ", &[]));
            let avcc = child(entry.get(78..).unwrap_or_default(), b"avcC");
            let codec = if kind == "video" && avcc.len() >= 4 {
                format!("avc1.{:02x}{:02x}{:02x}", avcc[1], avcc[2], avcc[3])
            } else if tag == b"mp4a" { "mp4a.40.2".into() } else { String::from_utf8_lossy(tag).into_owned() };
            let dimensions = if kind == "video" { format!("width=\"{}\" height=\"{}\"", track.width, track.height) }
                else { format!("audioSamplingRate=\"{}\"", track.audio_format(track.scale).0) };
            let timescale = track.scale;
            let ticks = if kind == "audio" && audio.clear_samples {
                u64::from(track.media_ticks)
            } else {
                (stream_seconds[i] * f64::from(timescale)).round() as u64
            };
            manifest.push_str(&format!(r#"<AdaptationSet id="{i}" contentType="{kind}" segmentAlignment="true">
<Representation id="{i}" mimeType="{kind}/mp4" codecs="{codec}" bandwidth="{bandwidth}" {dimensions}>
<SegmentTemplate timescale="{timescale}" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"><SegmentTimeline><S t="0" d="{ticks}"/></SegmentTimeline></SegmentTemplate>
</Representation></AdaptationSet>
"#));
        }
        manifest.push_str("</Period></MPD>\n");
        if manifest.len() > remaining { return Err("output byte limit exceeded".into()); }
        return Ok(manifest.into_bytes());
    }
    if opts.concat.is_none() && !opts.input_seek && (opts.shortest || opts.start.is_some() || opts.input_times.iter().any(|s|s.start.is_some())) { tracks.retain(|t| !t.samples.is_empty()); }
    if output_chapters.iter().any(|c| c.title.is_some()) {
        if tracks.len() >= 32 { return Err("output stream count exceeds limit".into()); }
        tracks.push(chapter_track(&output_chapters, tracks.iter().map(|t| t.id).max().unwrap_or(0) + 1, scale, opts.limit)?);
    }
    if !opts.fragmented && matches!(opts.format, "mov" | "mp4") {
        let mut boundaries = vec![Vec::new(); tracks.len()];
        let mut remaining = opts.limit.saturating_sub(index_bytes);
        let mut previous = None;
        for (i, sample) in interleaved_samples(&tracks, scale) {
            if previous != Some(i) && tracks[i].pcm_stride().is_some() {
                remaining = remaining.checked_sub(size_of::<usize>()).ok_or("chunk index exceeds memory budget")?;
                boundaries[i].try_reserve_exact(1).map_err(|_|"chunk index exceeds memory budget")?;
                boundaries[i].push(sample);
            }
            previous = Some(i);
        }
        for (track, boundaries) in tracks.iter_mut().zip(&boundaries) {
            if track.pcm_stride().is_some() { remaining -= track.merge_pcm_chunks(remaining, boundaries)?; }
        }
    }
    write(
        &tracks,
        scale,
        &ftyp,
        &metadata,
        &chapters,
        opts.fragmented,
        opts.faststart,
        opts.limit,
    )
    .map_err(str::to_owned)
}
