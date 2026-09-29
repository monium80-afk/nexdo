// app.config.js – extends the static app.json with PostHog extras loaded from .env
// This file replaces app.json at runtime so that Expo can read process.env variables.

/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
    posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  },
})
