pub mod user;
pub mod token;

pub use user::*;
pub use token::*;

use worker::kv::KvStore;

pub struct AppState {
    pub kv: KvStore,
    pub config: super::config::AppConfig,
}