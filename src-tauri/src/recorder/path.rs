use super::transform::f;

#[derive(Debug, Clone, Default)]
pub struct PathData {
    pub d: String,
    pub current: Option<(f64, f64)>,
}

impl PathData {
    pub fn push(&mut self, command: &str) {
        if !self.d.is_empty() {
            self.d.push(' ');
        }
        self.d.push_str(command);
    }
    pub fn command(&mut self, kind: &str, a: &[f64]) -> Result<(), String> {
        match kind {
            "move_to" if a.len() >= 2 => {
                self.push(&format!("M {} {}", f(a[0]), f(a[1])));
                self.current = Some((a[0], a[1]));
            }
            "line_to" if a.len() >= 2 => {
                self.push(&format!("L {} {}", f(a[0]), f(a[1])));
                self.current = Some((a[0], a[1]));
            }
            "bezier_curve_to" if a.len() >= 6 => {
                self.push(&format!(
                    "C {} {} {} {} {} {}",
                    f(a[0]),
                    f(a[1]),
                    f(a[2]),
                    f(a[3]),
                    f(a[4]),
                    f(a[5])
                ));
                self.current = Some((a[4], a[5]));
            }
            "quadratic_curve_to" if a.len() >= 4 => {
                self.push(&format!(
                    "Q {} {} {} {}",
                    f(a[0]),
                    f(a[1]),
                    f(a[2]),
                    f(a[3])
                ));
                self.current = Some((a[2], a[3]));
            }
            "close_path" => {
                self.push("Z");
            }
            "rect" if a.len() >= 4 => {
                self.push(&format!(
                    "M {} {} h {} v {} h {} Z",
                    f(a[0]),
                    f(a[1]),
                    f(a[2]),
                    f(a[3]),
                    f(-a[2])
                ));
                self.current = Some((a[0], a[1]));
            }
            "arc" if a.len() >= 5 => self.arc(
                a[0],
                a[1],
                a[2],
                a[2],
                0.0,
                a[3],
                a[4],
                a.get(5).copied().unwrap_or(0.0) != 0.0,
            ),
            "ellipse" if a.len() >= 7 => self.arc(
                a[0],
                a[1],
                a[2],
                a[3],
                a[4],
                a[5],
                a[6],
                a.get(7).copied().unwrap_or(0.0) != 0.0,
            ),
            "begin_path" => {
                self.d.clear();
                self.current = None;
            }
            _ => return Err(format!("invalid path command: {kind}")),
        }
        Ok(())
    }
    fn arc(
        &mut self,
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rotation: f64,
        start: f64,
        end: f64,
        anticlockwise: bool,
    ) {
        let tau = std::f64::consts::TAU;
        let mut delta = end - start;
        if anticlockwise && delta > 0.0 {
            delta -= tau;
        } else if !anticlockwise && delta < 0.0 {
            delta += tau;
        }
        let point = |angle: f64| {
            (
                cx + rx * angle.cos() * rotation.cos() - ry * angle.sin() * rotation.sin(),
                cy + rx * angle.cos() * rotation.sin() + ry * angle.sin() * rotation.cos(),
            )
        };
        let start_point = point(start);
        let end_point = point(end);
        if self.current.is_none() {
            self.push(&format!("M {} {}", f(start_point.0), f(start_point.1)));
        }
        if delta.abs() >= tau - 1e-7 {
            let mid = point(
                start
                    + if anticlockwise {
                        -std::f64::consts::PI
                    } else {
                        std::f64::consts::PI
                    },
            );
            let sweep = if anticlockwise { 0 } else { 1 };
            self.push(&format!(
                "A {} {} {} 1 {} {} {} A {} {} {} 1 {} {} {}",
                f(rx),
                f(ry),
                f(rotation.to_degrees()),
                sweep,
                f(mid.0),
                f(mid.1),
                f(rx),
                f(ry),
                f(rotation.to_degrees()),
                sweep,
                f(end_point.0),
                f(end_point.1)
            ));
        } else {
            let large = if delta.abs() > std::f64::consts::PI {
                1
            } else {
                0
            };
            let sweep = if anticlockwise { 0 } else { 1 };
            self.push(&format!(
                "A {} {} {} {} {} {} {}",
                f(rx),
                f(ry),
                f(rotation.to_degrees()),
                large,
                sweep,
                f(end_point.0),
                f(end_point.1)
            ));
        }
        self.current = Some(end_point);
    }
    pub fn closed_for_fill(&self) -> String {
        self.d
            .split(" M ")
            .map(|part| {
                if part.trim_end().ends_with('Z') || part.trim().is_empty() {
                    part.to_string()
                } else {
                    format!("{part} Z")
                }
            })
            .collect::<Vec<_>>()
            .join(" M ")
    }
}
