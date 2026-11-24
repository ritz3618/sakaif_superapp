/** ダミー機能の画面(すべてのダミーで共通)。 */
import type { FeatureScreenProps } from "../../core/web/feature-api";

export default function DummyScreen({ feature, subPath }: FeatureScreenProps) {
  return (
    <div className="placeholder">
      <p>「{feature.name}」は、動作確認用のダミー機能です。</p>
      <p>機能ID: {feature.id} / パス: {subPath}</p>
    </div>
  );
}
