# ADR-005: Single CloudFront Distribution for Frontend, API, and Images

## Status

Accepted

## Context

BadgeTag originally used two separate CloudFront distributions:

- One in `FrontendStack`, serving the React app from S3 and proxying
  `/api/*` to API Gateway (same-origin, no CORS needed for the API).
- One in `DataStack`, serving profile images from a private S3 bucket via
  Origin Access Control (OAC), on its own `*.cloudfront.net` domain.

Because the image distribution was a different origin from the frontend
app, browsers treated `image_url` values as cross-origin. This worked fine
for plain `<img>` tags (browsers don't enforce CORS for simple image
display), but broke the QR code PNG download feature: compositing the
profile photo onto a `<canvas>` requires reading the image's pixel data,
which browsers only allow for cross-origin images if the response includes
appropriate `Access-Control-Allow-Origin` headers. The image distribution
had no CORS configuration, so any canvas-based use of the photo silently
produced a tainted canvas (or a failed fetch), and the downloaded QR code
never included the photo — even though it displayed correctly on screen.

Two fixes were considered:

1. Add a CORS response headers policy to the image distribution.
2. Consolidate to a single distribution so images are same-origin with the
   app, the same way `/api/*` already avoids CORS.

Option 2 was chosen: same-origin avoids the problem category entirely
(rather than opening up cross-origin reads permanently), and removes a
whole CloudFront distribution from the infrastructure.

## Decision

Serve the frontend, the API, and profile images from a single CloudFront
distribution, owned by `FrontendStack`:

- `/*` (default behavior) — S3 static site, as before.
- `/api/*` — API Gateway origin, as before.
- `/images/*` — the profile-image S3 bucket (owned by `DataStack`),
  read-only (GET/HEAD), cached aggressively (`CACHING_OPTIMIZED`).

`DataStack` no longer creates its own CloudFront distribution; it only
exports the DynamoDB table and the private image S3 bucket.
`image_url` values returned by the API are now root-relative
(`/images/<profile_id>`) instead of absolute URLs pointing at a second
domain — `IMAGE_BASE_URL` is set to an empty string, and the existing
`images/<profile_id>` S3 key prefix supplies the leading path segment.

**Cross-stack OAC caveat:** `S3BucketOrigin.withOriginAccessControl()`,
the standard CDK helper for wiring OAC, always grants the distribution
access by adding a bucket policy statement scoped to the exact distribution
ID. When the bucket (`DataStack`) and the distribution (`FrontendStack`)
are in different stacks, that statement creates a real circular dependency:
the bucket's policy needs the distribution's ID, and the distribution's
origin needs the bucket's domain name. This is a known, unresolved CDK
limitation ([aws/aws-cdk#31462](https://github.com/aws/aws-cdk/issues/31462)).

To break the cycle, `FrontendStack`:

- Builds the `/images/*` origin manually (a minimal `OriginBase` subclass)
  instead of via the auto-granting helper.
- Grants the bucket policy itself, scoped to `cloudfront.amazonaws.com`
  with an `AWS:SourceArn` **wildcard** condition
  (`arn:aws:cloudfront::<account>:distribution/*`) rather than this exact
  distribution's ID — this only needs the account ID (available without a
  cross-stack reference), not the distribution's ID. This mirrors the same
  relaxation CDK's own `S3BucketOrigin` implementation uses for the
  analogous SSE-KMS-key case.

## Consequences

- Fixes the QR code photo-download bug: `/images/*` is same-origin, so
  canvas operations on the profile photo never taint the canvas.
- One fewer CloudFront distribution to provision, pay for, and reason
  about.
- `DataStack` has no CloudFront/CDN concerns at all now — it's purely data
  (DynamoDB + S3), which is a cleaner separation of concerns than before.
- The image bucket's policy grants read access to *any* CloudFront
  distribution in this AWS account, not just this specific one (the
  wildcard `AWS:SourceArn` condition). For a single-account, single-app
  project this is a negligible security delta — the bucket already denies
  all public access and is only reachable via a CloudFront OAC-signed
  request in the first place. If this project ever hosts multiple,
  mutually-untrusted CloudFront distributions in the same account, this
  should be tightened (e.g. by co-locating the bucket and distribution in
  one stack so the exact-ID grant can be used).
- `FrontendStack` now depends on `DataStack` (for the image bucket),
  in addition to its existing dependency on `ApiStack`.
