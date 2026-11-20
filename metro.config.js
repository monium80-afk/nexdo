const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
	if (moduleName === "expo-file-system") {
		return context.resolveRequest(context, "expo-file-system/legacy", platform);
	}

	return defaultResolveRequest
		? defaultResolveRequest(context, moduleName, platform)
		: context.resolveRequest(context, moduleName, platform);
};

const nativewindConfig = withNativewind(config);

// NativeWind sends every "react-native" import to its own module, which
// leaves out names newer React Native versions added. Send those imports to
// shims/react-native.js instead: NativeWind's components plus everything else.
const reactNativeShim = path.resolve(__dirname, "shims/react-native.js");
const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;
nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
	if (moduleName === "react-native" && context.originModulePath === reactNativeShim) {
		// The shim's own import: React Native itself.
		return context.resolveRequest(context, moduleName, platform);
	}
	const resolution = nativewindResolveRequest(context, moduleName, platform);
	if (
		moduleName === "react-native" &&
		resolution.type === "sourceFile" &&
		/[\\/]react-native-css[\\/]dist[\\/].*components[\\/]index\.c?js$/.test(resolution.filePath)
	) {
		return { type: "sourceFile", filePath: reactNativeShim };
	}
	return resolution;
};

module.exports = nativewindConfig;
