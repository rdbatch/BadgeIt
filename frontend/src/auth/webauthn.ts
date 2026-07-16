/**
 * Conversion helpers between Cognito's WebAuthn JSON (the standard
 * PublicKeyCredentialCreationOptionsJSON / PublicKeyCredentialRequestOptionsJSON
 * / RegistrationResponseJSON / AuthenticationResponseJSON shapes defined by
 * the WebAuthn spec) and the browser's binary navigator.credentials API,
 * which speaks ArrayBuffers rather than base64url strings.
 *
 * Newer browsers ship native convenience methods for this exact conversion
 * (PublicKeyCredential.parseCreationOptionsFromJSON/
 * parseRequestOptionsFromJSON, credential.toJSON()), but support is not yet
 * universal across browsers that otherwise support WebAuthn itself (e.g.
 * Chrome <129, Firefox <119, Safari <18.4 lack the JSON helpers while still
 * supporting navigator.credentials.create()/get() directly) — since a
 * passkey that silently breaks for a meaningful slice of users is worse
 * than the extra code here, these helpers are hand-rolled against the
 * WebAuthn spec's JSON shape directly rather than depending on those newer
 * methods.
 *
 * Kept separate from service.ts: these are pure, stateless functions with
 * no dependency on session/storage conventions, and isolate the one area
 * of this integration where Cognito's SDK types give no compile-time shape
 * guarantee (CredentialCreationOptions/CREDENTIAL_REQUEST_OPTIONS are
 * loosely typed on the wire — see risk notes in service.ts).
 */

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface CredentialDescriptorJson {
  id: string
  type: string
  transports?: AuthenticatorTransport[]
}

function toCredentialDescriptor(
  descriptor: CredentialDescriptorJson,
): PublicKeyCredentialDescriptor {
  return {
    id: base64UrlToArrayBuffer(descriptor.id),
    type: 'public-key',
    transports: descriptor.transports,
  }
}

/**
 * Converts Cognito's CredentialCreationOptions JSON (from
 * StartWebAuthnRegistration) into a real CredentialCreationOptions object
 * suitable for navigator.credentials.create() — base64url-decoding
 * `challenge`, `user.id`, and every `excludeCredentials[].id`.
 */
export function toCredentialCreationOptions(json: unknown): CredentialCreationOptions {
  const options = json as {
    rp: PublicKeyCredentialRpEntity
    user: { id: string; name: string; displayName: string }
    challenge: string
    pubKeyCredParams: PublicKeyCredentialParameters[]
    timeout?: number
    excludeCredentials?: CredentialDescriptorJson[]
    authenticatorSelection?: AuthenticatorSelectionCriteria
    attestation?: AttestationConveyancePreference
  }

  return {
    publicKey: {
      rp: options.rp,
      user: {
        id: base64UrlToArrayBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      challenge: base64UrlToArrayBuffer(options.challenge),
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      excludeCredentials: options.excludeCredentials?.map(toCredentialDescriptor),
      authenticatorSelection: options.authenticatorSelection,
      attestation: options.attestation,
    },
  }
}

/**
 * Converts Cognito's CredentialRequestOptions JSON (parsed from the
 * WEB_AUTHN challenge's CREDENTIAL_REQUEST_OPTIONS parameter) into a real
 * CredentialRequestOptions object suitable for navigator.credentials.get().
 */
export function toCredentialRequestOptions(json: unknown): CredentialRequestOptions {
  const options = json as {
    challenge: string
    timeout?: number
    rpId?: string
    allowCredentials?: CredentialDescriptorJson[]
    userVerification?: UserVerificationRequirement
  }

  return {
    publicKey: {
      challenge: base64UrlToArrayBuffer(options.challenge),
      timeout: options.timeout,
      rpId: options.rpId,
      allowCredentials: options.allowCredentials?.map(toCredentialDescriptor),
      userVerification: options.userVerification,
    },
  }
}

/**
 * Serializes a PublicKeyCredential returned by navigator.credentials.create()
 * into the RegistrationResponseJSON shape Cognito's CompleteWebAuthnRegistration
 * expects (base64url-encoded rawId/response buffers).
 */
export function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse

  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

/**
 * Serializes a PublicKeyCredential returned by navigator.credentials.get()
 * into the AuthenticationResponseJSON shape Cognito's RespondToAuthChallenge
 * (WEB_AUTHN) expects.
 */
export function serializeAuthenticationCredential(
  credential: PublicKeyCredential,
): Record<string, unknown> {
  const response = credential.response as AuthenticatorAssertionResponse

  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}
