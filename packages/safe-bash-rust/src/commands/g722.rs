// ITU-T G.722 quantizers, logarithmic adaptation and quadrature mirror filters.
const LOWQUANTIZER: &[i32] = &[-17, -17, -17, -17, -3101, -2738, -2376, -2088,
  -1873, -1689, -1535, -1399, -1279, -1170, -1072, -982,
  -899, -822, -750, -682, -618, -558, -501, -447,
  -396, -347, -300, -254, -211, -170, -130, -91,
  3101, 2738, 2376, 2088, 1873, 1689, 1535, 1399,
  1279, 1170, 1072, 982, 899, 822, 750, 682,
  618, 558, 501, 447, 396, 347, 300, 254, 211, 170, 130, 91, 54, 17, -54, -17];
const ADAPTATIONQUANTIZER: &[i32] = &[0, -2557, -1612, -1121, -786, -530, -323, -150,
  2557, 1612, 1121, 786, 530, 323, 150, 0];
const HIGHQUANTIZER: &[i32] = &[-926, -202, 926, 202];
const LOWSTEPS: &[i32] = &[-60, 3042, 1198, 538, 334, 172, 58, -30, 3042, 1198, 538, 334, 172, 58, -30, -60];
const INVERSELOG: &[i32] = &[2048, 2093, 2139, 2186, 2233, 2282, 2332, 2383,
  2435, 2489, 2543, 2599, 2656, 2714, 2774, 2834,
  2896, 2960, 3025, 3091, 3158, 3228, 3298, 3371,
  3444, 3520, 3597, 3676, 3756, 3838, 3922, 4008];
const QMF: &[i32] = &[3, -11, 12, 32, -210, 951, 3876, -805, 362, -156, 53, -11];
const LOWTHRESHOLDS: &[i32] = &[35, 72, 110, 150, 190, 233, 276, 323, 370, 422,
  473, 530, 587, 650, 714, 786, 858, 940, 1023, 1121, 1219, 1339,
  1458, 1612, 1765, 1980, 2195, 2557, 2919];

struct Band {
    prediction: i32, zero: i32, log: i32, previous: i32, signs: [bool;2], poles: [i32;2],
    differences: [i32;6], coefficients: [i32;6], scale: i32,
}
impl Band {
    fn new(scale: i32) -> Self { Self { prediction:0, zero:0, log:0, previous:0, signs:[false;2], poles:[0;2], differences:[0;6], coefficients:[0;6], scale } }
    fn update(&mut self, delta: i32, step: i32, high: bool) {
        let negative = self.zero + delta < 0;
        let sign = if negative == self.signs[0] { -1 } else { 1 };
        self.poles[1] = (((sign * self.poles[0].clamp(-8191,8191)) >> 5) + if negative == self.signs[1] { 128 } else { -128 } + ((self.poles[1] * 127) >> 7)).clamp(-12288,12288);
        let limit = 15360 - self.poles[1]; self.poles[0] = (-192 * sign + ((self.poles[0] * 255) >> 8)).clamp(-limit,limit);
        self.signs[1] = self.signs[0]; self.signs[0] = negative; self.zero = 0;
        for i in (0..6).rev() {
            self.coefficients[i] = ((self.coefficients[i] * 255) >> 8) + if delta == 0 { 0 } else if (self.differences[i] ^ delta) < 0 { -128 } else { 128 };
            self.differences[i] = if i == 0 { delta * 2 } else { self.differences[i - 1] };
            self.zero += (self.differences[i] * self.coefficients[i]) >> 15;
        }
        let reconstructed = ((self.prediction + delta) * 2).clamp(-32768,32767);
        self.prediction = (self.zero + ((self.poles[0] * reconstructed) >> 15) + ((self.poles[1] * self.previous) >> 15)).clamp(-32768,32767);
        self.previous = reconstructed;
        self.log = (((self.log * 127) >> 7) + step).clamp(0,if high {22528} else {18432});
        let exponent = self.log - ((if high {10} else {8}) << 11);
        let mantissa = INVERSELOG[((exponent >> 6) & 31) as usize]; let shift = exponent >> 11;
        self.scale = if shift < 0 { mantissa >> -shift } else { mantissa << shift };
    }
}
pub(super) fn decode(data: &[u8], limit: usize) -> Result<Vec<u8>, &'static str> {
    let size = data.len().checked_mul(4).filter(|&n|n <= limit).ok_or("audio exceeds memory budget")?;
    let mut out=Vec::with_capacity(size); let (mut low,mut high)=(Band::new(8),Band::new(2)); let mut history=[0i32;24];
    for &code in data {
        let code=usize::from(code);
        let lo=(low.prediction + ((low.scale * LOWQUANTIZER[code & 63]) >> 10)).clamp(-16384,16383);
        let delta=(high.scale * HIGHQUANTIZER[code >> 6]) >> 10;
        let hi=(high.prediction+delta).clamp(-16384,16383);
        low.update((low.scale * ADAPTATIONQUANTIZER[(code & 63) >> 2]) >> 10,LOWSTEPS[(code & 63) >> 2],false);
        high.update(delta,if code & 64 != 0 {-214} else {798},true);
        history.copy_within(2..,0); history[22]=lo+hi; history[23]=lo-hi;
        let even:i32=(0..12).map(|i|history[i*2+1]*QMF[11-i]).sum();
        let odd:i32=(0..12).map(|i|history[i*2]*QMF[i]).sum();
        for v in [even,odd] { out.extend_from_slice(&((v >> 11).clamp(-32768,32767) as i16).to_le_bytes()); }
    }
    Ok(out)
}
pub(super) fn encode(pcm: &[u8], limit: usize) -> Result<Vec<u8>, &'static str> {
    let frames=pcm.len()/2; let size=frames.div_ceil(2);
    if size>limit {return Err("audio exceeds memory budget");}
    let mut out=Vec::with_capacity(size); let (mut low,mut high)=(Band::new(8),Band::new(2)); let mut history=[0i32;24];
    let sample=|i:usize|i32::from(i16::from_le_bytes(pcm[i*2..i*2+2].try_into().unwrap()));
    for i in 0..size {
        history.copy_within(2..,0); history[22]=sample(i*2); history[23]=sample((i*2+1).min(frames-1));
        let even:i32=(0..12).map(|i|history[i*2+1]*QMF[11-i]).sum();
        let odd:i32=(0..12).map(|i|history[i*2]*QMF[i]).sum();
        let ld=(((even+odd)>>14)-low.prediction).clamp(-32768,32767);
        let hd=(((even-odd)>>14)-high.prediction).clamp(-32768,32767);
        let magnitude=((ld ^ (ld>>31))+1)*1024;
        let index=LOWTHRESHOLDS.iter().take_while(|&&v|magnitude>v*low.scale).count();
        let lc=(if ld<0 { if index<2 {63} else {33} } else {61})-index;
        let hc=usize::from((hd ^ (hd>>31))<((141*high.scale)>>8))+if hd>=0 {2} else {0};
        low.update((low.scale*ADAPTATIONQUANTIZER[lc>>2])>>10,LOWSTEPS[lc>>2],false);
        high.update((high.scale*HIGHQUANTIZER[hc])>>10,if hc&1!=0 {-214} else {798},true);
        out.push(((hc<<6)|lc) as u8);
    }
    Ok(out)
}
