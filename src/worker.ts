/**
 * Worker の入口。共通部分(core)と機能の一覧(features)を組み合わせるだけで、処理は持たない。
 */
import { createCore } from "./core/server";
import { features } from "./features/registry";
import { featureMigrations } from "./features/registry.migrations";
import { featureServers } from "./features/registry.server";

export default createCore({ features, servers: featureServers, featureMigrations });
