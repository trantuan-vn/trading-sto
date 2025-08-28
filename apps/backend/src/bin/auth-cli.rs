use clap::{Parser, Subcommand};
use ethers::signers::{LocalWallet, Signer};
use ethers::types::Address;
use ethers::utils::hash_message;
use ethers::utils::hex;
use std::str::FromStr;
use reqwest::Client;
use anyhow::Result;
use ethers::core::rand::thread_rng;

/// Ethereum Authentication CLI
#[derive(Parser)]
#[command(name = "auth-cli", version = "1.0.0")]
#[command(about = "Command-line tool for Ethereum-based authentication flow")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

/// Available commands
#[derive(Subcommand)]
enum Commands {
    /// Requests a challenge from the server for the given Ethereum address
    Challenge {
        /// Ethereum address (0x...)
        #[arg(long, value_parser = validate_address)]
        address: String,
    },
    /// Signs a challenge using the provided private key
    Sign {
        /// Private key (hex string, without 0x prefix)
        #[arg(long, value_parser = validate_private_key)]
        private_key: String,
        /// Challenge message to sign
        #[arg(long)]
        challenge: String,
    },
    /// Generates a new Ethereum wallet
    Generate,
    /// Checks if the provided private key corresponds to the given address
    Check {
        /// Ethereum address (0x...)
        #[arg(long, value_parser = validate_address)]
        address: String,
        /// Private key (hex string, without 0x prefix)
        #[arg(long, value_parser = validate_private_key)]
        private_key: String,
    },
}

/// Validates Ethereum address format
fn validate_address(s: &str) -> Result<String, String> {
    if !s.starts_with("0x") || s.len() != 42 {
        return Err("Invalid Ethereum address: must be 42 characters starting with 0x".to_string());
    }
    Address::from_str(s)
        .map(|_| s.to_string())
        .map_err(|e| format!("Invalid Ethereum address: {}", e))
}

/// Validates private key format
fn validate_private_key(s: &str) -> Result<String, String> {
    if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid private key: must be 64 hexadecimal characters".to_string());
    }
    Ok(s.to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let client = Client::new();

    match cli.command {
        Commands::Challenge { address } => {
            let url = format!("http://127.0.0.1:3003/challenge?address={}", address);
            let resp = client
                .get(&url)
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            println!("Challenge: {}", resp);
        }
        Commands::Sign { private_key, challenge } => {
            let wallet = LocalWallet::from_str(&private_key)?;
            let msg_hash = hash_message(challenge);
            let signature = wallet.sign_hash(msg_hash)?;
            println!("Address   : 0x{}", hex::encode(wallet.address()));
            println!("Signature : 0x{}", hex::encode(signature.to_vec()));
        }
        Commands::Generate => {
            let wallet = LocalWallet::new(&mut thread_rng());
            println!("Address   : 0x{}", hex::encode(wallet.address()));
            println!("PrivateKey: 0x{}", hex::encode(wallet.signer().to_bytes()));
        }
        Commands::Check { address, private_key } => {
            let expected_addr = Address::from_str(&address)?;
            let wallet = LocalWallet::from_str(&private_key)?;
            let derived_addr = wallet.address();

            println!("Provided Address : {}", expected_addr);
            println!("Derived Address  : {}", derived_addr);

            if expected_addr == derived_addr {
                println!("✅ Private key and address match!");
            } else {
                println!("❌ Private key does NOT match the provided address!");
            }
        }
    }

    Ok(())
}
