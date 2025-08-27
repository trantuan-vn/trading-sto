use worker::{Request, Response, Result, RouteContext};
use serde_json::json;
use crate::middleware::auth::get_claims_from_request;

pub async fn get_protected_data(req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    // Lấy thông tin claims từ request context đã được middleware thêm vào
    let claims = get_claims_from_request(&req)?;

    Response::from_json(&json!({
        "message": "You have accessed protected data!",
        "user_id": claims.user_id,
        "token_expires_at": claims.exp
    }))
}