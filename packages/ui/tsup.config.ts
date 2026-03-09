import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: {
    index: "src/index.tsx",
  },
  banner: {
    js: "'use client'",
  },
  clean: true,
  format: ["cjs", "esm"],
  external: ["react", "react-native", "react-native-svg", "expo-blur", "react-native-safe-area-context"],
  dts: true,
  ...options,
}));
