use serde::{Deserialize};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub address: String,
    pub signature: String,
}