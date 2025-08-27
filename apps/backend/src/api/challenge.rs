use worker::{Request, Response, Result, RouteContext};
use serde_json::json;

pub async fn get_challenge(_req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    // Logic để tạo và trả về một thử thách
    // Ví dụ: một chuỗi ngẫu nhiên hoặc một CAPTCHA
    let challenge_string = uuid::Uuid::new_v4().to_string(); // Chỉ là ví dụ
    Response::from_json(&json!({
        "challenge": challenge_string,
        "instructions": "Please include this challenge string in your next request."
    }))
}