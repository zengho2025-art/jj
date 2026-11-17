/* Scopix V1.6 — Supabase email login and revision-safe cloud state. */
const SCOPIX_GUEST_BACKUP_KEY = 'scopix_guest_backup_v1';
let scopixCloudClient = null;
let scopixCloudUser = null;
let scopixCloudRevision = 0;
let scopixCloudBusy = false;
let scopixCloudTimer = null;
let scopixCloudPending = false;
let scopixCloudConflict = null;
let scopixCloudEpoch = 0;
let scopixCloudAuthenticated = false;

function scopixCloudConfigured() {
    const cfg = window.SCOPIX_SUPABASE || {};
    return /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(cfg.url || '') &&
        typeof cfg.anonKey === 'string' && cfg.anonKey.length > 20 &&
        Boolean(window.supabase?.createClient);
}
function cloudStatus(message, isError=false) {
    const el=document.getElementById('scopixCloudStatus');
    if (el) {el.textContent=message;el.dataset.error=String(isError);}
}
function cloudReadLocal() {
    return {
        vocabulary: typeof scopixVocabulary === 'undefined' ? [] : scopixVocabulary,
        annotations: typeof scopixMarks === 'undefined' ? [] : scopixMarks
    };
}
function cloudSame(a,b) {
    return JSON.stringify(a.vocabulary || []) === JSON.stringify(b.vocabulary || []) &&
        JSON.stringify(a.annotations || []) === JSON.stringify(b.annotations || []);
}
function cloudStoreGuestBackup() {
    if (localStorage.getItem(SCOPIX_GUEST_BACKUP_KEY) !== null) return;
    try { localStorage.setItem(SCOPIX_GUEST_BACKUP_KEY,JSON.stringify(cloudReadLocal())); } catch (_) {}
}
function cloudApplyState(data) {
    const vocab=Array.isArray(data.vocabulary) ? data.vocabulary : [];
    const notes=Array.isArray(data.annotations) ? data.annotations : [];
    try {
        localStorage.setItem(SCOPIX_VOCAB_KEY,JSON.stringify(vocab));
        localStorage.setItem(SCOPIX_MARKS_KEY,JSON.stringify(notes));
    } catch (_) {
        cloudStatus('云端数据已读取，但本地存储失败；请检查浏览器空间。',true);
        return false;
    }
    scopixVocabulary=loadScopixVocabulary();
    scopixMarks=readScopixMarks();
    if (typeof refreshScopixMarks==='function') refreshScopixMarks();
    if (typeof renderScopixAnnotationSidebar==='function') renderScopixAnnotationSidebar();
    if (typeof renderScopixStudyLibrary==='function') renderScopixStudyLibrary();
    if (typeof updateScopixReviewCounts==='function') updateScopixReviewCounts();
    return true;
}
function cloudShowConflict(cloudData) {
    scopixCloudConflict=cloudData;
    const box=document.getElementById('scopixCloudChoices');
    if (box) box.hidden=false;
    cloudStatus('本地与云端记录不一致。请选择使用哪一份；另一份不会自动合并。',true);
}
function cloudClearConflict() {
    scopixCloudConflict=null;
    const box=document.getElementById('scopixCloudChoices');
    if (box) box.hidden=true;
}
function cloudSetAccountLabel() {
    const account=document.getElementById('scopixCloudAccount');
    const login=document.getElementById('scopixCloudLogin');
    const logout=document.getElementById('scopixCloudLogout');
    const sync=document.getElementById('scopixCloudSync');
    if (account) account.textContent=scopixCloudUser?.email || '尚未登录';
    if (login) login.hidden=!!scopixCloudUser;
    if (logout) logout.hidden=!scopixCloudUser;
    if (sync) sync.hidden=!scopixCloudUser;
    const header=document.getElementById('scopixAccountButton');
    if (header) header.textContent=scopixCloudUser ? '☁ 已登录' : '☁ 登录与同步';
}
async function cloudFetch() {
    const {data,error}=await scopixCloudClient.from('scopix_study_state')
        .select('vocabulary,annotations,revision')
        .eq('user_id',scopixCloudUser.id).maybeSingle();
    if (error) throw error;
    return data || {vocabulary:[],annotations:[],revision:0};
}
async function cloudSave(snapshot,revision) {
    const {data,error}=await scopixCloudClient.rpc('scopix_save_study_state',{
        p_expected_revision:revision,
        p_vocabulary:snapshot.vocabulary,
        p_annotations:snapshot.annotations
    });
    if (error) throw error;
    return Number(data) || 0;
}
async function cloudInitialSync() {
    if (!scopixCloudUser || scopixCloudBusy) return;
    const epoch=scopixCloudEpoch;
    scopixCloudBusy=true;
    try {
        cloudStatus('正在检查云端学习记录…');
        const remote=await cloudFetch();
        if (epoch!==scopixCloudEpoch) return;
        scopixCloudRevision=Number(remote.revision)||0;
        const local=cloudReadLocal();
        const remoteState={vocabulary:remote.vocabulary||[],annotations:remote.annotations||[]};
        const localHas=local.vocabulary.length||local.annotations.length;
        const remoteHas=remoteState.vocabulary.length||remoteState.annotations.length;
        if (!remoteHas && !scopixCloudRevision && localHas) {
            scopixCloudPending=true;
            cloudStatus('云端为空，将首次备份本地学习数据…');
        } else if (!localHas && remoteHas) {
            if (cloudApplyState(remoteState)) cloudStatus('已从云端恢复学习记录。');
        } else if (localHas && remoteHas && !cloudSame(local,remoteState)) {
            cloudShowConflict(remoteState);
        } else if (!remoteHas && scopixCloudRevision && localHas) {
            cloudShowConflict(remoteState);
        } else {
            cloudStatus('云端与本地记录一致。');
        }
    } catch (err) {
        cloudStatus('云端读取失败：'+String(err.message||err),true);
    } finally {
        scopixCloudBusy=false;
        if (scopixCloudPending && !scopixCloudConflict) cloudScheduleSync();
    }
}
function cloudScheduleSync() {
    if (!scopixCloudUser || scopixCloudConflict) return;
    clearTimeout(scopixCloudTimer);
    scopixCloudTimer=setTimeout(cloudFlush,900);
}
function scopixCloudLocalChanged() {
    if (!scopixCloudUser) return;
    scopixCloudPending=true;
    cloudStatus('本地已保存，等待云端同步…');
    cloudScheduleSync();
}
async function cloudFlush() {
    if (!scopixCloudUser || scopixCloudBusy || scopixCloudConflict || !scopixCloudPending) return;
    scopixCloudBusy=true;
    let syncSucceeded=false;
    const epoch=scopixCloudEpoch;
    const snapshot=JSON.parse(JSON.stringify(cloudReadLocal()));
    scopixCloudPending=false;
    cloudStatus('正在同步到云端…');
    try {
        const nextRev=await cloudSave(snapshot,scopixCloudRevision);
        if(epoch!==scopixCloudEpoch) return;
        if(!nextRev) {
            const remote=await cloudFetch();
            if(epoch!==scopixCloudEpoch) return;
            scopixCloudRevision=Number(remote.revision)||0;
            cloudShowConflict({vocabulary:remote.vocabulary||[],annotations:remote.annotations||[]});
            scopixCloudPending=true;
            return;
        }
        scopixCloudRevision=nextRev;
        syncSucceeded=true;
        cloudStatus('已安全同步到云端（版本 '+nextRev+'）。');
        if (!cloudSame(snapshot,cloudReadLocal())) scopixCloudPending=true;
    } catch(err) {
        if(epoch!==scopixCloudEpoch) return;
        scopixCloudPending=true;
        cloudStatus('暂时无法同步：'+String(err.message||err)+'。本地记录仍在；联网后可重试。',true);
    } finally {
        scopixCloudBusy=false;
        if(scopixCloudPending && !scopixCloudConflict && epoch===scopixCloudEpoch) {
            // Retry remaining edits only after a successful write; network failures stay local.
            if (syncSucceeded) cloudScheduleSync();
            else cloudStatus('仍有未同步更改，请联网后点击“检查云端更新”重试。',true);
        }
    }
}
async function cloudResolve(choice) {
    if (!scopixCloudUser || !scopixCloudConflict) return;
    const state=scopixCloudConflict;
    cloudClearConflict();
    if(choice==='cloud') {
        scopixCloudPending=false;
        if (cloudApplyState(state)) cloudStatus('已使用云端版本。');
    } else if(choice==='local') {
        scopixCloudPending=true;
        cloudStatus('将使用本地记录覆盖云端，请注意另一设备的较新更改可能丢失。');
        cloudScheduleSync();
    }
}
async function cloudRefresh() {
    if (!scopixCloudUser || scopixCloudBusy || scopixCloudConflict) return;
    if(scopixCloudPending) {await cloudFlush();return;}
    scopixCloudBusy=true;
    const epoch=scopixCloudEpoch;
    try {
        const remote=await cloudFetch();
        if(epoch!==scopixCloudEpoch) return;
        const revision=Number(remote.revision)||0;
        if(revision===scopixCloudRevision) {cloudStatus('云端已是最新版本。');return;}
        scopixCloudRevision=revision;
        const cloudData={vocabulary:remote.vocabulary||[],annotations:remote.annotations||[]};
        if(cloudSame(cloudReadLocal(),cloudData)) cloudStatus('云端已是最新版本。');
        else cloudShowConflict(cloudData);
    } catch(err) {
        cloudStatus('检查云端失败：'+String(err.message||err),true);
    } finally {scopixCloudBusy=false;}
}
async function cloudSignIn() {
    if (!scopixCloudClient) return cloudStatus('尚未配置 Supabase，请先完成部署设置。',true);
    const email=document.getElementById('scopixCloudEmail')?.value.trim();
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return cloudStatus('请输入有效邮箱。',true);
    cloudStatus('正在发送邮箱登录链接…');
    const {error}=await scopixCloudClient.auth.signInWithOtp({
        email,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:true}
    });
    if(error) cloudStatus('发送失败：'+error.message,true);
    else cloudStatus('已请求发送登录邮件。请查看邮箱和垃圾邮件文件夹；链接需在允许的重定向地址上打开。');
}
async function cloudSignOut() {
    if (!scopixCloudClient) return;
    if(scopixCloudPending || scopixCloudBusy || scopixCloudConflict) {
        cloudStatus('还有未完成的同步或版本冲突。请先解决并确认云端保存成功后再退出。',true);
        return;
    }
    const {error}=await scopixCloudClient.auth.signOut();
    if(error) cloudStatus('退出失败：'+error.message,true);
}
function cloudAfterSignout() {
    scopixCloudEpoch++;
    clearTimeout(scopixCloudTimer);
    scopixCloudUser=null;
    scopixCloudRevision=0;
    scopixCloudPending=false;
    scopixCloudBusy=false;
    cloudClearConflict();
    // Restore the pre-login guest workspace, keeping account data out of shared browsers.
    try {
        const guest=JSON.parse(localStorage.getItem(SCOPIX_GUEST_BACKUP_KEY)||'{"vocabulary":[],"annotations":[]}');
        cloudApplyState(guest);
        localStorage.removeItem(SCOPIX_GUEST_BACKUP_KEY);
    } catch (_) {cloudApplyState({vocabulary:[],annotations:[]});}
    cloudSetAccountLabel();
    cloudStatus('已退出账号，显示访客本地记录。');
}
async function cloudOnSession(user) {
    if(!user) {if(scopixCloudUser) cloudAfterSignout();return;}
    if(scopixCloudUser?.id===user.id) return;
    cloudStoreGuestBackup();
    scopixCloudEpoch++;
    scopixCloudUser=user;
    scopixCloudRevision=0;
    scopixCloudPending=false;
    cloudClearConflict();
    cloudSetAccountLabel();
    await cloudInitialSync();
}
function openScopixCloudPanel() {
    const panel=document.getElementById('scopixCloudPanel');
    if(!panel) return;
    panel.hidden=false;
    document.getElementById('scopixCloudOverlay').hidden=false;
    document.body.classList.add('scopix-cloud-open');
    cloudSetAccountLabel();
    document.getElementById('scopixCloudClose').focus();
}
function closeScopixCloudPanel() {
    const panel=document.getElementById('scopixCloudPanel');
    if(!panel) return;
    panel.hidden=true;
    document.getElementById('scopixCloudOverlay').hidden=true;
    document.body.classList.remove('scopix-cloud-open');
}
function cloudInit() {
    if(!scopixCloudConfigured()) {
        cloudStatus('云端服务尚未启用：请按 CLOUD_SETUP.md 设置 Supabase URL、公开密钥及数据库。');
        return;
    }
    const cfg=window.SCOPIX_SUPABASE;
    scopixCloudClient=window.supabase.createClient(cfg.url,cfg.anonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    scopixCloudClient.auth.getSession().then(({data,error})=>{
        if(error) cloudStatus('无法读取登录状态：'+error.message,true);
        else cloudOnSession(data.session?.user||null);
    });
    scopixCloudClient.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_IN' || event==='INITIAL_SESSION') {
            // Do not await Supabase network calls inside this callback.
            setTimeout(()=>cloudOnSession(session?.user||null),0);
        } else if(event==='SIGNED_OUT') {
            setTimeout(cloudAfterSignout,0);
        }
    });
    window.addEventListener('online',()=>{if(scopixCloudPending)cloudScheduleSync();else cloudRefresh();});
    document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='visible') {
            if(scopixCloudPending) cloudScheduleSync();
            else cloudRefresh();
        }
    });
    cloudStatus('云端已配置，请使用邮箱登录。');
}
document.addEventListener('keydown',e=>{
    const panel=document.getElementById('scopixCloudPanel');
    if(panel && !panel.hidden && e.key==='Escape'){e.preventDefault();closeScopixCloudPanel();}
});
window.addEventListener('DOMContentLoaded',cloudInit);
