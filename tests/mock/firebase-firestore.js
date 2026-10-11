const store = window.__store = window.__store || {};
const listeners = [];
const col = (c) => (store[c] = store[c] || {});
const clone = (o) => JSON.parse(JSON.stringify(o));
let n = 0;
export function getFirestore(){ return {}; }
export function serverTimestamp(){ return { __ts: Date.now() }; }
export function collection(db, c){ return { type:'col', c }; }
export function where(f, op, v){ return { f, op, v }; }
export function query(cr, ...conds){ return { ...cr, conds }; }
export function doc(a, c, id){ if (a && a.type==='col') return { type:'doc', c:a.c, id:'auto'+(++n) }; return { type:'doc', c, id }; }
function fire(){ listeners.forEach(l=>l.run()); }
function revive(d){ if(!d) return d; for (const k in d) if (d[k] && d[k].__ts) { const t=d[k].__ts; d[k]={ toDate:()=>new Date(t) }; } return d; }
export async function getDoc(r){ const d = col(r.c)[r.id]; return { id:r.id, exists:()=>!!d, data:()=>d?revive(clone(d)):undefined }; }
export async function setDoc(r, data, opt){ const cur = col(r.c)[r.id]; col(r.c)[r.id] = opt&&opt.merge&&cur ? { ...cur, ...clone(data) } : clone(data); fire(); }
export async function updateDoc(r, data){ if(!col(r.c)[r.id]) throw new Error('no doc'); col(r.c)[r.id] = { ...col(r.c)[r.id], ...clone(data) }; fire(); }
export async function deleteDoc(r){ delete col(r.c)[r.id]; fire(); }
export async function addDoc(cr, data){ const id='auto'+(++n); col(cr.c)[id]=clone(data); fire(); return { type:'doc', c:cr.c, id }; }
export function writeBatch(){ const ops=[]; return { set:(r,d)=>ops.push([r,d]), commit: async()=>{ ops.forEach(([r,d])=>col(r.c)[r.id]=clone(d)); fire(); } }; }
export function onSnapshot(r, cb){
  const l = { run: () => {
    if (r.type==='doc') { const d=col(r.c)[r.id]; cb({ id:r.id, exists:()=>!!d, data:()=>d?revive(clone(d)):undefined }); }
    else cb({ docs: Object.entries(col(r.c)).filter(([id,d])=>(r.conds||[]).every(c=>d[c.f]===c.v)).map(([id,d])=>({ id, data:()=>revive(clone(d)) })) });
  } };
  listeners.push(l); setTimeout(l.run,0);
  return () => { const i=listeners.indexOf(l); if(i>=0) listeners.splice(i,1); };
}
