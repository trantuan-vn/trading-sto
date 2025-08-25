use actix_web::{post, web, HttpRequest, HttpResponse};

use crate::models::LoginRequest;
use crate::services::auth_service::{login_user, logout_user, refresh_token};

#[post("/login")]
pub async fn login_route(
    state: web::Data<crate::models::AppState>,
    body: web::Json<LoginRequest>,
) -> HttpResponse {
    login_user(&body, &state)
}

#[post("/logout")]
pub async fn logout_route() -> HttpResponse {
    logout_user()
}

#[post("/refresh_token")]
pub async fn refresh_token_route(req: HttpRequest) -> HttpResponse {
    let token = req.cookie("access_token").map(|c| c.value().to_string());
    refresh_token(token.as_deref())
}