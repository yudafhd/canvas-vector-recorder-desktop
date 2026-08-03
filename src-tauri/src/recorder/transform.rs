use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Matrix(pub [f64; 6]);

impl Default for Matrix {
    fn default() -> Self {
        Self([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    }
}

impl Matrix {
    pub fn svg(self) -> String {
        format!(
            "matrix({} {} {} {} {} {})",
            f(self.0[0]),
            f(self.0[1]),
            f(self.0[2]),
            f(self.0[3]),
            f(self.0[4]),
            f(self.0[5])
        )
    }
    pub fn from_slice(value: Option<[f64; 6]>) -> Self {
        Self(value.unwrap_or(Self::default().0))
    }
}

pub fn f(value: f64) -> String {
    if !value.is_finite() {
        return "0".into();
    }
    let rounded = (value * 10_000.0).round() / 10_000.0;
    let mut text = format!("{rounded:.4}");
    while text.contains('.') && text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    if text == "-0" {
        "0".into()
    } else {
        text
    }
}
