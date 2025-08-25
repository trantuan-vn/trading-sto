use actix_web::{cookie::Cookie, web, HttpResponse};
use actix_web::cookie::time::Duration as ActixDuration;
use log::{error, info};
use serde_json::json;

use crate::models::{AppState, LoginRequest};
use crate::utils::crypto::{create_jwt, refresh_jwt, verify_signature};

pub fn generate_challenge(address: &str, state: &AppState) -> String {
    let challenge = format!("Login challenge: {}", rand::random::<u64>());
    state
        .challenges
        .lock()
        .unwrap()
        .insert(address.to_string(), challenge.clone());
    challenge
}

pub fn login_user(body: &LoginRequest, state: &web::Data<AppState>) -> HttpResponse {
    let challenge_map = &mut *state.challenges.lock().unwrap();
    let challenge = match challenge_map.get(&body.address) {
        Some(c) => c.clone(),
        None => {
            error!("No challenge found for address: {}", body.address);
            return HttpResponse::BadRequest().body("No challenge");
        }
    };

    if !verify_signature(&challenge, &body.signature, &body.address) {
        error!("Invalid signature for address: {}", body.address);
        return HttpResponse::Unauthorized().body("Invalid signature");
    }

    let token = create_jwt(&body.address);

    let cookie = Cookie::build("access_token", token)
        .http_only(true)
        .secure(true)  // Optimized: Enable secure flag for production
        .same_site(actix_web::cookie::SameSite::Strict)  // Optimized: Prevent CSRF
        .max_age(ActixDuration::seconds(3600))
        .finish();

    info!("User logged in: {}", body.address);
    HttpResponse::Ok().cookie(cookie).json(json!({ "success": true }))
}

pub fn logout_user() -> HttpResponse {
    let cookie = Cookie::build("access_token", "")
        .http_only(true)
        .secure(true)
        .same_site(actix_web::cookie::SameSite::Strict)
        .max_age(ActixDuration::seconds(0))
        .finish();

    info!("User logged out");
    HttpResponse::Ok().cookie(cookie).json(json!({ "success": true }))
}

pub fn refresh_token(old_token: Option<&str>) -> HttpResponse {
    match old_token {
        Some(t) => match refresh_jwt(t) {
            Some(new_token) => {
                let cookie = Cookie::build("access_token", new_token)
                    .http_only(true)
                    .secure(true)
                    .same_site(actix_web::cookie::SameSite::Strict)
                    .max_age(ActixDuration::seconds(3600))
                    .finish();
                info!("Token refreshed");
                HttpResponse::Ok().cookie(cookie).json(json!({ "success": true }))
            }
            None => {
                error!("Invalid token for refresh");
                HttpResponse::Unauthorized().body("Invalid token")
            }
        },
        None => {
            error!("No token provided for refresh");
            HttpResponse::Unauthorized().body("No token")
        }
    }
}