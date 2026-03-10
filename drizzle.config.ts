import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/core/src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://cosoul:cosoul@db:5432/cosoul_agent",
  },
  verbose: true,
  strict: true,
});
