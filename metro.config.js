const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const existingBlockList = config.resolver.blockList || [];
const additionalBlockList = [
  /\.local\/.*/,
  /\.git\/.*/,
];

config.resolver.blockList = Array.isArray(existingBlockList)
  ? [...existingBlockList, ...additionalBlockList]
  : additionalBlockList;

module.exports = config;
