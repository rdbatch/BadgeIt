/**
 * Stubs navigator.credentials.create()/get() for local mock mode, since
 * these are real browser WebAuthn APIs that fetch-interception (see
 * handlers.ts) cannot reach. Without a real authenticator (or Chrome
 * DevTools' manual WebAuthn virtual-authenticator panel), these calls
 * would hang forever or throw waiting for hardware that doesn't exist in
 * an automated/headless dev environment. This stub resolves immediately
 * with a fake-but-structurally-shaped PublicKeyCredential, so the full UI
 * flow (button clicks, loading states, success/error branches) is
 * exercisable and visually verifiable under `npm run dev:mock` without any
 * real biometric/security-key hardware.
 *
 * Only installed when mock mode is active (see install.ts) — never touches
 * navigator.credentials in dev (non-mock) or production.
 */
export function installMockWebAuthn(): void {
  const emptyBuffer = new ArrayBuffer(0)

  function fakeCredential(kind: 'create' | 'get'): PublicKeyCredential {
    const response =
      kind === 'create'
        ? ({
            clientDataJSON: emptyBuffer,
            attestationObject: emptyBuffer,
            getTransports: () => ['internal'],
          } as unknown as AuthenticatorAttestationResponse)
        : ({
            clientDataJSON: emptyBuffer,
            authenticatorData: emptyBuffer,
            signature: emptyBuffer,
            userHandle: emptyBuffer,
          } as unknown as AuthenticatorAssertionResponse)

    const credential = {
      id: 'mock-credential-id',
      rawId: emptyBuffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response,
      getClientExtensionResults: () => ({}),
    }

    // The real service.ts code narrows navigator.credentials results with
    // `instanceof PublicKeyCredential` (there's no public constructor, so
    // this plain object wouldn't otherwise satisfy that check) — reassign
    // its prototype so the mock passes the same real-world guard rather
    // than requiring a mock-only code path in service.ts.
    if (typeof PublicKeyCredential !== 'undefined') {
      Object.setPrototypeOf(credential, PublicKeyCredential.prototype)
    }

    return credential as unknown as PublicKeyCredential
  }

  // jsdom (used by vitest) has no CredentialsContainer at all — install a
  // bare object in that case rather than assigning onto `undefined`, so
  // this stub also works for unit tests exercising the passkey flow, not
  // just real (mock-mode) browsers.
  const credentials: Partial<CredentialsContainer> = navigator.credentials ?? {}
  if (!navigator.credentials) {
    Object.defineProperty(navigator, 'credentials', {
      value: credentials,
      configurable: true,
    })
  }

  credentials.create = (async () =>
    fakeCredential('create')) as typeof navigator.credentials.create
  credentials.get = (async () => fakeCredential('get')) as typeof navigator.credentials.get
}
