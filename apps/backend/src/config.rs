use std::env;

#[derive(Clone)] // Added Clone derivation
pub struct AppConfig {
    pub jwt_secret: String,
    pub bind_address: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| "SECRET_KEY".to_string()),  // Fallback for dev
            bind_address: env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3003".to_string()),
        }
    }
}