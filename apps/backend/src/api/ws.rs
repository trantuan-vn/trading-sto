use worker::{console_log, Request, Response, Result, RouteContext, WebSocketPair};
use crate::services::ws_service;

pub async fn handle_websocket(req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    // Kiểm tra xem yêu cầu có phải là WebSocket upgrade request không
    if req.headers().get("upgrade")?.map_or(false, |h| h.eq_ignore_ascii_case("websocket")) {
        console_log!("Handling WebSocket upgrade request.");

        // Tạo một cặp WebSocket
        let pair = WebSocketPair::new()?;

        // Chuyển kết nối WebSocket cho service xử lý
        ws_service::handle_ws_connection(pair.client).await?;

        // Trả về phản hồi upgrade WebSocket cho client
        // (Được đề cập trong worker-sys/src/ext/websocket.rs [14])
        Ok(pair.response())
    } else {
        Response::error("Expected a WebSocket upgrade request", 400)
    }
}