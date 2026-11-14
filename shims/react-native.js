/**
 * What every `import … from "react-native"` gets on Android and iOS.
 *
 * NativeWind (react-native-css) swaps "react-native" for its own module so
 * View, Text and the rest understand className. That module re-exports a
 * fixed list of names. Anything React Native added after the list was written
 * (NativeComponentRegistry, AssetRegistry with SDK 58) came through as
 * undefined and crashed the app at start.
 *
 * This keeps NativeWind's version of each name it has and falls back to
 * React Native itself for every other name. Both stay lazy: nothing is
 * loaded until it's used. Wired up in metro.config.js.
 */
const css = require("react-native-css/components");
// metro.config.js resolves this one import to React Native itself.
const reactNative = require("react-native");

const merged = {};
const define = (source, name) => {
  Object.defineProperty(merged, name, {
    enumerable: true,
    configurable: true,
    get: () => source[name],
  });
};

// Property names only: reading a name would load the module behind it.
for (const name of Object.getOwnPropertyNames(reactNative)) define(reactNative, name);
for (const name of Object.getOwnPropertyNames(css)) define(css, name);

module.exports = merged;
