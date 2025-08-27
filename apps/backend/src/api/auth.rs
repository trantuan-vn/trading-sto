use worker::{console_log, Request, Response, Result, RouteContext, Error};
use serde_json::json;
use crate::models::user::{NewUser, UserLogin};
use crate::services::auth_service;
use crate::config::AppConfig;

pub async fn register(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let app_config = AppConfig::new(&ctx.env);
    let new_user: NewUser = req.json().await?;

    match auth_service::register_user(new_user, &app_config).await {
        Ok(user) => Response::from_json(&json!({
            "message": "User registered successfully",
            "user_id": user.id,
            "username": user.username
        })),
        Err(e) => {
            console_log!("Registration error: {:?}", e);
            Response::error(format!("Failed to register user: {}", e), 500)
        }
    }
}

pub async fn login(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let app_config = AppConfig::new(&ctx.env);
    let user_login: UserLogin = req.json().await?;

    match auth_service::login_user(user_login, &app_config).await {
        Ok(token) => Response::from_json(&json!({ "token": token })),
        Err(e) => {
            console_log!("Login error: {:?}", e);
            // Sử dụng status code từ worker::Error nếu có
            let status = e.status_code();
            Response::error(format!("Failed to login: {}", e), status)
        }
    }
}