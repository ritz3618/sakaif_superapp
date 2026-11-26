/** server.ts から使う共通部分の入口と、小さな補助。 */
import { formatMinutes, minutesBetween } from "../shared/format";

export { defineFeatureServer, featureContext } from "../../../core/server/feature-api";

/** ISO の時刻から今までの経過を「2時間10分」の形にする。 */
export function formatMinutesFromIso(iso: string, now: number): string {
  return formatMinutes(minutesBetween(Date.parse(iso), now));
}
