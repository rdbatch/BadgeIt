// Redirects /p/{id} and /@{slug} requests from known social-media crawler
// User-Agents to /__og/profile/{id} (or /__og/profile/@{slug}), a route that
// returns static HTML with OpenGraph/Twitter meta tags (the real /p/{id} and
// /@{slug} pages are a client-rendered SPA, which crawlers can't execute).
// Real visitors are left completely untouched — only requests whose
// User-Agent matches a known crawler get the redirect. The `@` is kept in
// the redirected path so the backend resolves it as a slug the same way it
// does for the SPA's own API calls (see ProfileStore::resolve_profile_id).
//
// This must be a 302 redirect, NOT an in-place URI rewrite: CloudFront does
// not re-match cache behaviors after a function changes the URI ("If a
// function changes the URI for a request, that doesn't change the cache
// behavior for the request or the origin that the request is forwarded to"
// — see "Restrictions on all edge functions" in the CloudFront docs). A
// rewrite therefore keeps the default behavior's S3 origin and 403s; only a
// fresh request from the crawler can match the /__og/* behavior and reach
// the API Gateway origin. The OG HTML's og:url still points at the original
// pretty URL, so unfurls display the canonical link, and 302 (not 301)
// keeps crawlers from caching the mapping across slug changes.
//
// CloudFront Functions run on a restricted JS runtime (no network calls,
// limited API surface) — keep this dependency-free and small (10 KB limit).
function handler(event) {
  var request = event.request;
  var match = request.uri.match(/^\/p\/([^/]+)$/) || request.uri.match(/^\/(@[^/]+)$/);

  if (match) {
    var uaHeader = request.headers["user-agent"];
    var userAgent = (uaHeader && uaHeader.value) || "";
    // Known unfurl bots by name, plus generic catch-alls (bot/crawler/
    // spider/etc.) so OG validators and lesser-known link-preview fetchers
    // qualify too. Real browsers contain none of these tokens, so humans
    // can't be misrouted; a tester using a plain browser UA is
    // indistinguishable from a human by design and gets the SPA.
    var isCrawler =
      /facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot|SkypeUriPreview|Applebot|redditbot|Pinterest|iMessageBot|bot|crawler|spider|scraper|preview|embed|opengraph|inspect|validator|vkShare/i.test(
        userAgent,
      );

    if (isCrawler) {
      var hostHeader = request.headers.host;
      var host = (hostHeader && hostHeader.value) || "";
      var location = (host ? "https://" + host : "") + "/__og/profile/" + match[1];
      return {
        statusCode: 302,
        statusDescription: "Found",
        headers: {
          location: { value: location },
          "cache-control": { value: "no-store" },
        },
      };
    }
  }

  return request;
}
