/** ストック管理のサーバー側。押したときの行き先を、押した人の設定から組み立てるだけ。 */
import { defineFeatureServer } from "../../core/server/feature-api";
import { stockUrl } from "./server/url";

export default defineFeatureServer({
  async openUrl(ctx) {
    const [userId, passphrase] = await Promise.all([ctx.settings.get("userId", ctx.user.id), ctx.settings.get("passphrase")]);
    return stockUrl(ctx.feature.url ?? "", userId, passphrase);
  },
});
