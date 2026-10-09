// 手機推播：判斷這台裝置能不能開啟、取得推播權杖並記在資料庫（參考尋聲網站的做法）
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ua = () => navigator.userAgent || "";
export const isIOS = () => /iphone|ipad|ipod/i.test(ua()) || (/macintosh/i.test(ua()) && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

/** ok：可以開啟；ios-install：iPhone 要先加入主畫面；in-app：LINE 等內建瀏覽器；unsupported：不支援 */
export function support() {
  if (/line\/|fban|fbav|instagram|micromessenger/i.test(ua())) return "in-app";
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !isStandalone()) return "ios-install";
  return apis ? "ok" : "unsupported";
}

const KEY = "xiatang-push-id";
const PROMPT_KEY = "xiatang-push-prompt-dismissed";
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* 記不住也沒關係 */ } };

export const isOn = () => support() === "ok" && Notification.permission === "granted" && !!get(KEY);
export const promptDismissed = () => get(PROMPT_KEY) === "1";
export const dismissPrompt = () => set(PROMPT_KEY, "1");

/** 一定要在按鈕的 click 裡「第一個」呼叫（iPhone 規定） */
export async function askPermission() {
  if (!("Notification" in window)) return "denied";
  return Notification.requestPermission();
}

function deviceLabel() {
  const u = ua();
  const os = /iphone/i.test(u) ? "iPhone" : /ipad/i.test(u) ? "iPad" : /android/i.test(u) ? "Android" : /mac/i.test(u) ? "Mac" : /windows/i.test(u) ? "Windows" : "其他";
  const br = /edg\//i.test(u) ? "Edge" : /crios|chrome/i.test(u) ? "Chrome" : /firefox/i.test(u) ? "Firefox" : /safari/i.test(u) ? "Safari" : "";
  return [os, isStandalone() ? "主畫面 App" : br].filter(Boolean).join("・");
}
async function hash(token) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
const messagingModule = () => import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");

export async function register(app, db, uid) {
  const { getMessaging, getToken, isSupported } = await messagingModule();
  if (!(await isSupported())) throw new Error("這個瀏覽器不支援推播");
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { serviceWorkerRegistration: reg });
  if (!token) throw new Error("請確認已允許通知");
  const id = await hash(token);
  const prev = get(KEY);
  if (prev && prev !== id) await deleteDoc(doc(db, "pushTokens", prev)).catch(() => {});
  await setDoc(doc(db, "pushTokens", id), { uid, token, device: deviceLabel(), updatedAt: Date.now() });
  set(KEY, id);
}

export async function unregister(app, db) {
  const id = get(KEY);
  set(KEY, null);
  try {
    const { getMessaging, deleteToken, isSupported } = await messagingModule();
    if (await isSupported()) await deleteToken(getMessaging(app));
  } catch { /* 權杖已失效也沒關係 */ }
  if (id) await deleteDoc(doc(db, "pushTokens", id)).catch(() => {});
}

/** 登出時：這台裝置不再收到這個人的推播 */
export async function forget(db) {
  const id = get(KEY);
  if (id) { await deleteDoc(doc(db, "pushTokens", id)).catch(() => {}); set(KEY, null); }
}
