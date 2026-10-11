/**
 * Where the Support section in Settings points.
 *
 * getnexdo.app is Nexdo's own domain (bought 2026-10-04, on Cloudflare,
 * where the site is hosted). nexdo.app belongs to someone else — never point
 * this there. Everything lives here, so a change of address is a one-file change.
 */
const WEBSITE_URL = "https://getnexdo.app";

export const SUPPORT_LINKS = {
  // FAQ, the support email and a message form, all on one page.
  helpCenter: `${WEBSITE_URL}/support/`,
  feedback: `${WEBSITE_URL}/feedback/`,
  privacyPolicy: `${WEBSITE_URL}/privacy/`,
  termsOfService: `${WEBSITE_URL}/terms/`,
} as const;
