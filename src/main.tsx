/** 画面の入口。共通部分(core)と機能の一覧(features)を組み合わせるだけ。 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./core/web/App";
import { captureLaunchSource } from "./core/web/device";
import { registerServiceWorker } from "./core/web/push";
import { setKnownFeatureIds } from "./core/web/router";
import "./core/web/styles.css";
import { features } from "./features/registry";
import { featureScreenLoaders } from "./features/registry.web";

captureLaunchSource();
setKnownFeatureIds(features.filter((f) => f.kind === "internal").map((f) => f.id));
void registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App features={features} loaders={featureScreenLoaders} />
  </StrictMode>,
);
