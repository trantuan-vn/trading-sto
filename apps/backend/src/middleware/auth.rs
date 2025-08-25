use std::rc::Rc;
use std::task::{Context, Poll};

use actix_web::{
    dev::{Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use actix_web::body::{BoxBody, EitherBody};
use futures::future::{ready, Ready, LocalBoxFuture};

use crate::utils::crypto::verify_jwt;

pub struct AuthMiddleware;

impl<S, B> Transform<S, ServiceRequest> for AuthMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B, BoxBody>>;
    type Error = Error;
    type Transform = AuthMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AuthMiddlewareService {
            service: Rc::new(service),
        }))
    }
}

pub struct AuthMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for AuthMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B, BoxBody>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let svc = self.service.clone();
        let token = req.cookie("access_token").map(|c| c.value().to_string());

        Box::pin(async move {
            match token {
                Some(t) if verify_jwt(&t).is_some() => {
                    svc.call(req).await.map(|res| res.map_into_left_body())
                }
                _ => {
                    let (req, _pl) = req.into_parts();
                    let res = HttpResponse::Unauthorized()
                        .body("Unauthorized")
                        .map_into_boxed_body();
                    Ok(ServiceResponse::new(req, res).map_into_right_body())
                }
            }
        })
    }
}