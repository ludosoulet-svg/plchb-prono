self.addEventListener("push", (event) => {
  let data = { title: "Nouveau match à pronostiquer", body: "Un nouveau match vient d'être ajouté." };
  try {
    data = event.data.json();
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
