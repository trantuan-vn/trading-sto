use worker::{console_log, Result, Error};
use crate::models::user::{NewUser, User, UserLogin};
use crate::utils::crypto::{hash_password, verify_password, generate_jwt};
use crate::config::AppConfig;
use std::collections::HashMap;

// Đây là một ví dụ đơn giản để lưu trữ người dùng trong bộ nhớ.
// Trong ứng dụng thực tế, bạn sẽ sử dụng KV store hoặc D1 database.
static mut USERS_DB: Option<HashMap<String, User>> = None;

pub fn initialize_users_db() {
    unsafe {
        if USERS_DB.is_none() {
            USERS_DB = Some(HashMap::new());
            console_log!("Users database initialized.");
        }
    }
}

pub async fn register_user(new_user: NewUser, app_config: &AppConfig) -> Result<User> {
    initialize_users_db();
    let hashed_password = hash_password(&new_user.password);
    let user_id = uuid::Uuid::new_v4().to_string(); // Tạo ID ngẫu nhiên
    let user = User {
        id: user_id.clone(),
        username: new_user.username.clone(),
        password_hash: hashed_password,
    };

    unsafe {
        if let Some(db) = USERS_DB.as_mut() {
            if db.contains_key(&new_user.username) {
                return Err(Error::RustError("Username already exists".to_string()));
            }
            db.insert(new_user.username, user.clone());
            console_log!("User registered: {}", user.username);
            Ok(user)
        } else {
            Err(Error::RustError("Users database not initialized".to_string()))
        }
    }
}

pub async fn login_user(user_login: UserLogin, app_config: &AppConfig) -> Result<String> {
    initialize_users_db();
    unsafe {
        if let Some(db) = USERS_DB.as_ref() {
            if let Some(user) = db.get(&user_login.username) {
                if verify_password(&user_login.password, &user.password_hash) {
                    let token = generate_jwt(user.id.clone(), &app_config.jwt_secret)?;
                    console_log!("User logged in: {}", user.username);
                    Ok(token)
                } else {
                    Err(worker::Error::from("Invalid credentials").with_status(401))
                }
            } else {
                Err(worker::Error::from("Invalid credentials").with_status(401))
            }
        } else {
            Err(worker::Error::from("Users database not initialized"))
        }
    }
}

pub async fn get_user_by_id(user_id: &str) -> Result<Option<User>> {
    initialize_users_db();
    unsafe {
        if let Some(db) = USERS_DB.as_ref() {
            // Tìm kiếm người dùng bằng ID
            // Lưu ý: `HashMap` hiện tại không tối ưu cho tìm kiếm bằng ID mà chỉ bằng username.
            // Cần một cấu trúc dữ liệu khác hoặc map ID -> username.
            // Để đơn giản, ta sẽ duyệt qua. Trong thực tế, dùng database có index.
            for user in db.values() {
                if user.id == user_id {
                    return Ok(Some(user.clone()));
                }
            }
            Ok(None)
        } else {
            Err(Error::RustError("Users database not initialized".to_string()))
        }
    }
}