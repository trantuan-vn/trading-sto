use std::collections::HashMap;
use std::sync::Mutex;

pub mod user;
pub mod token;

pub use user::*;
pub use token::*;

pub struct AppState {
    pub challenges: Mutex<HashMap<String, String>>,
}