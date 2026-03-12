import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { config } from "dotenv";

// 加载项目根目录 .env
config({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000
  }
});
