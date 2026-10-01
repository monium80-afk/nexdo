/**
 * Where the Support section in Settings points.
 *
 * The site runs on Cloudflare's workers.dev address. Nexdo doesn't own
 * nexdo.app — never point this there. If Nexdo gets a domain of its own,
 * change it here: everything lives here so it's a one-file change.
 */
const WEBSITE_URL = "https://nexdo.moumoubi938.workers.dev";

export const SUPPORT_LINKS = {
  // FAQ, the support email and a message form, all on one page.
  helpCenter: `${WEBSITE_URL}/support/`,
  feedback: `${WEBSITE_URL}/feedback/`,
  privacyPolicy: `${WEBSITE_URL}/privacy/`,
  termsOfService: `${WEBSITE_URL}/terms/`,
} as const;
