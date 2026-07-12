// Rewrites /p/{id} requests from known social-media crawler User-Agents to
// /__og/profile/{id}, a route that returns static HTML with OpenGraph/
// Twitter meta tags (the real /p/{id} page is a client-rendered SPA, which
// crawlers can't execute). Real visitors are left completely untouched —
// only requests whose User-Agent matches a known crawler are rewritten.
//
// CloudFront Functions run on a restricted JS runtime (no network calls,
// limited API surface) — keep this dependency-free and small (10 KB limit).
function handler(event) {
  var request = event.request;
  var match = request.uri.match(/^\/p\/([^/]+)$/);

  if (match) {
    var uaHeader = request.headers["user-agent"];
    var userAgent = (uaHeader && uaHeader.value) || "";
    var isCrawler =
      /facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot|SkypeUriPreview|Applebot|redditbot|Pinterest|iMessageBot/i.test(
        userAgent,
      );

    if (isCrawler) {
      request.uri = "/__og/profile/" + match[1];
    }
  }

  return request;
}
