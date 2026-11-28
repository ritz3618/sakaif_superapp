import { defineFeature, type FeatureMeta } from "../../core/shared/feature";

/**
 * 動作確認用のダミー機能。ホームにカードを9枚並べるために置いている。
 * 本物の機能が増えたら、その分だけ減らす(2026-11-28: 「ストック管理」を足したので、ダミー8を外して7つ)。
 */
const COLORS = ["#E76F51", "#2A9D8F", "#8E7DBE", "#4F86C6", "#D35D8B", "#6A994E", "#C77D2E"];

export default defineFeature(
  COLORS.map(
    (color, index): FeatureMeta => ({
      id: `dummy${index + 1}`,
      name: `ダミー${index + 1}`,
      kind: "internal",
      color,
      order: 100 + index,
    }),
  ),
);
