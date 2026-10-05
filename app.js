import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, oauthClientId, ownerEmail } from "./config.js?v=1";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* =========================================================
   常數與小工具
   ========================================================= */
const ROLES = {
  pending: "待開通",
  xiatang: "夏躺人員",
  bokezhu: "播客煮人員",
  admin: "管理者",
};
const DEFAULT_LINKS = [
  { name: "委刊單", url: "https://drive.google.com/drive/folders/1B69sQUjJjCiGPC-nwyrbvJsxK4EIMaLu", order: 1 },
  { name: "口播音檔", url: "https://drive.google.com/drive/folders/1_MR44pmREDn7j6mKmZ4tg7xSP13ZiEiw?usp=sharing", order: 2 },
  { name: "Reels 完稿", url: "https://drive.google.com/drive/folders/17Jr3DtGAN59oLGep2Cdsp1WhGsaYVZqN", order: 3 },
];
const DEFAULT_SETTINGS = {
  shareRatio: 50, // 夏躺分得的百分比
  editFee: 3000, // 每集剪輯費
  splitCount: 2, // 盈餘均分人數
  editorName: "曼達",
  ownerName: "浚瑋",
  calendarId: "174db69e81a29aef51dc9cdefeb584fb646a8e19824be5309a061966faad6275@group.calendar.google.com",
};
const WD = ["日", "一", "二", "三", "四", "五", "六"];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? "−" : "") + "NT$" + Math.abs(v).toLocaleString("zh-TW"); };
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const uid4 = () => Math.random().toString(36).slice(2, 10);

// 所有日期都以台北時間的 "YYYY-MM-DD" 字串處理
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtD = (dt) => dt.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); };
const weekday = (s) => parseD(s).getUTCDay();
const md = (s) => { if (!s) return "—"; const [, m, d] = s.split("-"); return `${+m}/${+d}`; };
const mdw = (s) => (s ? `${md(s)}（${WD[weekday(s)]}）` : "—");
const ymLabel = (ym) => { const [y, m] = ym.split("-"); return `${y} 年 ${+m} 月`; };
const ymOf = (s) => s.slice(0, 7);
const shiftYm = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return fmtD(d).slice(0, 7); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
function wednesdaysInRange(start, end) {
  const out = [];
  let d = start;
  while (weekday(d) !== 3) d = addDays(d, 1);
  for (; d <= end; d = addDays(d, 7)) out.push(d);
  return out;
}
const monthRange = (ym) => { const start = ym + "-01"; const end = addDays(shiftYm(ym, 1) + "-01", -1); return [start, end]; };
const qKeyOf = (s) => { const [y, m] = s.split("-").map(Number); return `${y}Q${Math.ceil(m / 3)}`; };
const qRange = (k) => { const y = +k.slice(0, 4); const q = +k.slice(5); const sm = String((q - 1) * 3 + 1).padStart(2, "0"); const start = `${y}-${sm}-01`; const end = addDays(shiftYm(`${y}-${sm}`, 3) + "-01", -1); return [start, end]; };
const qLabel = (k) => { const [s, e] = qRange(k); return `${k.slice(0, 4)} 年第 ${k.slice(5)} 季（${+s.slice(5, 7)}–${+e.slice(5, 7)} 月）`; };
const shiftQ = (k, n) => { let y = +k.slice(0, 4); let q = +k.slice(5) + n; while (q < 1) { q += 4; y--; } while (q > 4) { q -= 4; y++; } return `${y}Q${q}`; };

/* =========================================================
   狀態
   ========================================================= */
const S = {
  user: null,
  profile: null,
  deals: [],
  links: [],
  settings: { ...DEFAULT_SETTINGS },
  users: [],
  payments: {},
  expenses: [],
  quarters: {},
  ui: {
    dealTab: "active",
    dealSort: "date",
    schedYm: ymOf(todayStr()),
    incomeYm: ymOf(todayStr()),
    payQ: shiftQ(qKeyOf(todayStr()), -1),
    menu: false,
  },
  loaded: { deals: false },
};
let unsubs = [];
const role = () => S.profile?.role || "pending";
const isAdmin = () => role() === "admin";
const isMember = () => ["admin", "xiatang", "bokezhu"].includes(role());
const canEdit = () => ["admin", "bokezhu"].includes(role());
const ratio = () => num(S.settings.shareRatio) / 100;

/* =========================================================
   合作資料的計算
   ========================================================= */
const epsSorted = (d) => [...(d.episodes || [])].sort((a, b) => (a.airDate || "").localeCompare(b.airDate || ""));
const epValue = (d) => (d.episodes?.length ? num(d.quote) / d.episodes.length : 0);
const isAired = (ep) => ep.airDate && ep.airDate <= todayStr();
const dealAiredCount = (d) => (d.episodes || []).filter(isAired).length;
const dealEnded = (d) => (d.episodes || []).length > 0 && dealAiredCount(d) === d.episodes.length;
const dealFirstDate = (d) => epsSorted(d)[0]?.airDate || "9999-12-31";
const dealNextEp = (d) => epsSorted(d).find((e) => !isAired(e));
function airStatus(d) {
  const n = (d.episodes || []).length;
  const a = dealAiredCount(d);
  if (n && a === n) return { text: "已上線", cls: "ok" };
  if (a > 0) return { text: `部分上線（${a}/${n}）`, cls: "warn" };
  return { text: "未上線", cls: "" };
}
function allEpisodes() {
  const out = [];
  for (const d of S.deals) {
    const eps = epsSorted(d);
    eps.forEach((ep, i) => out.push({ deal: d, ep, idx: i + 1, total: eps.length, value: epValue(d) }));
  }
  return out;
}
function monthIncome(ym) {
  const [s, e] = monthRange(ym);
  const rows = allEpisodes().filter((x) => x.ep.airDate >= s && x.ep.airDate <= e).sort((a, b) => a.ep.airDate.localeCompare(b.ep.airDate));
  const done = rows.filter((x) => isAired(x.ep)).reduce((t, x) => t + x.value, 0);
  const all = rows.reduce((t, x) => t + x.value, 0);
  return { rows, done, all };
}

/* =========================================================
   畫面外框
   ========================================================= */
const app = $("#app");

function navItems() {
  const items = [
    { h: "home", label: "首頁", ic: "◎" },
    { h: "schedule", label: "排程", ic: "▦" },
    { h: "income", label: "收入", ic: "＄" },
  ];
  if (isAdmin()) {
    items.push({ h: "payroll", label: "結算", ic: "≡" });
    items.push({ h: "admin", label: "管理", ic: "⚙" });
  }
  return items;
}
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "") || "home";
  const [page, arg] = h.split("/");
  return { page, arg };
}

function renderShell(inner) {
  const { page } = currentRoute();
  const navPage = page === "deal" ? "home" : page;
  const nav = navItems().map((n) => `<a href="#${n.h}" class="${navPage === n.h ? "active" : ""}">${n.label}</a>`).join("");
  const bnav = navItems().map((n) => `<a href="#${n.h}" class="${navPage === n.h ? "active" : ""}"><span class="ic">${n.ic}</span>${n.label}</a>`).join("");
  const u = S.user;
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">
      <a class="brand" href="#home"><img src="icons/icon-64.png" alt=""><span>夏躺工作表單</span></a>
      <nav class="nav">${nav}</nav>
      <div class="spacer"></div>
      <button class="me" id="me-btn" aria-label="帳號選單">
        <span class="role-pill">${ROLES[role()]}</span>
        ${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar"></span>`}
      </button>
      ${S.ui.menu ? `<div class="menu" id="menu">
          <div class="who"><div><b>${esc(u.displayName || "")}</b></div><div class="muted small">${esc(u.email)}</div><div class="small">${ROLES[role()]}</div></div>
          <button id="logout">登出</button></div>` : ""}
    </div></header>
    <main class="main">${inner}</main>
    <nav class="bottom-nav">${bnav}</nav>`;
  $("#me-btn").onclick = () => { S.ui.menu = !S.ui.menu; render(); };
  const lo = $("#logout"); if (lo) lo.onclick = () => { S.ui.menu = false; signOut(auth); };
}

/* =========================================================
   登入 / 待開通
   ========================================================= */
function renderLogin(err) {
  app.innerHTML = `
  <div class="splash">
    <div class="splash-art" role="img" aria-label="夏"></div>
    <div class="splash-panel">
      <div><div class="muted small">夏日只想躺在家 × 播客煮</div><h1>夏躺工作表單</h1></div>
      <p>業配排程、截止日、報價與收入，雙方在同一個地方同步。</p>
      <button class="google-btn" id="login">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        使用 Google 帳號登入
      </button>
      ${err ? `<div class="err-msg">${esc(err)}</div>` : ""}
      <p class="small muted">第一次登入後，請聯絡管理者開通你的身份。</p>
    </div>
  </div>`;
  $("#login").onclick = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") renderLogin("登入失敗：" + (e.message || e.code));
    }
  };
}
function renderPending() {
  app.innerHTML = `
  <div class="splash">
    <div class="splash-art"></div>
    <div class="splash-panel">
      <h1>請聯絡管理者開通</h1>
      <p>你已經用 <b>${esc(S.user.email)}</b> 登入，但帳號還沒有開通身份。</p>
      <p>請把這個 Email 告訴管理者，開通後這個畫面會自動更新。</p>
      <button class="btn" id="logout">登出</button>
    </div>
  </div>`;
  $("#logout").onclick = () => signOut(auth);
}

/* =========================================================
   首頁
   ========================================================= */
function linksHtml() {
  if (!S.links.length) return `<div class="muted small">尚未設定常用連結</div>`;
  return `<div class="links">${S.links.map((l) => `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="dot">↗</span>${esc(l.name)}</a>`).join("")}</div>`;
}
function dealCard(d) {
  const eps = epsSorted(d);
  const next = dealNextEp(d);
  const st = airStatus(d);
  const minutes = eps.map((e) => num(e.minutes)).filter(Boolean);
  const meta = [
    `${eps.length} 集`,
    num(d.stories) ? `限動 ${num(d.stories)} 篇` : "",
    minutes.length ? `口播 ${minutes.join("+")} 分` : "",
    d.otherSocial ? esc(d.otherSocial) : "",
  ].filter(Boolean);
  let nextHtml = "";
  if (next) {
    const i = eps.indexOf(next) + 1;
    const tags = [`<span class="tag accent">下次上線 ${mdw(next.airDate)}・第 ${i}/${eps.length} 集</span>`];
    const t = todayStr();
    for (const [k, label] of [["scriptDue", "口播稿"], ["roughCutDue", "初剪"]]) {
      if (next[k] && next[k] >= t) {
        const left = daysBetween(t, next[k]);
        tags.push(`<span class="tag ${left <= 3 ? "warn" : ""}">${label}截止 ${md(next[k])}${left === 0 ? "（今天）" : left <= 3 ? `（${left} 天後）` : ""}</span>`);
      }
    }
    nextHtml = tags.join("");
  } else {
    nextHtml = `<span class="tag ${st.cls}">${st.text}</span><span class="tag">最後上線 ${md(eps[eps.length - 1]?.airDate || "")}</span>`;
  }
  return `<div class="card deal-card" data-deal="${d.id}">
    <div><div class="name">${esc(d.brand)}</div><div class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div></div>
    <div class="price">${money(d.quote)}<div class="muted small">未稅</div></div>
    <div class="next">${nextHtml}</div>
  </div>`;
}
function renderHome() {
  const ym = ymOf(todayStr());
  const inc = monthIncome(ym);
  let deals = S.deals.filter((d) => (S.ui.dealTab === "active" ? !dealEnded(d) : dealEnded(d)));
  if (S.ui.dealSort === "name") deals.sort((a, b) => (a.brand || "").localeCompare(b.brand || "", "zh-Hant"));
  else if (S.ui.dealTab === "active") deals.sort((a, b) => (dealNextEp(a)?.airDate || dealFirstDate(a)).localeCompare(dealNextEp(b)?.airDate || dealFirstDate(b)));
  else deals.sort((a, b) => dealFirstDate(b).localeCompare(dealFirstDate(a)));
  const r = ratio();
  renderShell(`
    <div class="page-head">
      <div><h1>${esc((S.user.displayName || "").split(" ")[0] || "嗨")}，你好</h1><div class="sub">今天是 ${mdw(todayStr())}</div></div>
      ${canEdit() ? `<button class="btn primary lg" id="new-deal">＋ 新增合作</button>` : ""}
    </div>
    <div class="grid cols-2">
      <div class="stat-hero">
        <div class="label">${+ym.slice(5)} 月截至今日結案收益（未稅）</div>
        <div class="big">${money(inc.done)}</div>
        <div class="split">
          <div><span class="k">夏躺 ${Math.round(r * 100)}%</span><span class="v">${money(inc.done * r)}</span></div>
          <div><span class="k">播客煮 ${Math.round((1 - r) * 100)}%</span><span class="v">${money(inc.done * (1 - r))}</span></div>
          <div><span class="k">本月預計</span><span class="v">${money(inc.all)}</span></div>
        </div>
      </div>
      <div class="card pad">
        <div class="section-title" style="margin-bottom:10px"><h2>常用檔案</h2></div>
        ${linksHtml()}
      </div>
    </div>
    <div class="section">
      <div class="section-title">
        <div class="seg" id="tab-seg">
          <button data-v="active" class="${S.ui.dealTab === "active" ? "on" : ""}">進行中</button>
          <button data-v="ended" class="${S.ui.dealTab === "ended" ? "on" : ""}">已結束</button>
        </div>
        <div class="seg" id="sort-seg">
          <button data-v="date" class="${S.ui.dealSort === "date" ? "on" : ""}">依日期</button>
          <button data-v="name" class="${S.ui.dealSort === "name" ? "on" : ""}">依產品</button>
        </div>
      </div>
      <div class="deal-list">${deals.length ? deals.map(dealCard).join("") : `<div class="card empty">${!S.loaded.deals ? "讀取中…" : S.ui.dealTab === "active" ? "目前沒有進行中的合作" : "還沒有已結束的合作"}</div>`}</div>
    </div>`);
  $$("#tab-seg button").forEach((b) => (b.onclick = () => { S.ui.dealTab = b.dataset.v; render(); }));
  $$("#sort-seg button").forEach((b) => (b.onclick = () => { S.ui.dealSort = b.dataset.v; render(); }));
  $$("[data-deal]").forEach((el) => (el.onclick = () => (location.hash = "#deal/" + el.dataset.deal)));
  const nb = $("#new-deal"); if (nb) nb.onclick = () => openDealForm();
}

/* =========================================================
   合作細節
   ========================================================= */
function renderDeal(id) {
  const d = S.deals.find((x) => x.id === id);
  if (!d) {
    renderShell(`<button class="back" onclick="history.back()">‹ 返回</button><div class="card empty">${S.loaded.deals ? "找不到這筆合作，可能已被刪除。" : "讀取中…"}</div>`);
    return;
  }
  const eps = epsSorted(d);
  const r = ratio();
  const st = airStatus(d);
  const pay = S.payments[d.id] || {};
  const t = todayStr();
  const epHtml = eps.map((ep, i) => {
    const aired = isAired(ep);
    const left = daysBetween(t, ep.airDate);
    return `<div class="card ep-card">
      <div class="ep-head"><span class="n">第 ${i + 1} 集</span>
        <span class="tag ${aired ? "ok" : "accent"}">${aired ? "已上線" : left === 0 ? "今天上線" : `${left} 天後上線`}</span>
        ${ep.minutes ? `<span class="tag">口播 ${esc(ep.minutes)} 分鐘</span>` : ""}
      </div>
      <div class="timeline">
        <div><div class="k">口播稿截止</div><div class="v">${mdw(ep.scriptDue)}</div></div>
        <div><div class="k">初剪截止</div><div class="v">${mdw(ep.roughCutDue)}</div></div>
        <div><div class="k">正式上線</div><div class="v">${mdw(ep.airDate)} 0:00</div></div>
      </div>
      <div class="infobox-head"><span class="small muted">資訊欄內容</span>${ep.infoText ? `<button class="btn sm" data-copy="${i}">複製</button>` : ""}</div>
      <div class="infobox">${ep.infoText ? esc(ep.infoText) : `<span class="muted">（尚未填寫）</span>`}</div>
    </div>`;
  }).join("");
  renderShell(`
    <button class="back" id="back">‹ 返回</button>
    <div class="page-head">
      <div><h1>${esc(d.brand)}</h1><div class="sub"><span class="tag ${st.cls}">${st.text}</span>　${eps.length} 集・${eps.map((e) => md(e.airDate)).join("、")}</div></div>
      ${canEdit() ? `<div class="btn-row"><button class="btn" id="edit">編輯</button><button class="btn danger" id="del">刪除</button></div>` : ""}
    </div>
    <div class="card pad">
      <div class="kv">
        <div><div class="k">本次業配未稅報價</div><div class="v">${money(d.quote)}</div></div>
        <div><div class="k">夏躺分得（${Math.round(r * 100)}%）</div><div class="v">${money(num(d.quote) * r)}</div></div>
        <div><div class="k">播客煮分得（${Math.round((1 - r) * 100)}%）</div><div class="v">${money(num(d.quote) * (1 - r))}</div></div>
        <div><div class="k">執行內容</div><div class="v">${eps.length} 集口播${num(d.stories) ? `・限動 ${num(d.stories)} 篇` : ""}</div></div>
        ${d.otherSocial ? `<div><div class="k">其他社群</div><div class="v">${esc(d.otherSocial)}</div></div>` : ""}
        <div><div class="k">產品重點概要</div><div class="v">${d.briefUrl ? `<a class="btn sm" href="${esc(d.briefUrl)}" target="_blank" rel="noopener">開啟雲端硬碟 ↗</a>` : "—"}</div></div>
      </div>
      ${d.note ? `<div style="margin-top:14px"><div class="k small muted">備註</div><div style="white-space:pre-wrap">${esc(d.note)}</div></div>` : ""}
    </div>
    ${isAdmin() ? `
    <div class="section"><div class="section-title"><h2>入帳狀態</h2><span class="small muted">只有管理者看得到</span></div>
      <div class="card pad btn-row">
        <label class="toggle"><input type="checkbox" id="paid" ${pay.paid ? "checked" : ""}> 已入帳</label>
        <input type="date" class="inline-input" id="paid-date" value="${esc(pay.paidDate || "")}" ${pay.paid ? "" : "disabled"} style="width:160px">
      </div>
    </div>` : ""}
    <div class="section"><div class="section-title"><h2>各集內容</h2>
      ${canEdit() && S.settings.calendarId ? `<button class="btn sm ghost" id="resync">重新同步 Google 日曆</button>` : ""}</div>
      <div class="grid">${epHtml}</div>
    </div>`);
  $("#back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#home"));
  $$("[data-copy]").forEach((b) => (b.onclick = () => copyText(eps[+b.dataset.copy].infoText, "資訊欄內容已複製")));
  if (canEdit()) {
    $("#edit").onclick = () => openDealForm(d);
    $("#del").onclick = () => deleteDeal(d);
    const rs = $("#resync");
    if (rs) rs.onclick = async () => {
      const token = await getCalToken().catch((e) => { toast(calErr(e), true); return null; });
      if (!token) return;
      const res = await syncCalendar(d, eps, [], token);
      await updateDoc(doc(db, "deals", d.id), { episodes: res.episodes });
      toast(res.errors.length ? "部分日曆事件同步失敗：" + res.errors[0] : "日曆已同步");
    };
  }
  if (isAdmin()) {
    const cb = $("#paid"), dt = $("#paid-date");
    cb.onchange = async () => {
      const paid = cb.checked;
      const paidDate = paid ? dt.value || todayStr() : "";
      await setDoc(doc(db, "payments", d.id), { paid, paidDate, brand: d.brand }, { merge: true });
      toast(paid ? "已標記入帳" : "已改為未入帳");
    };
    dt.onchange = async () => { await setDoc(doc(db, "payments", d.id), { paidDate: dt.value }, { merge: true }); toast("入帳日已更新"); };
  }
}

async function deleteDeal(d) {
  const ok = await confirmBox(`確定要刪除「${esc(d.brand)}」嗎？`, "刪除後無法復原，Google 日曆上的相關事件也會一併刪除。", "刪除", true);
  if (!ok) return;
  let token = null;
  if (S.settings.calendarId && (d.episodes || []).some((e) => e.cal)) token = await getCalToken().catch(() => null);
  if (token) await syncCalendar(d, [], d.episodes || [], token).catch(() => {});
  await deleteDoc(doc(db, "deals", d.id));
  if (isAdmin()) await deleteDoc(doc(db, "payments", d.id)).catch(() => {});
  toast("已刪除");
  location.hash = "#home";
}

/* =========================================================
   新增 / 編輯合作
   ========================================================= */
function epEditor(ep, i) {
  return `<div class="ep-edit" data-ep="${i}" data-epid="${esc(ep.id || "")}">
    <div class="ep-edit-head"><span>第 ${i + 1} 集</span><button type="button" class="btn sm ghost danger" data-rm="${i}">移除</button></div>
    <div class="form-grid">
      <div class="field"><label>正式上線日（週三 0:00）<span class="req">*</span></label><input type="date" class="input" name="airDate" value="${esc(ep.airDate || "")}"></div>
      <div class="field"><label>口播分鐘數<span class="req">*</span></label><input type="number" step="0.5" min="0" class="input" name="minutes" value="${esc(ep.minutes ?? "")}" placeholder="例如 1.5"></div>
      <div class="field"><label>口播稿截止日<span class="req">*</span></label><input type="date" class="input" name="scriptDue" value="${esc(ep.scriptDue || "")}"></div>
      <div class="field"><label>初剪截止日<span class="req">*</span></label><input type="date" class="input" name="roughCutDue" value="${esc(ep.roughCutDue || "")}"></div>
      <div class="field full"><label>資訊欄內容</label><textarea class="input" name="infoText" placeholder="會放在節目下方資訊欄的文字">${esc(ep.infoText || "")}</textarea></div>
    </div>
  </div>`;
}
function openDealForm(deal) {
  const isNew = !deal;
  const d = deal ? JSON.parse(JSON.stringify(deal)) : { brand: "", briefUrl: "", stories: "", otherSocial: "", quote: "", note: "", episodes: [{}] };
  let eps = deal ? epsSorted(d) : d.episodes;
  const root = $("#modal-root");
  const readEps = () => $$(".ep-edit", root).map((el) => {
    const g = (n) => $(`[name=${n}]`, el).value.trim();
    const old = eps[+el.dataset.ep] || {};
    return { ...old, id: el.dataset.epid || old.id || uid4(), airDate: g("airDate"), minutes: g("minutes"), scriptDue: g("scriptDue"), roughCutDue: g("roughCutDue"), infoText: $(`[name=infoText]`, el).value };
  });
  const draw = () => {
    root.innerHTML = `<div class="modal-bg"><form class="modal" id="deal-form" novalidate>
      <div class="modal-head"><h2>${isNew ? "新增合作" : "編輯合作"}</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full"><label>品牌／產品名稱<span class="req">*</span></label><input class="input" name="brand" value="${esc(d.brand)}"></div>
          <div class="field full"><label>產品重點概要（Google 雲端硬碟連結）<span class="req">*</span></label><input class="input" name="briefUrl" value="${esc(d.briefUrl)}" placeholder="https://drive.google.com/..."></div>
          <div class="field"><label>本次業配未稅報價（新台幣）<span class="req">*</span></label><input class="input" name="quote" inputmode="numeric" value="${esc(d.quote)}" placeholder="例如 60000"></div>
          <div class="field"><label>限時動態篇數</label><input class="input" type="number" min="0" name="stories" value="${esc(d.stories)}"></div>
          <div class="field full"><label>其他社群執行內容</label><input class="input" name="otherSocial" value="${esc(d.otherSocial)}" placeholder="例如 短影音 1 支、發文 1 篇"></div>
          <div class="field full"><label>備註</label><textarea class="input" name="note" style="min-height:60px">${esc(d.note)}</textarea></div>
        </div>
        <div class="section" style="margin-top:22px">
          <div class="section-title"><h2>集數與時程</h2><span class="small muted">共 ${eps.length} 集</span></div>
          <div id="eps">${eps.map(epEditor).join("")}</div>
          <button type="button" class="btn" id="add-ep" style="margin-top:12px">＋ 新增一集</button>
        </div>
        <div class="err-msg" id="form-err" style="margin-top:14px"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn primary" id="save">儲存</button></div>
    </form></div>`;
    $$("[data-close]", root).forEach((b) => (b.onclick = () => (root.innerHTML = "")));
    $("#add-ep", root).onclick = () => {
      snapshotTop(); eps = readEps();
      const last = eps[eps.length - 1];
      const nextAir = last?.airDate ? addDays(last.airDate, 7) : "";
      eps.push({ airDate: nextAir, minutes: last?.minutes || "", scriptDue: "", roughCutDue: "" });
      draw();
    };
    $$("[data-rm]", root).forEach((b) => (b.onclick = () => {
      snapshotTop(); eps = readEps();
      if (eps.length <= 1) { $("#form-err", root).textContent = "至少要有一集。"; return; }
      eps.splice(+b.dataset.rm, 1); draw();
    }));
    $("#deal-form", root).onsubmit = (e) => { e.preventDefault(); save(); };
  };
  const snapshotTop = () => {
    const f = $("#deal-form", root);
    for (const k of ["brand", "briefUrl", "quote", "stories", "otherSocial", "note"]) d[k] = f.elements[k].value;
  };
  const save = async () => {
    snapshotTop();
    eps = readEps();
    const errs = [];
    const f = $("#deal-form", root);
    $$(".input", root).forEach((i) => i.classList.remove("err"));
    const mark = (el) => el && el.classList.add("err");
    if (!d.brand.trim()) { errs.push("請填品牌／產品名稱"); mark(f.elements.brand); }
    if (!d.briefUrl.trim()) { errs.push("請貼上產品重點概要連結"); mark(f.elements.briefUrl); }
    else if (!/^https?:\/\//.test(d.briefUrl.trim())) { errs.push("產品重點概要要是完整網址（https:// 開頭）"); mark(f.elements.briefUrl); }
    if (!(num(d.quote) > 0)) { errs.push("請填未稅報價（數字）"); mark(f.elements.quote); }
    $$(".ep-edit", root).forEach((el, i) => {
      const ep = eps[i];
      const n = `第 ${i + 1} 集`;
      for (const [k, label] of [["airDate", "上線日"], ["minutes", "口播分鐘數"], ["scriptDue", "口播稿截止日"], ["roughCutDue", "初剪截止日"]]) {
        if (!ep[k]) { errs.push(`${n}：請填${label}`); mark($(`[name=${k}]`, el)); }
      }
      if (ep.airDate && weekday(ep.airDate) !== 3) { errs.push(`${n}：上線日要是星期三（你選的是星期${WD[weekday(ep.airDate)]}）`); mark($("[name=airDate]", el)); }
      if (ep.airDate && ep.scriptDue && ep.scriptDue >= ep.airDate) { errs.push(`${n}：口播稿截止日要早於上線日`); mark($("[name=scriptDue]", el)); }
      if (ep.airDate && ep.roughCutDue && ep.roughCutDue >= ep.airDate) { errs.push(`${n}：初剪截止日要早於上線日`); mark($("[name=roughCutDue]", el)); }
    });
    const dates = eps.map((e) => e.airDate).filter(Boolean);
    if (new Set(dates).size !== dates.length) errs.push("同一檔合作有兩集排在同一天");
    if (errs.length) { $("#form-err", root).innerHTML = errs.map(esc).join("<br>"); return; }

    // 日曆授權要在按下儲存的當下要，否則瀏覽器會擋住彈出視窗
    const calOn = !!S.settings.calendarId;
    const tokenP = calOn ? getCalToken().catch((e) => ({ error: e })) : Promise.resolve(null);

    const clashes = [];
    for (const ep of eps) {
      for (const other of S.deals) {
        if (other.id === deal?.id) continue;
        if ((other.episodes || []).some((x) => x.airDate === ep.airDate)) clashes.push(`${md(ep.airDate)} 已有「${other.brand}」`);
      }
    }
    if (clashes.length) {
      const ok = await confirmBox("這些週三已經有別的業配", esc(clashes.join("、")) + "<br>仍要儲存嗎？", "仍要儲存");
      if (!ok) return;
    }
    const btn = $("#save", root); btn.disabled = true; btn.textContent = "儲存中…";
    const data = {
      brand: d.brand.trim(), briefUrl: d.briefUrl.trim(), quote: num(d.quote), stories: num(d.stories),
      otherSocial: d.otherSocial.trim(), note: d.note.trim(),
      episodes: [...eps].sort((a, b) => a.airDate.localeCompare(b.airDate)).map((e) => ({ id: e.id, airDate: e.airDate, minutes: e.minutes, scriptDue: e.scriptDue, roughCutDue: e.roughCutDue, infoText: e.infoText || "", cal: e.cal || null })),
      updatedAt: serverTimestamp(), updatedBy: S.user.email,
    };
    try {
      let ref;
      if (isNew) { data.createdAt = serverTimestamp(); data.createdBy = S.user.email; ref = await addDoc(collection(db, "deals"), data); }
      else { ref = doc(db, "deals", deal.id); await updateDoc(ref, data); }
      root.innerHTML = "";
      toast(isNew ? "已新增合作" : "已儲存");
      if (calOn) {
        const token = await tokenP;
        if (!token || token.error) { toast("合作已儲存，但日曆沒有同步：" + calErr(token?.error), true); }
        else {
          const removed = (deal?.episodes || []).filter((o) => !data.episodes.some((n) => n.id === o.id));
          const res = await syncCalendar({ ...data, id: ref.id }, data.episodes, removed, token);
          await updateDoc(ref, { episodes: res.episodes });
          if (res.errors.length) toast("日曆同步有問題：" + res.errors[0], true); else toast("已同步到 Google 日曆");
        }
      }
      if (isNew) location.hash = "#deal/" + ref.id;
    } catch (e) {
      btn.disabled = false; btn.textContent = "儲存";
      $("#form-err", root).textContent = "儲存失敗：" + (e.message || e);
    }
  };
  draw();
}

/* =========================================================
   排程表
   ========================================================= */
function renderSchedule() {
  const ym = S.ui.schedYm;
  const [s, e] = monthRange(ym);
  const t = todayStr();
  const eps = allEpisodes();
  const weds = wednesdaysInRange(s, e);
  const rows = weds.map((w) => {
    const items = eps.filter((x) => x.ep.airDate === w);
    return `<div class="card sched-row ${w < t ? "past" : ""} ${w === t ? "today" : ""}">
      <div class="d"><div class="md">${md(w)}</div><div class="wd">星期三</div></div>
      <div class="sched-items">${items.length ? items.map((x) => `<span class="sched-item" data-deal="${x.deal.id}">${esc(x.deal.brand)}<span class="ep">第 ${x.idx}/${x.total} 集</span></span>`).join("") : `<span class="none">無業配</span>`}</div>
    </div>`;
  }).join("");
  const dues = [];
  for (const x of eps) {
    if (x.ep.scriptDue >= s && x.ep.scriptDue <= e) dues.push({ d: x.ep.scriptDue, label: "口播稿截止", x });
    if (x.ep.roughCutDue >= s && x.ep.roughCutDue <= e) dues.push({ d: x.ep.roughCutDue, label: "初剪截止", x });
  }
  dues.sort((a, b) => a.d.localeCompare(b.d));
  renderShell(`
    <div class="page-head"><div><h1>節目排程</h1><div class="sub">每週三 0:00 上線</div></div>
      <div class="month-nav"><button class="btn sm" id="prev">‹</button><span class="label">${ymLabel(ym)}</span><button class="btn sm" id="next">›</button>
      ${ym !== ymOf(t) ? `<button class="btn sm ghost" id="thism">回本月</button>` : ""}</div></div>
    <div class="sched">${rows}</div>
    <div class="section"><div class="section-title"><h2>本月截止事項</h2></div>
      ${dues.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>日期</th><th>事項</th><th>合作</th></tr></thead><tbody>
        ${dues.map((u) => `<tr class="clickable ${u.d < t ? "" : ""}" data-deal="${u.x.deal.id}"><td>${mdw(u.d)}</td><td><span class="tag ${u.d < t ? "" : "accent"}">${u.label}</span></td><td>${esc(u.x.deal.brand)}・第 ${u.x.idx} 集</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">這個月沒有截止事項</div>`}
    </div>`);
  $("#prev").onclick = () => { S.ui.schedYm = shiftYm(ym, -1); render(); };
  $("#next").onclick = () => { S.ui.schedYm = shiftYm(ym, 1); render(); };
  const tm = $("#thism"); if (tm) tm.onclick = () => { S.ui.schedYm = ymOf(t); render(); };
  $$("[data-deal]").forEach((el) => (el.onclick = () => (location.hash = "#deal/" + el.dataset.deal)));
}

/* =========================================================
   每月收入
   ========================================================= */
function renderIncome() {
  const ym = S.ui.incomeYm;
  const inc = monthIncome(ym);
  const r = ratio();
  const t = todayStr();
  const isThis = ym === ymOf(t);
  renderShell(`
    <div class="page-head"><div><h1>每月收入</h1><div class="sub">依上線日計算，多集合作的報價平均分到每一集（未稅）</div></div>
      <div class="month-nav"><button class="btn sm" id="prev">‹</button><span class="label">${ymLabel(ym)}</span><button class="btn sm" id="next">›</button>
      ${!isThis ? `<button class="btn sm ghost" id="thism">回本月</button>` : ""}</div></div>
    <div class="grid cols-2">
      <div class="stat-hero">
        <div class="label">${isThis ? "截至今日結案收益" : ym < ymOf(t) ? "當月結案收益" : "尚未開始"}</div>
        <div class="big">${money(inc.done)}</div>
        <div class="split">
          <div><span class="k">夏躺 ${Math.round(r * 100)}%</span><span class="v">${money(inc.done * r)}</span></div>
          <div><span class="k">播客煮 ${Math.round((1 - r) * 100)}%</span><span class="v">${money(inc.done * (1 - r))}</span></div>
        </div>
      </div>
      <div class="stat-hero" style="background:var(--card)">
        <div class="label">本月全部（含尚未上線）</div>
        <div class="big">${money(inc.all)}</div>
        <div class="split">
          <div><span class="k">夏躺</span><span class="v">${money(inc.all * r)}</span></div>
          <div><span class="k">播客煮</span><span class="v">${money(inc.all * (1 - r))}</span></div>
        </div>
      </div>
    </div>
    <div class="section"><div class="section-title"><h2>明細</h2></div>
      ${inc.rows.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>上線日</th><th>合作</th><th>狀態</th><th class="num">金額</th><th class="num">夏躺</th><th class="num">播客煮</th></tr></thead><tbody>
      ${inc.rows.map((x) => `<tr class="clickable" data-deal="${x.deal.id}"><td>${mdw(x.ep.airDate)}</td><td>${esc(x.deal.brand)}<span class="muted small">・第 ${x.idx}/${x.total} 集</span></td>
        <td><span class="tag ${isAired(x.ep) ? "ok" : ""}">${isAired(x.ep) ? "已結案" : "未上線"}</span></td>
        <td class="num">${money(x.value)}</td><td class="num">${money(x.value * r)}</td><td class="num">${money(x.value * (1 - r))}</td></tr>`).join("")}
      <tr class="total"><td colspan="3">合計</td><td class="num">${money(inc.all)}</td><td class="num">${money(inc.all * r)}</td><td class="num">${money(inc.all * (1 - r))}</td></tr>
      </tbody></table></div>` : `<div class="card empty">這個月沒有業配</div>`}
    </div>`);
  $("#prev").onclick = () => { S.ui.incomeYm = shiftYm(ym, -1); render(); };
  $("#next").onclick = () => { S.ui.incomeYm = shiftYm(ym, 1); render(); };
  const tm = $("#thism"); if (tm) tm.onclick = () => { S.ui.incomeYm = ymOf(t); render(); };
  $$("[data-deal]").forEach((el) => (el.onclick = () => (location.hash = "#deal/" + el.dataset.deal)));
}

/* =========================================================
   季度薪資結算（管理者）
   ========================================================= */
function computePayroll(k) {
  const [s, e] = qRange(k);
  const r = ratio();
  const qd = S.quarters[k] || {};
  const autoCount = wednesdaysInRange(s, e).length;
  const episodeCount = qd.episodeCount ?? autoCount;
  const editFee = num(S.settings.editFee);
  const splitCount = Math.max(1, num(S.settings.splitCount) || 2);
  const incomeRows = S.deals.filter((d) => { const p = S.payments[d.id]; return p?.paid && p.paidDate >= s && p.paidDate <= e; })
    .map((d) => ({ brand: d.brand, amount: num(d.quote) * r, paidDate: S.payments[d.id].paidDate }));
  const income = incomeRows.reduce((t, x) => t + x.amount, 0);
  const expRows = S.expenses.filter((x) => x.date >= s && x.date <= e).sort((a, b) => a.date.localeCompare(b.date));
  const expenses = expRows.reduce((t, x) => t + num(x.amount), 0);
  const editTotal = episodeCount * editFee;
  const surplus = income - editTotal - expenses;
  const share = surplus > 0 ? surplus / splitCount : 0;
  return {
    k, s, e, autoCount, episodeCount, editFee, splitCount, incomeRows, income,
    expRows: expRows.map((x) => ({ date: x.date, item: x.item, payee: x.payee, amount: num(x.amount) })), expenses,
    editTotal, surplus, share, editorPay: editTotal + share, ownerPay: share,
    editorName: S.settings.editorName || "剪輯", ownerName: S.settings.ownerName || "管理者",
  };
}
function payrollText(c) {
  const lines = [
    `【夏躺 ${qLabel(c.k)} 結算】`,
    `本季已入帳收入：${money(c.income)}`,
    ...c.incomeRows.map((x) => `　・${x.brand}（${md(x.paidDate)} 入帳）${money(x.amount)}`),
    `剪輯費：${c.episodeCount} 集 × ${money(c.editFee)} = ${money(c.editTotal)}`,
    `其他支出：${money(c.expenses)}`,
    ...c.expRows.map((x) => `　・${md(x.date)} ${x.item}${x.payee ? `（${x.payee}）` : ""} ${money(x.amount)}`),
    c.surplus > 0 ? `盈餘：${money(c.surplus)}，${c.splitCount} 人均分各 ${money(c.share)}` : `盈餘：${money(c.surplus)}（本季不分配）`,
    `—`,
    `${c.editorName} 本季應付：${money(c.editorPay)}（剪輯費 ${money(c.editTotal)}${c.share ? ` + 盈餘 ${money(c.share)}` : ""}）`,
    `${c.ownerName} 本季應得：${money(c.ownerPay)}`,
  ];
  return lines.join("\n");
}
function renderPayroll() {
  if (!isAdmin()) { location.hash = "#home"; return; }
  const k = S.ui.payQ;
  const [s, e] = qRange(k);
  const t = todayStr();
  const qd = S.quarters[k] || {};
  const locked = !!qd.locked;
  const live = computePayroll(k);
  const c = locked && qd.snapshot ? qd.snapshot : live;
  const r = ratio();
  const prevK = shiftQ(qKeyOf(t), -1);
  const prevUnlocked = !(S.quarters[prevK] || {}).locked;

  // 本季相關合作：本季入帳、本季有上線，或已上線但還沒入帳
  const rel = S.deals.filter((d) => {
    const p = S.payments[d.id] || {};
    const inQ = (d.episodes || []).some((x) => x.airDate >= s && x.airDate <= e);
    const paidInQ = p.paid && p.paidDate >= s && p.paidDate <= e;
    const owed = !p.paid && dealAiredCount(d) > 0;
    return inQ || paidInQ || owed;
  }).sort((a, b) => dealFirstDate(a).localeCompare(dealFirstDate(b)));

  const dealRows = rel.map((d) => {
    const p = S.payments[d.id] || {};
    const st = airStatus(d);
    const owed = !p.paid && dealAiredCount(d) > 0;
    const counts = p.paid && p.paidDate >= s && p.paidDate <= e;
    return `<tr class="${owed ? "hl" : ""}">
      <td><a href="#deal/${d.id}">${esc(d.brand)}</a></td>
      <td>${epsSorted(d).length} 集：${epsSorted(d).map((x) => md(x.airDate)).join("、")}</td>
      <td><span class="tag ${st.cls}">${st.text}</span></td>
      <td class="num">${money(num(d.quote) * r)}</td>
      <td><label class="toggle"><input type="checkbox" data-paid="${d.id}" ${p.paid ? "checked" : ""} ${locked ? "disabled" : ""}> ${p.paid ? "已入帳" : owed ? "<b>待入帳</b>" : "未入帳"}</label></td>
      <td><input type="date" class="inline-input" data-pdate="${d.id}" value="${esc(p.paidDate || "")}" ${p.paid && !locked ? "" : "disabled"} style="width:150px"></td>
      <td>${counts ? `<span class="tag ok">計入本季</span>` : p.paid ? `<span class="tag">計入 ${qKeyOf(p.paidDate)}</span>` : ""}</td>
    </tr>`;
  }).join("");

  const expRowsLive = S.expenses.filter((x) => x.date >= s && x.date <= e).sort((a, b) => a.date.localeCompare(b.date));
  renderShell(`
    <div class="page-head"><div><h1>季度薪資結算</h1><div class="sub">只計算已入帳的收入，依入帳日期歸季</div></div>
      <div class="month-nav"><button class="btn sm" id="prev">‹</button><span class="label">${qLabel(k)}</span><button class="btn sm" id="next">›</button></div></div>
    ${prevUnlocked && k !== prevK ? `<div class="banner"><span>上一季（${qLabel(prevK)}）還沒完成結算</span><button class="btn sm" id="goprev">前往結算</button></div>` : ""}
    ${locked ? `<div class="banner ok"><span>這一季已完成結算，數字已鎖定${qd.lockedAt?.toDate ? `（${md(fmtD(qd.lockedAt.toDate()))}）` : ""}</span><button class="btn sm" id="unlock">解鎖重算</button></div>` : ""}

    <div class="section" style="margin-top:6px"><div class="section-title"><h2>業配明細</h2><span class="small muted">黃色底＝已上線但未入帳</span></div>
      ${rel.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>品牌</th><th>集數與上線日</th><th>上線狀態</th><th class="num">夏躺分潤</th><th>入帳</th><th>入帳日</th><th></th></tr></thead><tbody>${dealRows}</tbody></table></div>` : `<div class="card empty">這一季沒有相關的業配</div>`}
    </div>

    <div class="section"><div class="section-title"><h2>其他支出</h2></div>
      <div class="card table-wrap">
        <table class="t"><thead><tr><th>日期</th><th>項目</th><th>付給誰</th><th class="num">金額</th><th></th></tr></thead><tbody>
          ${expRowsLive.map((x) => `<tr><td>${mdw(x.date)}</td><td>${esc(x.item)}</td><td>${esc(x.payee || "")}</td><td class="num">${money(x.amount)}</td><td class="num">${locked ? "" : `<button class="btn sm ghost danger" data-delexp="${x.id}">刪除</button>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">這一季沒有其他支出</td></tr>`}
          ${locked ? "" : `<tr><td><input type="date" class="inline-input" id="ex-date" value="${t >= s && t <= e ? t : e}" style="width:150px"></td>
            <td><input class="inline-input" id="ex-item" placeholder="例如 外發拍攝" style="width:100%"></td>
            <td><input class="inline-input" id="ex-payee" placeholder="選填" style="width:100%"></td>
            <td class="num"><input class="inline-input" id="ex-amt" inputmode="numeric" placeholder="金額" style="width:110px;text-align:right"></td>
            <td class="num"><button class="btn sm primary" id="ex-add">新增</button></td></tr>`}
        </tbody></table>
      </div>
    </div>

    <div class="section"><div class="section-title"><h2>薪資計算</h2></div>
      <div class="card table-wrap"><table class="t"><tbody>
        <tr class="calc-step"><td>1. 本季已入帳收入</td><td class="muted small">本季入帳的夏躺分潤加總（${c.incomeRows.length} 筆）</td><td class="num">${money(c.income)}</td></tr>
        <tr class="calc-step"><td>2. 剪輯費</td><td class="muted small">
          ${locked ? `${c.episodeCount} 集` : `<input class="inline-input" id="ep-count" type="number" min="0" value="${c.episodeCount}" style="width:70px"> 集`}
          × ${money(c.editFee)}　<span>（本季週三共 ${live.autoCount} 個${(qd.episodeCount ?? null) !== null && !locked ? `，<a href="#" id="ep-reset">改回自動</a>` : ""}）</span></td><td class="num">− ${money(c.editTotal)}</td></tr>
        <tr class="calc-step"><td>3. 其他支出</td><td class="muted small">上方支出加總</td><td class="num">− ${money(c.expenses)}</td></tr>
        <tr class="calc-step"><td>4. 盈餘</td><td class="muted small">1 − 2 − 3</td><td class="num ${c.surplus < 0 ? "neg" : ""}">${money(c.surplus)}</td></tr>
        <tr class="calc-step"><td>5. 盈餘均分</td><td class="muted small">${c.surplus > 0 ? `盈餘 ÷ ${c.splitCount}` : `<span class="neg">盈餘不是正數，本季不分配</span>`}</td><td class="num">${c.surplus > 0 ? `各 ${money(c.share)}` : "—"}</td></tr>
        <tr class="total"><td>${esc(c.editorName)} 本季應付</td><td class="muted small">剪輯費＋均分</td><td class="num">${money(c.editorPay)}</td></tr>
        <tr class="total"><td>${esc(c.ownerName)} 本季應得</td><td class="muted small">均分</td><td class="num">${money(c.ownerPay)}</td></tr>
      </tbody></table></div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" id="copy">複製明細（貼到 LINE）</button>
        ${locked ? "" : `<button class="btn primary" id="lock">完成結算</button>`}
      </div>
      <p class="small muted">剪輯費單價（${money(live.editFee)}）、分潤比例與均分人數可在「管理 › 設定」修改。</p>
    </div>`);
  $("#prev").onclick = () => { S.ui.payQ = shiftQ(k, -1); render(); };
  $("#next").onclick = () => { S.ui.payQ = shiftQ(k, 1); render(); };
  const gp = $("#goprev"); if (gp) gp.onclick = () => { S.ui.payQ = prevK; render(); };
  $("#copy").onclick = () => copyText(payrollText(c), "明細已複製，可以貼到 LINE");
  const ul = $("#unlock");
  if (ul) ul.onclick = async () => {
    if (!(await confirmBox("解鎖這一季？", "解鎖後數字會依目前資料重新計算。", "解鎖"))) return;
    await setDoc(doc(db, "quarters", k), { locked: false, snapshot: null }, { merge: true });
  };
  const lk = $("#lock");
  if (lk) lk.onclick = async () => {
    if (!(await confirmBox(`完成 ${qLabel(k)} 結算？`, `${esc(live.editorName)} 應付 ${money(live.editorPay)}、${esc(live.ownerName)} 應得 ${money(live.ownerPay)}。完成後數字會鎖定。`, "完成結算"))) return;
    await setDoc(doc(db, "quarters", k), { locked: true, lockedAt: serverTimestamp(), snapshot: live }, { merge: true });
    toast("已完成結算");
  };
  const ec = $("#ep-count");
  if (ec) ec.onchange = () => setDoc(doc(db, "quarters", k), { episodeCount: Math.max(0, Math.round(num(ec.value))) }, { merge: true });
  const er = $("#ep-reset");
  if (er) er.onclick = (ev) => { ev.preventDefault(); setDoc(doc(db, "quarters", k), { episodeCount: null }, { merge: true }); };
  $$("[data-paid]").forEach((cb) => (cb.onchange = async () => {
    const id = cb.dataset.paid;
    const d = S.deals.find((x) => x.id === id);
    const paid = cb.checked;
    await setDoc(doc(db, "payments", id), { paid, paidDate: paid ? (S.payments[id]?.paidDate || todayStr()) : "", brand: d?.brand || "" }, { merge: true });
  }));
  $$("[data-pdate]").forEach((inp) => (inp.onchange = () => setDoc(doc(db, "payments", inp.dataset.pdate), { paidDate: inp.value }, { merge: true })));
  $$("[data-delexp]").forEach((b) => (b.onclick = async () => {
    if (await confirmBox("刪除這筆支出？", "", "刪除", true)) await deleteDoc(doc(db, "expenses", b.dataset.delexp));
  }));
  const ea = $("#ex-add");
  if (ea) ea.onclick = async () => {
    const date = $("#ex-date").value, item = $("#ex-item").value.trim(), payee = $("#ex-payee").value.trim(), amount = num($("#ex-amt").value);
    if (!date || !item || !(amount > 0)) { toast("請填日期、項目與金額", true); return; }
    await addDoc(collection(db, "expenses"), { date, item, payee, amount, createdAt: serverTimestamp() });
    toast(qKeyOf(date) === k ? "已新增支出" : `已新增支出（日期屬於 ${qKeyOf(date)}）`);
  };
}

/* =========================================================
   管理（帳號、常用連結、設定）
   ========================================================= */
function renderAdmin() {
  if (!isAdmin()) { location.hash = "#home"; return; }
  const users = [...S.users].sort((a, b) => (a.role === "pending" ? -1 : 0) - (b.role === "pending" ? -1 : 0) || (a.email || "").localeCompare(b.email || ""));
  const st = S.settings;
  renderShell(`
    <div class="page-head"><div><h1>管理</h1><div class="sub">帳號身份、常用連結與設定</div></div></div>

    <div class="section" style="margin-top:0"><div class="section-title"><h2>帳號管理</h2><span class="small muted">新帳號登入後會出現在這裡</span></div>
      <div class="card table-wrap"><table class="t"><thead><tr><th>使用者</th><th>Email</th><th>身份</th></tr></thead><tbody>
      ${users.map((u) => {
        const owner = u.email === ownerEmail;
        return `<tr><td><div style="display:flex;gap:10px;align-items:center">${u.photoURL ? `<img class="avatar" src="${esc(u.photoURL)}" referrerpolicy="no-referrer" alt="">` : `<span class="avatar"></span>`}${esc(u.name || "")}</div></td>
        <td>${esc(u.email)}</td>
        <td>${owner ? `<span class="tag accent">管理者（固定）</span>` : `<select class="input" data-role="${u.id}" style="width:150px;padding:6px 10px">${Object.entries(ROLES).map(([v, l]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${l}</option>`).join("")}</select>`}
        ${u.role === "pending" ? ` <span class="tag warn">待開通</span>` : ""}</td></tr>`;
      }).join("")}
      </tbody></table></div>
    </div>

    <div class="section"><div class="section-title"><h2>常用檔案連結</h2><button class="btn sm" id="add-link">＋ 新增連結</button></div>
      <div class="card table-wrap"><table class="t"><thead><tr><th style="width:70px">順序</th><th>名稱</th><th>網址</th><th></th></tr></thead><tbody>
      ${S.links.map((l) => `<tr data-link="${l.id}">
        <td><input class="inline-input" type="number" name="order" value="${esc(l.order ?? "")}" style="width:56px"></td>
        <td><input class="inline-input" name="name" value="${esc(l.name)}" style="width:100%;min-width:110px"></td>
        <td><input class="inline-input" name="url" value="${esc(l.url)}" style="width:100%;min-width:220px"></td>
        <td class="num" style="white-space:nowrap"><a class="btn sm ghost" href="${esc(l.url)}" target="_blank" rel="noopener">開啟</a><button class="btn sm ghost danger" data-dellink="${l.id}">刪除</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">尚無連結</td></tr>`}
      </tbody></table></div>
      <p class="small muted">直接修改欄位，離開欄位時會自動儲存。</p>
    </div>

    <div class="section"><div class="section-title"><h2>設定</h2></div>
      <form class="card pad" id="settings-form">
        <div class="form-grid">
          <div class="field"><label>夏躺分潤比例（%）</label><input class="input" type="number" min="0" max="100" name="shareRatio" value="${esc(st.shareRatio)}"><span class="hint">播客煮自動為 ${100 - num(st.shareRatio)}%</span></div>
          <div class="field"><label>每集剪輯費（新台幣）</label><input class="input" type="number" min="0" name="editFee" value="${esc(st.editFee)}"></div>
          <div class="field"><label>剪輯成員名稱</label><input class="input" name="editorName" value="${esc(st.editorName)}"></div>
          <div class="field"><label>管理者名稱</label><input class="input" name="ownerName" value="${esc(st.ownerName)}"></div>
          <div class="field"><label>盈餘均分人數</label><input class="input" type="number" min="1" name="splitCount" value="${esc(st.splitCount)}"></div>
          <div class="field full"><label>共用 Google 日曆 ID</label><input class="input" name="calendarId" value="${esc(st.calendarId)}" placeholder="xxxx@group.calendar.google.com"><span class="hint">留空＝不同步日曆。播客煮人員需要有這個日曆的「變更活動」權限。</span></div>
        </div>
        <div class="btn-row" style="margin-top:16px"><button class="btn primary" type="submit">儲存設定</button>${st.calendarId ? `<button class="btn" type="button" id="cal-test">測試日曆連線</button>` : ""}</div>
      </form>
    </div>`);
  $$("[data-role]").forEach((sel) => (sel.onchange = async () => {
    await updateDoc(doc(db, "users", sel.dataset.role), { role: sel.value });
    toast("身份已更新為「" + ROLES[sel.value] + "」");
  }));
  $("#add-link").onclick = async () => {
    const order = Math.max(0, ...S.links.map((l) => num(l.order))) + 1;
    await addDoc(collection(db, "links"), { name: "新連結", url: "https://drive.google.com/", order });
  };
  $$("[data-link]").forEach((tr) => $$("input", tr).forEach((inp) => (inp.onchange = async () => {
    const v = inp.name === "order" ? num(inp.value) : inp.value.trim();
    await updateDoc(doc(db, "links", tr.dataset.link), { [inp.name]: v });
    toast("連結已儲存");
  })));
  $$("[data-dellink]").forEach((b) => (b.onclick = async () => {
    if (await confirmBox("刪除這個連結？", "", "刪除", true)) await deleteDoc(doc(db, "links", b.dataset.dellink));
  }));
  $("#settings-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    await setDoc(doc(db, "settings", "general"), {
      shareRatio: num(f.shareRatio.value), editFee: num(f.editFee.value), splitCount: Math.max(1, num(f.splitCount.value)),
      editorName: f.editorName.value.trim(), ownerName: f.ownerName.value.trim(), calendarId: f.calendarId.value.trim(),
    }, { merge: true });
    toast("設定已儲存");
  };
  const ct = $("#cal-test");
  if (ct) ct.onclick = async () => {
    try {
      const token = await getCalToken();
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(S.settings.calendarId)}/events?maxResults=1`, { headers: { Authorization: "Bearer " + token } });
      toast(r.ok ? "日曆連線正常" : "日曆連線失敗（" + r.status + "）", !r.ok);
    } catch (e) { toast(calErr(e), true); }
  };
}

/* =========================================================
   Google 日曆同步
   ========================================================= */
let gisToken = null, gisExpiry = 0, gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) gisLoading = new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client"; sc.async = true; sc.onload = res; sc.onerror = () => rej(new Error("無法載入 Google 授權元件"));
    document.head.appendChild(sc);
  });
  return gisLoading;
}
loadGis().catch(() => {});
function getCalToken() {
  if (gisToken && Date.now() < gisExpiry - 60000) return Promise.resolve(gisToken);
  if (!window.google?.accounts?.oauth2) return loadGis().then(() => Promise.reject(new Error("授權元件剛載入完成，請再按一次")));
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: oauthClientId,
      scope: "https://www.googleapis.com/auth/calendar.events",
      hint: S.user?.email,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        gisToken = r.access_token; gisExpiry = Date.now() + (r.expires_in || 3600) * 1000; res(gisToken);
      },
      error_callback: (e) => rej(new Error(e?.type === "popup_closed" ? "你關閉了授權視窗" : e?.type === "popup_failed_to_open" ? "瀏覽器擋住了 Google 授權視窗，請允許彈出視窗後，到合作頁按「重新同步 Google 日曆」" : e?.message || "授權失敗")),
    });
    tc.requestAccessToken({ prompt: "" });
  });
}
const calErr = (e) => (e?.message || String(e || "未知錯誤"));
async function calFetch(token, method, path, body) {
  const r = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(r.status === 403 || r.status === 404 ? "你的 Google 帳號沒有共用日曆的編輯權限" : (j.error?.message || "HTTP " + r.status)); err.status = r.status; throw err; }
  return j;
}
async function syncCalendar(deal, episodes, removed, token) {
  const cal = encodeURIComponent(S.settings.calendarId);
  const site = location.origin + location.pathname + "#deal/" + deal.id;
  const errors = [];
  const sorted = [...episodes].sort((a, b) => (a.airDate || "").localeCompare(b.airDate || ""));
  const out = [];
  for (const ep of sorted) {
    const i = sorted.indexOf(ep) + 1;
    const tag = sorted.length > 1 ? ` 第${i}集` : "";
    const ids = { ...(ep.cal || {}) };
    const specs = [
      ["air", { summary: `【上線】${deal.brand}${tag}`, start: { dateTime: `${ep.airDate}T00:00:00+08:00`, timeZone: "Asia/Taipei" }, end: { dateTime: `${ep.airDate}T00:30:00+08:00`, timeZone: "Asia/Taipei" } }],
      ["script", { summary: `【口播稿截止】${deal.brand}${tag}`, start: { date: ep.scriptDue }, end: { date: addDays(ep.scriptDue, 1) } }],
      ["cut", { summary: `【初剪截止】${deal.brand}${tag}`, start: { date: ep.roughCutDue }, end: { date: addDays(ep.roughCutDue, 1) } }],
    ];
    for (const [key, ev] of specs) {
      ev.description = `夏躺工作表單：${site}`;
      try {
        if (ids[key]) {
          try { await calFetch(token, "PUT", `/calendars/${cal}/events/${ids[key]}`, ev); }
          catch (e) { if (e.status === 404 || e.status === 410) ids[key] = (await calFetch(token, "POST", `/calendars/${cal}/events`, ev)).id; else throw e; }
        } else ids[key] = (await calFetch(token, "POST", `/calendars/${cal}/events`, ev)).id;
      } catch (e) { errors.push(calErr(e)); }
    }
    out.push({ ...ep, cal: ids });
  }
  for (const ep of removed) {
    for (const id of Object.values(ep.cal || {})) {
      if (id) await calFetch(token, "DELETE", `/calendars/${cal}/events/${id}`).catch(() => {});
    }
  }
  // 回傳時保留原本順序
  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  return { episodes: episodes.map((e) => byId[e.id] || e), errors };
}

/* =========================================================
   小元件
   ========================================================= */
function toast(msg, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2600);
}
function confirmBox(title, body, okLabel = "確定", danger = false) {
  return new Promise((res) => {
    const host = document.createElement("div");
    host.innerHTML = `<div class="modal-bg"><div class="modal sm">
      <div class="modal-head"><h2>${title}</h2></div>
      ${body ? `<div class="modal-body">${body}</div>` : ""}
      <div class="modal-foot"><button class="btn" data-no>取消</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${okLabel}</button></div>
    </div></div>`;
    document.body.appendChild(host);
    const done = (v) => { host.remove(); res(v); };
    $("[data-no]", host).onclick = () => done(false);
    $("[data-yes]", host).onclick = () => done(true);
  });
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(msg); } catch { toast("複製失敗，請手動選取", true); }
    ta.remove();
  }
}
document.addEventListener("click", (e) => {
  if (S.ui.menu && !e.target.closest("#menu") && !e.target.closest("#me-btn")) { S.ui.menu = false; render(); }
});

/* =========================================================
   路由與資料訂閱
   ========================================================= */
function render() {
  if (!S.user) return renderLogin();
  if (!S.profile) { app.innerHTML = `<div class="boot"><img src="icons/icon-192.png" alt=""></div>`; return; }
  if (!isMember()) return renderPending();
  const { page, arg } = currentRoute();
  const pages = { home: renderHome, schedule: renderSchedule, income: renderIncome, payroll: renderPayroll, admin: renderAdmin };
  if (page === "deal") return renderDeal(arg);
  (pages[page] || renderHome)();
}
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // 正在編輯表單或輸入時不要重畫，避免打字被打斷
    if ($("#modal-root").innerHTML.trim()) return;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && app.contains(a)) { pendingRender = true; return; }
    render();
  });
}
let pendingRender = false;
document.addEventListener("focusout", () => { if (pendingRender) { pendingRender = false; setTimeout(scheduleRender, 50); } });
window.addEventListener("hashchange", () => { S.ui.menu = false; render(); window.scrollTo(0, 0); });

function stopSubs() { unsubs.forEach((u) => u()); unsubs = []; }
let subscribedRole = null;
function startDataSubs() {
  if (subscribedRole === role()) return;
  stopSubs();
  subscribedRole = role();
  // 自己的帳號資料（身份變更即時生效）
  unsubs.push(onSnapshot(doc(db, "users", S.user.uid), (snap) => {
    S.profile = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (S.user.email === ownerEmail && S.profile) S.profile.role = "admin";
    if (subscribedRole !== role()) startDataSubs();
    scheduleRender();
  }));
  if (!isMember()) return;
  unsubs.push(onSnapshot(collection(db, "deals"), (qs) => { S.deals = qs.docs.map((d) => ({ id: d.id, ...d.data() })); S.loaded.deals = true; scheduleRender(); }));
  unsubs.push(onSnapshot(collection(db, "links"), (qs) => { S.links = qs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => num(a.order) - num(b.order)); scheduleRender(); }));
  unsubs.push(onSnapshot(doc(db, "settings", "general"), (snap) => { S.settings = { ...DEFAULT_SETTINGS, ...(snap.data() || {}) }; scheduleRender(); }));
  if (isAdmin()) {
    unsubs.push(onSnapshot(collection(db, "users"), (qs) => { S.users = qs.docs.map((d) => ({ id: d.id, ...d.data() })); scheduleRender(); }));
    unsubs.push(onSnapshot(collection(db, "payments"), (qs) => { S.payments = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])); scheduleRender(); }));
    unsubs.push(onSnapshot(collection(db, "expenses"), (qs) => { S.expenses = qs.docs.map((d) => ({ id: d.id, ...d.data() })); scheduleRender(); }));
    unsubs.push(onSnapshot(collection(db, "quarters"), (qs) => { S.quarters = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])); scheduleRender(); }));
  }
}

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const base = { email: user.email, name: user.displayName || "", photoURL: user.photoURL || "", lastLogin: serverTimestamp() };
  if (!snap.exists()) {
    const r = user.email === ownerEmail ? "admin" : "pending";
    await setDoc(ref, { ...base, role: r, createdAt: serverTimestamp() });
    return { ...base, role: r };
  }
  const data = snap.data();
  if (user.email === ownerEmail && data.role !== "admin") { await updateDoc(ref, { ...base, role: "admin" }); return { ...data, role: "admin" }; }
  await updateDoc(ref, base);
  return data;
}
async function seedDefaults() {
  const s = await getDoc(doc(db, "settings", "general"));
  if (!s.exists()) await setDoc(doc(db, "settings", "general"), DEFAULT_SETTINGS);
  const flag = await getDoc(doc(db, "settings", "seeded"));
  if (!flag.exists()) {
    const b = writeBatch(db);
    DEFAULT_LINKS.forEach((l) => b.set(doc(collection(db, "links")), l));
    b.set(doc(db, "settings", "seeded"), { at: serverTimestamp() });
    await b.commit();
  }
}

onAuthStateChanged(auth, async (user) => {
  stopSubs(); subscribedRole = null;
  S.user = user; S.profile = null; S.deals = []; S.loaded.deals = false;
  if (!user) return render();
  render();
  try {
    const p = await ensureProfile(user);
    S.profile = { id: user.uid, ...p };
    if (role() === "admin") await seedDefaults().catch((e) => console.warn(e));
    startDataSubs();
    render();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="splash"><div class="splash-art"></div><div class="splash-panel"><h1>讀取失敗</h1><p>${esc(e.message || e)}</p><button class="btn" id="logout">登出</button></div></div>`;
    $("#logout").onclick = () => signOut(auth);
  }
});
