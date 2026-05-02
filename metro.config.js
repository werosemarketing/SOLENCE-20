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

module.exports = config;
