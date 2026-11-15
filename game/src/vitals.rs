// How a person is doing (src/sandbox/vitals.ts). Only what the HUD's monitor reads, at the values a person starts
// with; the physiology that moves them is phase 2's (dev/PORT.md).

use bevy::prelude::*;

const NORMAL_HR: f32 = 72.0;
const NORMAL_MAP: f32 = 93.0;
const NORMAL_SPO2: f32 = 98.0;
const NORMAL_RR: f32 = 14.0;

#[derive(Component)]
pub struct Vitals {
    // Litres of blood a healthy body of this weight holds, and how much it holds now.
    pub full: f32,
    pub volume: f32,
    pub hr: f32,
    // Mean arterial pressure, mmHg.
    pub map: f32,
    pub spo2: f32,
    pub rr: f32,
    pub beating: bool,
    pub breathing: bool,
    pub dead: bool,
    pub injuries: Vec<String>,
}

impl Vitals {
    pub fn new(mass: f32) -> Self {
        let full = 0.07 * mass;
        Vitals { full, volume: full, hr: NORMAL_HR, map: NORMAL_MAP, spo2: NORMAL_SPO2, rr: NORMAL_RR, beating: true, breathing: true, dead: false, injuries: Vec::new() }
    }

    pub fn lost(&self) -> f32 {
        1.0 - self.volume / self.full
    }

    pub fn systolic(&self) -> i32 {
        (self.map * 1.32).round() as i32
    }

    pub fn diastolic(&self) -> i32 {
        (self.map * 0.84).round() as i32
    }

    // What a person in this state is, in a word or two.
    pub fn state(&self) -> &'static str {
        if self.dead {
            "Dead"
        } else if !self.beating {
            "Cardiac arrest"
        } else if !self.breathing {
            "Not breathing"
        } else {
            "Conscious"
        }
    }
}
