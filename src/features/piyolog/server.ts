/**
 * ぴよログのサーバー側。
 * 第1段階では、ホームのカードに出す要約だけ。フィードの取得・保存・通知は第3段階で実装する。
 */
import { defineFeatureServer } from "../../core/server/feature-api";

export default defineFeatureServer({
  async homeSummary() {
    return "準備中";
  },
});
