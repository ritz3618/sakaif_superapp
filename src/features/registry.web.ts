/** 機能の画面(src/features/<フォルダ>/web.tsx)を自動で集める。画面は開いたときに初めて読み込む。 */
import type { FeatureScreenLoader } from "../core/web/FeatureShell";
import { registeredFeatures } from "./registry";

const loaders = import.meta.glob<{ default: Awaited<ReturnType<FeatureScreenLoader>>["default"] }>("./*/web.tsx");

export const featureScreenLoaders: Record<string, FeatureScreenLoader> = Object.fromEntries(
  registeredFeatures.flatMap(({ meta, folder }) => {
    const loader = loaders[`./${folder}/web.tsx`];
    return loader ? [[meta.id, loader as FeatureScreenLoader]] : [];
  }),
);
