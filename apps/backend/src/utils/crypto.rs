use ethers::types::Signature;
use ethers::utils::{hash_message, hex};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};

use crate::models::Claims;

pub fn verify_signature(challenge: &str, signature: &str, address: &str) -> bool {
    let msg_hash = hash_message(challenge);

    let sig_bytes = match hex::decode(signature.trim_start_matches("0x")) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    let signature = match Signature::try_from(sig_bytes.as_slice()) {
        Ok(sig) => sig,
        Err(_) => return false,
    };

    let recovered_addr = match signature.recover(msg_hash) {
        Ok(addr) => format!("{:?}", addr),
        Err(_) => return false,
    };

    recovered_addr.to_lowercase() == address.to_lowercase()
}

pub fn create_jwt(address: &str) -> String {
    let config = crate::config::AppConfig::from_env();  // Load config for secret
    let claims = Claims {
        address: address.to_string(),
        exp: (chrono::Utc::now().timestamp() + 3600) as usize,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_ref()),
    )
    .unwrap()
}

pub fn verify_jwt(token: &str) -> Option<Claims> {
    let config = crate::config::AppConfig::from_env();
    match decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_ref()),
        &Validation::default(),
    ) {
        Ok(data) => Some(data.claims),
        Err(_) => None,
    }
}

pub fn refresh_jwt(token: &str) -> Option<String> {
    verify_jwt(token).map(|claims| create_jwt(&claims.address))
}