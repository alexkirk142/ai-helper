import { useEffect, useRef } from "react";
import { wsClient } from "@/lib/websocket";

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (!("Notification" in window)) return;

    permissionRef.current = Notification.permission;

    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        permissionRef.current = perm;
      });
    }
  }, []);
}

/**
 * Show a browser notification if permission is granted and the tab is hidden.
 */
export function showBrowserNotification(title: string, body: string, conversationId?: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden) return; // Only notify when tab is in background

  const notification = new Notification(title, {
    body: body.length > 100 ? body.slice(0, 97) + "…" : body,
    icon: "/favicon.ico",
    tag: conversationId ?? "new-message",
  });

  notification.onclick = () => {
    window.focus();
    if (conversationId) {
      window.location.href = `/conversations/${conversationId}`;
    }
    notification.close();
  };
}
