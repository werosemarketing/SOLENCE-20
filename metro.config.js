const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const existingBlockList = config.resolver.blockList || [];
const additionalBlockList = [
  /\.local\/.*/,
  /\.git\/.*/,
  /\.cache\/.*/,
];

config.watchFolders = [__dirname];
config.resolver.unstable_enableSymlinks = false;

config.resolver.blockList = Array.isArray(existingBlockList)
  ? [...existingBlockList, ...additionalBlockList]
  : additionalBlockList;

// WebRTC imports the legacy "/index" subpath, which event-target-shim 6
// does not export. Resolve its canonical entry from WebRTC's own dependency,
// without changing React Native's separate version used by abort-controller.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "event-target-shim/index" &&
      context.originModulePath.includes("react-native-webrtc")) {
    return context.resolveRequest(context, "event-target-shim", platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
