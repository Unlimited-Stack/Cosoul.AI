// 加载 monorepo 根目录的 .env 文件（Next.js 默认只读 apps/web/.env）
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

module.exports = {
  reactStrictMode: true,
  // Turbopack config (Next.js 16+ default bundler)
  turbopack: {
    resolveAlias: {
      "react-native": "react-native-web",
      "react-native-safe-area-context": "./stubs/react-native-safe-area-context.js",
      "react-native-svg": "./stubs/react-native-svg.js",
      "expo-blur": "./stubs/expo-blur.js",
    },
    resolveExtensions: [
      ".web.js",
      ".web.jsx",
      ".web.ts",
      ".web.tsx",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
    ],
  },
  // Keep webpack config for non-turbopack builds
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "react-native$": "react-native-web",
    };
    config.resolve.extensions = [
      ".web.js",
      ".web.jsx",
      ".web.ts",
      ".web.tsx",
      ...config.resolve.extensions,
    ];
    return config;
  },
};
