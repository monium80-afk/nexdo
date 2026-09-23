import Constants from 'expo-constants'
import PostHog from 'posthog-react-native'

// Configuration loaded from app.config.js extras via expo-constants.
// Environment variables are read at build time in app.config.js.
const projectToken = Constants.expoConfig?.extra?.posthogProjectToken as string | undefined
const host =
  (Constants.expoConfig?.extra?.posthogHost as string) || 'https://us.i.posthog.com'

const isPostHogConfigured =
  Boolean(projectToken) && projectToken !== 'phc_your_project_token_here'

if (__DEV__) {
  if (!isPostHogConfigured) {
    console.warn(
      'POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, ' +
        'this causes events to be silently missed. ' +
        'This error stops appearing once POSTHOG_PROJECT_TOKEN is configured.'
    )
  } else {
    console.log('PostHog config:', {
      projectToken: 'SET',
      host,
      isConfigured: isPostHogConfigured,
    })
  }
}

/**
 * PostHog client instance for Expo.
 *
 * Configured via app.config.js extras (reads POSTHOG_PROJECT_TOKEN and
 * POSTHOG_HOST from the .env file at build time via expo-constants).
 *
 * @see https://posthog.com/docs/libraries/react-native
 */
export const posthog = new PostHog(projectToken ?? 'placeholder_key', {
  host,
  // Disable analytics entirely when no token is provided
  disabled: !isPostHogConfigured,
  // Capture app lifecycle events (installed, opened, backgrounded, etc.)
  captureNativeAppLifecycleEvents: true,
  // Batching settings
  flushAt: 20,
  flushInterval: 10000,
  maxBatchSize: 100,
  maxQueueSize: 1000,
  // Feature flags
  preloadFeatureFlags: true,
  sendFeatureFlagEvent: true,
  featureFlagsRequestTimeoutMs: 10000,
  // Network settings
  requestTimeout: 10000,
  fetchRetryCount: 3,
  fetchRetryDelay: 3000,
})

export const isPostHogEnabled = isPostHogConfigured
