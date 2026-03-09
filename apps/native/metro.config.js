const { getDefaultConfig } = require('expo/metro-config');
const { getWatchFolders } = require('@expo/metro-config/build/getWatchFolders');
const { getModulesPaths } = require('@expo/metro-config/build/getModulesPaths');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// 使用 Expo 官方工具自动解析 monorepo watchFolders 和 nodeModulesPaths
config.watchFolders = getWatchFolders(projectRoot);
config.resolver.nodeModulesPaths = getModulesPaths(projectRoot);

module.exports = config;
