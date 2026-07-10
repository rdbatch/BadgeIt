use rand::RngCore;

/// Generates a random 12-character lowercase-hex profile ID token.
///
/// Backed by the OS CSPRNG (via `rand::rng()`, which uses `getrandom`/
/// `/dev/urandom` under the hood) — NOT derived from the user's email or any
/// other guessable input. 6 random bytes = 12 hex chars = 48 bits of entropy
/// (~281 trillion possible values), which keeps IDs the same length/format
/// as before (safe for existing QR codes/URLs) while making them
/// infeasible to enumerate or compute from a known email address.
///
/// The email -> profile_id mapping is stored server-side only (see
/// `store.rs`'s `EMAIL#` pointer items) — the frontend never derives its
/// own ID client-side anymore, it asks the backend for it.
pub fn generate_profile_id() -> String {
    let mut bytes = [0u8; 6];
    rand::rng().fill_bytes(&mut bytes);
    encode(&bytes)
}

fn encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generates_12_char_hex_string() {
        let id = generate_profile_id();
        assert_eq!(id.len(), 12);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generates_lowercase_hex() {
        let id = generate_profile_id();
        assert_eq!(id, id.to_lowercase());
    }

    #[test]
    fn is_not_deterministic() {
        let id1 = generate_profile_id();
        let id2 = generate_profile_id();
        assert_ne!(id1, id2, "two calls should not produce the same token");
    }

    #[test]
    fn many_calls_produce_unique_ids() {
        // Sanity check against a broken/constant RNG: 1000 draws from a
        // 48-bit space should never collide in practice.
        let ids: HashSet<String> = (0..1000).map(|_| generate_profile_id()).collect();
        assert_eq!(ids.len(), 1000);
    }
}
