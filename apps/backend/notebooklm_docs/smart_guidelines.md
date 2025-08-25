# Smart Guidelines for Using workers-rs Repository

This document provides specific guidelines for developers, derived from the directory structure (`architecture_summary.md`) and code content (`detailed_code_analysis.md`) of the `cloudflare/workers-rs` repository. It focuses on practical usage and training for employees.

## Setup Instructions
Based on the repository structure and code:
- **Clone the Repository**:
  ```bash
  git clone https://github.com/cloudflare/workers-rs.git
  cd workers-rs
  ```
- **Install Dependencies**:
  - Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  - Install Wrangler: `npm install -g @cloudflare/wrangler`
- **Run worker-sandbox**:
  ```bash
  cd worker-sandbox
  wrangler dev
  ```
  The `worker-sandbox` directory (as detailed in `architecture_summary.md`) provides a minimal Worker setup with `wrangler.toml` and `src/lib.rs`. It uses `wrangler` to simulate a Cloudflare Worker locally.

## Best Practices
Derived from the code in `detailed_code_analysis.md`:
- **Error Handling**: Use `worker::Result` and `worker::Error` for robust error handling, as seen in `worker-sandbox` and `examples`.
- **Testing**: Run tests in the `tests/` directory (noted in `architecture_summary.md`) using `cargo test` to validate Worker functionality.
## Training Recommendations
Based on the repository’s structure and code content:
- **Beginners**: Start with `worker-sandbox` (as per `architecture_summary.md`). Study `src/lib.rs` to learn HTTP request handling. Replicate its setup to build a simple Worker.
- **Intermediate Developers**: Explore the `examples/` directory (e.g., `examples/http-server`, `examples/websocket`) to understand advanced Worker features like WebSocket or KV store integration.
- **Advanced Developers**: Analyze `crates/worker-macros` to understand procedural macros (e.g., `#[event(fetch)]`). Contribute to `crates/worker` by optimizing async performance or adding new APIs.
## Common Pitfalls
- **Configuration Errors**: Verify `wrangler.toml` settings (e.g., in `worker-sandbox`) against your Cloudflare account to avoid deployment issues.
- **Dependency Mismatches**: The `Cargo.toml` files (e.g., in `Root` and `crates/`) specify dependencies. Run `rustup update` to ensure compatibility.
- **Binary Files**: Some files noted in `detailed_code_analysis.md` are binary (e.g., images). Focus on text-based files (`.rs`, `.toml`, `.yml`) for development.
Use these guidelines in NotebookLM to generate summaries, FAQs, or audio overviews for training sessions.
