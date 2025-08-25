use actix_web::{get, HttpResponse};

#[get("/test")]
pub async fn protected_route() -> HttpResponse {
    HttpResponse::Ok().body("You accessed protected route!")
}