/** 育児ログ(ぴよログのデータを使う機能)の画面。第1段階では、準備中の表示だけ。 */
import type { FeatureScreenProps } from "../../core/web/feature-api";

export default function PiyologScreen({ feature }: FeatureScreenProps) {
  return (
    <div className="placeholder">
      <p>「{feature.name}」は準備中です。</p>
      <p>経過時間の表示、通知、グラフは、このあとの段階で作ります。</p>
    </div>
  );
}
