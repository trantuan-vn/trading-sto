use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub password_hash: String, // Lưu trữ hash của mật khẩu
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewUser {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserLogin {
    pub username: String,
    pub password: String,
}