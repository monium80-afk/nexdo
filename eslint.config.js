// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Build output and Expo's generated route types — neither is ours to fix,
    // and the generated router.d.ts carries a stale eslint-disable that shows
    // up as a warning on every run.
    ignores: ['dist/*', '.expo/*'],
  },
]);
