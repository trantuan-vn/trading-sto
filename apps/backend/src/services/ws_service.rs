use std::time::Duration;

use actix::{Actor, ActorContext, AsyncContext, StreamHandler};
use actix_web::rt::time::Instant;
use actix_web_actors::ws;

pub struct WsSession {
    pub address: String,
    pub hb: Instant,
}

impl Actor for WsSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.hb(ctx);
    }
}

impl WsSession {
    pub fn new(address: String) -> Self {
        Self {
            address,
            hb: Instant::now(),
        }
    }

    fn hb(&self, ctx: &mut ws::WebsocketContext<Self>) {
        ctx.run_interval(Duration::from_secs(5), |act, ctx| {
            if Instant::now().duration_since(act.hb) > Duration::from_secs(10) {
                ctx.stop();
                return;
            }
            ctx.ping(b"ping");
        });
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WsSession {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(msg)) => {
                self.hb = Instant::now();
                ctx.pong(&msg);
            }
            Ok(ws::Message::Pong(_)) => {
                self.hb = Instant::now();
            }
            Ok(ws::Message::Text(text)) => {
                ctx.text(format!("Echo from server to {}: {}", self.address, text));
            }
            Ok(ws::Message::Binary(bin)) => ctx.binary(bin),
            Ok(ws::Message::Close(_)) => ctx.stop(),
            _ => (),
        }
    }
}