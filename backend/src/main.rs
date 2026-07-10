// badgeit-backend
//
// This crate's binaries live in src/bin/. Each binary is a separate Lambda handler.
// Shared logic goes in src/lib.rs (create when needed).
//
// To build for Lambda: cargo lambda build --release --arm64
// To invoke locally:   cargo lambda watch
//                      cargo lambda invoke hello --data-ascii '{}'

fn main() {
    eprintln!("This binary is not intended to be run directly.");
    eprintln!("Use `cargo lambda watch` or build individual bins in src/bin/.");
    std::process::exit(1);
}
