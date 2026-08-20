package provenance

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
)

// SignerID is the server's default provenance signer identity.
const SignerID = "helm-server"

// LoadOrGenerateServerKey returns the provenance Signer for the server and its
// public key. It reads MH_PROVENANCE_PRIVATE_KEY (base64 of the raw 64-byte
// Ed25519 private key) for persistence across restarts/air-gap; otherwise it
// generates an ephemeral key.
func LoadOrGenerateServerKey() (*Signer, ed25519.PublicKey, error) {
	if b64 := os.Getenv("MH_PROVENANCE_PRIVATE_KEY"); b64 != "" {
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, nil, err
		}
		priv := ed25519.PrivateKey(raw)
		s := NewSigner(SignerID, priv)
		return s, s.PublicKey(), nil
	}
	// Ephemeral key — provenance resets across restarts unless a key is set.
	return GenerateSigner(SignerID)
}