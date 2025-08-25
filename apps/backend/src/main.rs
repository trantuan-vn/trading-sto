// --- Crates ngoài ---
use dotenvy::dotenv;
use env_logger::Env;
use log::info;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use actix_web::{web, App, HttpServer};

// --- Module nội bộ ---
mod config;
mod api;
mod middleware;
mod models;
mod services;
mod utils;

// --- Use nội bộ ---
use crate::config::AppConfig;
use crate::middleware::auth::AuthMiddleware;
use crate::models::AppState;

// chỉ import route handler nào bạn thực sự dùng trong main
use crate::api::{
    auth::*,
    challenge::challenge_route,
    protected::protected_route,
    ws::ws_route,
};

pub async fn init_app(config: AppConfig) -> std::io::Result<()> {
    // Create shared app state
    let state = web::Data::new(Arc::new(AppState {
        challenges: Mutex::new(HashMap::new()),
    }));
    let bind_address = config.bind_address.clone(); // Clone bind_address trước

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(state.clone()))
            .app_data(web::Data::new(config.clone()))  // Share config if needed
            .service(challenge_route)
            .service(login_route)
            .service(
                web::scope("/api")
                    .wrap(AuthMiddleware)
                    .service(protected_route)
                    .service(logout_route)
                    .service(refresh_token_route),
            )
            .service(ws_route)
    })
    .bind(bind_address)?
    .run()
    .await
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Load .env file
    dotenv().ok();

    // Initialize logging
    env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();
    info!("Starting backend server...");

    // Load configuration
    let config = AppConfig::from_env();

    // Initialize and run the app
    init_app(config).await
}