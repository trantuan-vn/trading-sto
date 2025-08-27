use async_trait::async_trait;
use worker::{console_log, Request, Response, Result, Error, RouteContext};
use crate::config::AppConfig;
use crate::utils::crypto::decode_jwt;
use crate::models::token::Claims;
use serde_json::json;

// Context key để lưu trữ thông tin Claims của người dùng sau khi xác thực
pub const AUTH_CONTEXT_KEY: &str = "auth_claims";

// Middleware function
pub fn authenticate<F>(handler: F) -> impl Fn(Request, RouteContext<()>) -> Result<Response>
where
    F: Fn(Request, RouteContext<()>) -> Result<Response> + Send + Sync + 'static,
{
    move |mut req: Request, ctx: RouteContext<()>| {
        let app_config = AppConfig::new(&ctx.env);

        let auth_header = req.headers().get("Authorization")?;

        let token = match auth_header {
            Some(header_value) => {
                if header_value.starts_with("Bearer ") {
                    header_value["Bearer ".len()..].to_string()
                } else {
                    return Response::error("Unauthorized: Invalid Authorization header format", 401);
                }
            },
            None => {
                return Response::error("Unauthorized: Missing Authorization header", 401);
            }
        };

        match decode_jwt(&token, &app_config.jwt_secret) {
            Ok(claims) => {
                // Lưu trữ claims vào request context để các handler sau có thể truy cập
                req.local_storage_set(AUTH_CONTEXT_KEY, claims)?;
                handler(req, ctx)
            },
            Err(e) => {
                console_log!("JWT decoding failed: {:?}", e);
                Response::error(format!("Unauthorized: {}", e), 401)
            }
        }
    }
}

// Hàm trợ giúp để lấy Claims từ Request
pub fn get_claims_from_request(req: &Request) -> Result<Claims> {
    req.local_storage_get(AUTH_CONTEXT_KEY)?
        .ok_or_else(|| Error::RustError("Auth claims not found in request context".to_string()))
}