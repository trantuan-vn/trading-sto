use actix_web::{get, web, HttpResponse};
use serde::Deserialize;

#[derive(Deserialize)]
struct QueryParams {
    address: String,
}

#[get("/challenge")]
pub async fn challenge_route(
    state: web::Data<crate::models::AppState>,
    query: web::Query<QueryParams>,
) -> HttpResponse {
    let address = &query.address;
    let challenge = crate::services::auth_service::generate_challenge(address, &state);
    HttpResponse::Ok().body(challenge)
}