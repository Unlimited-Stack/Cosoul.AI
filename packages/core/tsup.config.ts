import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/db/schema.ts",
    "src/db/client.ts",
    "src/llm/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["pg"],
});
