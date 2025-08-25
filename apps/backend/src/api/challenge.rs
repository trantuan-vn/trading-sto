use actix_web::{get, web, HttpRequest, HttpResponse};

use crate::services::auth_service::generate_challenge;

#[get("/challenge")]
pub async fn challenge_route(
    state: web::Data<crate::models::AppState>,
    req: HttpRequest,
) -> HttpResponse {
    let address = req.query_string().split('=').nth(1).unwrap_or_default();
    let challenge = generate_challenge(address, &state);
    HttpResponse::Ok().body(challenge)
}