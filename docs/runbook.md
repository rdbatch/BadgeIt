# Runbook

Manual operational procedures for BadgeTag — things a human runs on demand,
as opposed to the automated CI/CD flow. Add a new section here any time we
build another one of these (a one-off migration, a manual admin job, etc.).

## Deploying

Normal deploys go through `.github/workflows/deploy.yml` (GitHub Actions,
manually triggered — see the workflow for inputs). For a local/manual
deploy instead, use `scripts/deploy-dev.sh <region>` or
`scripts/deploy-prod.sh` — see the comment header in each script for
prerequisites and options.

## OG image bulk regeneration

Regenerates the composite Open Graph share image (logo + QR code + profile
photo — see `backend/src/og_image.rs`) for existing profiles. Two cases:

- **Backfill** — profiles created before the composite-image feature
  existed only have a raw-photo fallback for `og:image`. Run this with
  `force: false` to generate a composite for just those profiles.
- **Refresh everyone** — after changing `og_image::generate`'s layout
  (e.g. the QR code sizing tweak), run this with `force: true` to
  regenerate every profile's composite, not just ones missing one.

This is a manual, admin-only operation — there's no schedule or event
source wired up. It runs as a Step Functions state machine
(`badgetag-og-regen-<environment>`) that lists every profile, then
regenerates each one through a Lambda (`badgetag-og-regen-<environment>`),
with up to 20 running concurrently and a 2-attempt retry per profile.

A `force: false` run is safe to just re-run if it fails partway through —
it only picks up profiles that still don't have a composite, so
already-regenerated ones are skipped, not redone. A `force: true` run is
**not** resumable that way: a re-run redoes everyone from scratch,
including profiles it already got to. If a `force: true` run fails
partway through, just re-run it — at the profile counts this app runs at,
redoing the whole thing is cheap; there's no partial-resume path for this
case.

### Running it

1. Find the state machine's ARN (it's not published as a stack output —
   look it up by name):

   ```bash
   aws stepfunctions list-state-machines \
     --query "stateMachines[?name=='badgetag-og-regen-<environment>'].stateMachineArn" \
     --output text
   ```

   Use the right credentials/profile for the target account — e.g.
   `--profile badgetag-prod` for prod (see `scripts/deploy-prod.sh`'s
   header comment for that profile's setup).

2. Start an execution:

   ```bash
   aws stepfunctions start-execution \
     --state-machine-arn <arn-from-step-1> \
     --input '{"force": false}'
   ```

   Swap `"force": true` to regenerate everyone regardless of whether they
   already have a composite.

3. Check on it:

   ```bash
   aws stepfunctions describe-execution --execution-arn <execution-arn-from-step-2>
   ```

   Or watch it in the AWS Console (Step Functions → State machines →
   `badgetag-og-regen-<environment>`) — the visual execution graph shows
   which profiles are in flight, succeeded, or failed. Per-profile logs
   (including which ones were skipped vs. regenerated) are in CloudWatch
   Logs under `/aws/lambda/badgetag-og-regen-<environment>`.
