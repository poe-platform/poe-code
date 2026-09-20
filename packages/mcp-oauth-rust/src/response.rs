//! Allocation-free response length admission; hosts own readers and byte decoding.
pub struct ResponseBudget {
    limit: u64,
    bytes: u64,
    exceeded: bool,
}
pub fn validate_redirect(redirected: bool, response_type: &str) -> Result<(), &'static str> {
    if redirected || response_type == "opaqueredirect" {
        return Err("MCP HTTP redirects are not allowed");
    }
    Ok(())
}
impl ResponseBudget {
    pub fn new(limit: f64) -> Result<Self, &'static str> {
        if !limit.is_finite()
            || limit.fract() != 0.0
            || !(1.0..=9_007_199_254_740_991.0).contains(&limit)
        {
            return Err("HTTP response byte limit must be a positive safe integer");
        }
        Ok(Self {
            limit: limit as u64,
            bytes: 0,
            exceeded: false,
        })
    }
    fn error(&self) -> String {
        format!("HTTP response exceeds {} bytes", self.limit)
    }
    pub fn check_content_length(&mut self, length: Option<&[u16]>) -> Result<(), String> {
        if self.exceeded {
            return Err(self.error());
        }
        let Some(length) = length.filter(|length| !length.is_empty()) else {
            return Ok(());
        };
        let mut value = 0u64;
        for unit in length {
            if !(48..=57).contains(unit) {
                return Ok(());
            }
            value = value
                .saturating_mul(10)
                .saturating_add(u64::from(unit - 48));
        }
        if value > self.limit {
            self.exceeded = true;
            return Err(self.error());
        }
        Ok(())
    }
    pub fn admit(&mut self, bytes: u64) -> Result<(), String> {
        if self.exceeded {
            return Err(self.error());
        }
        let Some(total) = self
            .bytes
            .checked_add(bytes)
            .filter(|total| *total <= self.limit)
        else {
            self.exceeded = true;
            return Err(self.error());
        };
        self.bytes = total;
        Ok(())
    }
}
