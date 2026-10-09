// 夏躺工作表單的 service worker：讓網站能加到主畫面，並顯示推播通知。
// 不快取任何東西，永遠讀最新版網站。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// 伺服器送來的是 data 訊息，這裡自己顯示通知
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { data: { body: e.data ? e.data.text() : "" } }; }
  const d = p.data || p.notification || {};
  e.waitUntil(
    self.registration.showNotification(d.title || "夏躺工作表單", {
      body: d.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-64.png",
      tag: d.tag || undefined,
      data: { link: d.link || "./" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.link) || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
