use sha2::{Sha256, Digest};
use hmac::{Hmac, Mac};
use jwt::Header;
use crate::models::token::Claims;
use serde::{Serialize, Deserialize};
use worker::{Result, Error};

// Alias cho Hmac<Sha256>
type HmacSha256 = Hmac<Sha256>;

pub fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn verify_password(password: &str, hashed_password: &str) -> bool {
    hash_password(password) == hashed_password
}

pub fn generate_jwt(user_id: String, jwt_secret: &str) -> Result<String> {
    let claims = Claims::new(user_id, 60); // Token hết hạn sau 60 phút
    
    let header = Header::default();
    let encoding_key = jwt::EncodingKey::from_secret(jwt_secret.as_bytes());
    
    jwt::encode(&header, &claims, &encoding_key)
        .map_err(|e| Error::RustError(format!("Failed to encode JWT: {}", e)))
}

pub fn decode_jwt(token: &str, jwt_secret: &str) -> Result<Claims> {
    let decoding_key = jwt::DecodingKey::from_secret(jwt_secret.as_bytes());
    
    let token_data = jwt::decode::<Claims>(
        token,
        &decoding_key,
        &jwt::Validation::default(),
    )
    .map_err(|e| Error::RustError(format!("Failed to decode JWT: {}", e)))?;

    if !token_data.claims.is_valid() {
        return Err(Error::RustError("JWT token expired".to_string()));
    }
    
    Ok(token_data.claims)
}