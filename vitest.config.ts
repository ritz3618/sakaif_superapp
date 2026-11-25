import { defineConfig } from "vitest/config";

// 単体テストは Node 上で実行する(Cloudflare 固有の処理は、ローカルの実行環境で別途確認する)。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
