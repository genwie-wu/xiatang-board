let cbs=[];
export function getAuth(){ return {}; }
export class GoogleAuthProvider{}
export function onAuthStateChanged(a, cb){ cbs.push(cb); setTimeout(()=>cb(window.__mockUser||null),0); return ()=>{}; }
export async function signInWithPopup(){ window.__mockUser = window.__loginAs; cbs.forEach(c=>c(window.__mockUser)); }
export async function signOut(){ window.__mockUser=null; cbs.forEach(c=>c(null)); }
