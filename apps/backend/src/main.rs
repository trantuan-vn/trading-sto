use worker::{event, console_log, Env, Request, Response, Result, Router};
use std::panic;

mod api;
mod config;
mod middleware;
mod models;
mod services;
mod utils;

#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: worker::Context) -> Result<Response> {
    // Cài đặt panic hook để có thông báo lỗi chi tiết hơn
    // (Được đề cập trong .fingerprint/console_error_panic_hook [8])
    #[cfg(feature = "console_error_panic_hook")]
    panic::set_hook(Box::new(console_error_panic_hook::hook));

    console_log!("Request received: {} {}", req.method(), req.url()?);

    let router = Router::new();

    // Định nghĩa các tuyến đường API
    router
        // API xác thực
        .post_as("/api/register", |req, ctx| api::auth::register(req, ctx))
        .post_as("/api/login", |req, ctx| api::auth::login(req, ctx))
        .get_as("/api/challenge", |req, ctx| api::challenge::get_challenge(req, ctx))

        // API bảo vệ (yêu cầu xác thực)
        // Sử dụng middleware để bảo vệ các tuyến này
        .get_as("/api/protected", middleware::auth::authenticate(api::protected::get_protected_data))

        // API WebSocket
        .get_as("/api/ws", |req, ctx| api::ws::handle_websocket(req, ctx))

        // Tuyến đường mặc định hoặc 404
        .or_else(|_req, _ctx| {
            Response::error("Not Found", 404)
        })
        .run(req, env)
        .await
}