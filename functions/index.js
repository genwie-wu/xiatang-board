// 夏躺工作表單：伺服器程式（負責送出通知）
// 資料庫有變動時自動執行：建立網站內的通知（小鈴鐺），並推播到每個人開啟通知的裝置。
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted, onDocumentWritten } = require("firebase-functions/v2/firestore");

initializeApp();
setGlobalOptions({ region: "asia-east1", maxInstances: 3 });
const db = getFirestore();
const OWNER = "genwie@gmail.com";
const SITE = "https://xiatang-board.web.app/";

const md = (s) => (s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : "");
const sorted = (d) => [...(d.episodes || [])].sort((a, b) => (a.airDate || "").localeCompare(b.airDate || ""));

/** 找出要通知的人：符合身份、而且不是做這個動作的人 */
async function recipients(roles, actorEmail) {
  const snap = await db.collection("users").get();
  return snap.docs
    .filter((d) => {
      const u = d.data();
      const role = u.email === OWNER ? "admin" : u.role;
      return roles.includes(role) && u.email !== actorEmail;
    })
    .map((d) => d.id);
}

async function notify(roles, actorEmail, { title, body, link }) {
  const uids = await recipients(roles, actorEmail);
  if (!uids.length) return;
  const batch = db.batch();
  for (const uid of uids) {
    batch.set(db.collection("notifications").doc(), { uid, title, body: body || "", link: link || "#home", read: false, createdAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
}

// 1. 新增業配 → 夏躺人員、管理者
exports.onDealCreated = onDocumentCreated("deals/{id}", async (event) => {
  const d = event.data?.data();
  if (!d) return;
  const eps = sorted(d);
  await notify(["xiatang", "admin"], d.createdBy, {
    title: `新業配：${d.brand}`,
    body: `${eps.length} 集，首集 ${md(eps[0]?.airDate)} 上線`,
    link: `#deal/${event.params.id}`,
  });
});

// 2. 改到上線日／截止日 → 夏躺人員、管理者（改資訊欄、備註等不通知）
exports.onDealUpdated = onDocumentUpdated("deals/{id}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const key = (d) => JSON.stringify(sorted(d).map((x) => [x.airDate, x.scriptDue, x.roughCutDue]));
  if (key(before) === key(after)) return;
  const eps = sorted(after);
  await notify(["xiatang", "admin"], after.updatedBy, {
    title: `業配時程變更：${after.brand}`,
    body: eps.map((x, i) => `第 ${i + 1} 集 ${md(x.airDate)} 上線（口播稿 ${md(x.scriptDue)}、初剪 ${md(x.roughCutDue)}）`).join("\n"),
    link: `#deal/${event.params.id}`,
  });
});

// 3. 刪除業配 → 夏躺人員、管理者
exports.onDealDeleted = onDocumentDeleted("deals/{id}", async (event) => {
  const d = event.data?.data();
  if (!d) return;
  await notify(["xiatang", "admin"], d.deletedBy, {
    title: `業配已刪除：${d.brand}`,
    body: `原本排在 ${sorted(d).map((x) => md(x.airDate)).join("、")} 上線`,
    link: "#home",
  });
});

// 4. 管理者勾「已開發票」→ 夏躺人員、播客煮人員
exports.onInvoiced = onDocumentWritten("payments/{id}", async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : {};
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!after || !after.invoiced || before.invoiced) return;
  const deal = await db.collection("deals").doc(event.params.id).get();
  const brand = deal.exists ? deal.data().brand : after.brand || "業配";
  await notify(["xiatang", "bokezhu"], after.updatedBy, {
    title: `${brand} 已開發票`,
    body: `開立日期 ${md(after.invoiceDate)}`,
    link: `#deal/${event.params.id}`,
  });
});

// 5. 管理者按「完成結算」→ 夏躺人員（不寫金額）
exports.onSettled = onDocumentWritten("quarters/{key}", async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : {};
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!after || !after.locked || before.locked) return;
  const k = event.params.key; // 例如 2026Q3
  await notify(["xiatang"], after.lockedBy, {
    title: `${k.slice(0, 4)} 年第 ${k.slice(5)} 季已完成結算`,
    body: "明細請看 LINE",
    link: "#home",
  });
});

// 每一則通知 → 推播到這個人開啟通知的所有裝置
exports.pushNotification = onDocumentCreated("notifications/{id}", async (event) => {
  const n = event.data?.data();
  if (!n?.uid) return;
  const snap = await db.collection("pushTokens").where("uid", "==", n.uid).get();
  const docs = snap.docs.filter((d) => typeof d.data().token === "string");
  if (!docs.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: docs.map((d) => d.data().token),
    webpush: {
      headers: { Urgency: "high", TTL: String(3 * 86400) },
      data: { title: String(n.title || "夏躺工作表單"), body: String(n.body || "").slice(0, 1000), link: SITE + String(n.link || "#home"), tag: event.params.id },
    },
  });
  // 失效的裝置（解除安裝、清除資料、關掉通知）就刪掉
  const dead = res.responses
    .map((r, i) => ({ r, d: docs[i] }))
    .filter(({ r }) => !r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || ""));
  await Promise.all(dead.map(({ d }) => d.ref.delete()));
  const failed = res.responses.filter((r) => !r.success && !dead.some((x) => x.r === r));
  if (failed.length) console.error("推播失敗", failed.map((r) => r.error?.code).join(","));
});
