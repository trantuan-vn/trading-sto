use worker::{console_log, WebSocket, WebSocketPair, Result, Error};

pub async fn handle_ws_connection(ws: WebSocket) -> Result<()> {
    console_log!("WebSocket connection established.");

    ws.accept()?;

    // Gửi tin nhắn chào mừng
    ws.send_with_str("Welcome to the WebSocket service!")?;

    // Có thể thiết lập handler cho các sự kiện tin nhắn đến hoặc đóng kết nối.
    // Ví dụ: lắng nghe tin nhắn và phản hồi
    ws.onmessage(|msg| {
        console_log!("Received WS message: {:?}", msg.as_text());
        // Xử lý tin nhắn
    });

    Ok(())
}