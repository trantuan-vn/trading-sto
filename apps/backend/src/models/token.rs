use serde::{Deserialize, Serialize};
use chrono::{Utc, Duration};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: String,
    pub exp: i64, // Thời gian hết hạn của token (epoch timestamp)
}

impl Claims {
    pub fn new(user_id: String, expiration_minutes: i64) -> Self {
        let exp = (Utc::now() + Duration::minutes(expiration_minutes)).timestamp();
        Claims { user_id, exp }
    }

    pub fn is_valid(&self) -> bool {
        self.exp > Utc::now().timestamp()
    }
}