use actix_web::{get, web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;

use crate::services::ws_service::WsSession;
use crate::utils::crypto::verify_jwt;

#[get("/")]
pub async fn ws_route(req: HttpRequest, stream: web::Payload) -> Result<HttpResponse, Error> {
    let token = req.cookie("access_token").map(|c| c.value().to_string());
    if token.is_none() || verify_jwt(token.as_deref().unwrap()).is_none() {
        return Ok(HttpResponse::Unauthorized().body("Invalid token for WS"));
    }

    let claims = verify_jwt(token.as_deref().unwrap()).unwrap();
    let ws = WsSession::new(claims.address);
    ws::start(ws, &req, stream)
}