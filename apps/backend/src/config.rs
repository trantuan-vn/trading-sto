pub struct AppConfig {
    pub jwt_secret: String,
    // Thêm các cấu hình khác nếu cần, ví dụ: API keys, database connection strings
}

impl AppConfig {
    pub fn new(env: &worker::Env) -> AppConfig {
        let jwt_secret = env.secret("JWT_SECRET")
            .expect("JWT_SECRET must be set as an environment variable")
            .to_string();

        AppConfig {
            jwt_secret,
        }
    }
}