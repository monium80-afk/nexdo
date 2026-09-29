/**
 * Where the Support section in Settings points.
 *
 * TODO: swap WEBSITE_URL for https://nexdo.app once the custom domain is live.
 * Everything lives here so it's a one-file change, not a hunt through the screens.
 */
const WEBSITE_URL = "https://nexdo.moumoubi938.workers.dev";

export const SUPPORT_LINKS = {
  helpCenter: `${WEBSITE_URL}/support/`,
  privacyPolicy: `${WEBSITE_URL}/privacy/`,
  termsOfService: `${WEBSITE_URL}/terms/`,
} as const;
