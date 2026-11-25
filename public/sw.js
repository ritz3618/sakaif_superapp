/*
 * Service Worker(通知の受信と、通知をタップしたときの画面遷移)。
 * 通知はスーパーアプリ全体で共通。どの機能の通知でも、ここで受けて表示する。
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "お知らせ", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "お知らせ";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
    icon: "/pwa/app/icon-192.png",
  };
  // iPhone では、受信したら必ず通知を表示する必要がある。
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(target.href);
            return;
          } catch {
            // 移動できなければ、新しく開く
          }
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
