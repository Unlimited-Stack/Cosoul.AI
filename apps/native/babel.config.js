// babel-preset-expo 被 npm hoist 到 monorepo 根 node_modules，
// 但 expo-router 留在 apps/native/node_modules（未被 hoist）。
// 因此 babel-preset-expo 内部的 hasModule('expo-router') 返回 false，
// expoRouterBabelPlugin 不会被加入，process.env.EXPO_ROUTER_APP_ROOT 无法被替换。
// 这里手动从 apps/native/ 上下文补充该插件。
let extraPlugins = [];
try {
  require.resolve('expo-router', { paths: [__dirname] });
  const { expoRouterBabelPlugin } = require('babel-preset-expo/build/expo-router-plugin');
  extraPlugins = [expoRouterBabelPlugin];
} catch (_) {}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: extraPlugins,
  };
};
