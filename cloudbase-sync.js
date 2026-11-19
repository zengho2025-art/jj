/* Scopix V2.1 — account-scoped local workspaces and opt-in sync pilot.
 * No automatic network writes. User must explicitly upload/download.
 * Current learning records from older versions remain available as a guest
 * workspace until explicitly imported. This is a test-stage implementation.
 */
(function () {
    'use strict';
    const VOCAB = 'scopix_vocabulary_v1';
    const MARKS = 'scopix_annotations_v1';
    const ACTIVE = 'scopix_v21_active_user';
    const GUEST = 'scopix_v21_guest_snapshot';
    const PREFIX = 'scopix_v21_account_';
    const BASE = 'scopix_v21_sync_base_';
    const BACKUP = 'scopix_v21_backup_';
    const TABLE = 'scopix_study_state_v2';
    const empty = () => ({ vocabulary: [], annotations: [], reading_progress: {} });
    const $ = id => document.getElementById(id);
    let app = null;
    let userId = null;
    let busy = false;

    function parse(key, fallback) {
        try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
        catch (_) { return fallback; }
    }
    function takeLocal() {
        return {
            vocabulary: parse(VOCAB, []),
            annotations: parse(MARKS, []),
            reading_progress: {}
        };
    }
    function normalized(data) {
        return {
            vocabulary: Array.isArray(data?.vocabulary) ? data.vocabulary : [],
            annotations: Array.isArray(data?.annotations) ? data.annotations : [],
            reading_progress: data?.reading_progress && typeof data.reading_progress === 'object' && !Array.isArray(data.reading_progress) ? data.reading_progress : {}
        };
    }
    function saveKey(key, data) {
        // Throwing on a full localStorage is intentional: never switch or
        // overwrite an existing workspace if the backup could not be saved.
        localStorage.setItem(key, JSON.stringify(data));
    }
    function applyLocal(data) {
        const s = normalized(data);
        const oldV = localStorage.getItem(VOCAB);
        const oldM = localStorage.getItem(MARKS);
        try {
            saveKey(VOCAB, s.vocabulary);
            saveKey(MARKS, s.annotations);
        } catch (e) {
            try {
                if (oldV === null) localStorage.removeItem(VOCAB); else localStorage.setItem(VOCAB,oldV);
                if (oldM === null) localStorage.removeItem(MARKS); else localStorage.setItem(MARKS,oldM);
            } catch (_) {}
            throw e;
        }
        if (typeof loadScopixVocabulary === 'function') scopixVocabulary = loadScopixVocabulary();
        if (typeof readScopixMarks === 'function') scopixMarks = readScopixMarks();
        for (const name of ['refreshScopixMarks','renderScopixAnnotationSidebar','renderScopixStudyLibrary','updateScopixReviewCounts']) {
            try { if (typeof window[name] === 'function') window[name](); } catch (_) {}
        }
    }
    function note(message, error=false) {
        const el = $('scopixCloudSyncStatus');
        if (el) { el.textContent = message; el.dataset.error = String(error); }
    }
    function hasContent(s) {
        return s.vocabulary.length > 0 || s.annotations.length > 0 ||
            Object.keys(s.reading_progress).length > 0;
    }
    function userKey(id) { return PREFIX + id; }
    function canonical(x) {
        if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
        if (x && typeof x === 'object')
            return '{' + Object.keys(x).sort().map(k => JSON.stringify(k)+':'+canonical(x[k])).join(',') + '}';
        return JSON.stringify(x);
    }
    function fingerprint(s) {
        const str = canonical(normalized(s));
        let n = 2166136261;
        for (let i=0;i<str.length;i++) { n ^= str.charCodeAt(i); n = Math.imul(n,16777619); }
        return (n>>>0).toString(16);
    }
    function storeBaseline(uid, row) {
        saveKey(BASE+uid, {revision:Number(row.revision)||0, hash:fingerprint(row)});
    }
    function allowedUpload(row, local) {
        if (!row) return true;
        if (!hasContent(normalized(row)) && Number(row.revision)===0) return true;
        const b = parse(BASE+userId, null);
        return !!b && Number(row.revision)===b.revision && fingerprint(row)===b.hash;
    }
    function backupCurrent(reason) {
        const stamp = new Date().toISOString().replace(/[:.]/g,'-');
        const key = BACKUP + (userId||'guest') + '_' + stamp;
        saveKey(key, {reason, saved_at:new Date().toISOString(), snapshot:takeLocal()});
        return key;
    }
    // Prevent a stale logged-in workspace appearing before the SDK verifies
    // which account owns the session. This happens before study.js loads.
    function bootGuard() {
        const previous = localStorage.getItem(ACTIVE);
        if (!previous) return;
        // Preserve the previous account's data BEFORE restoring guest data.
        saveKey(userKey(previous), takeLocal());
        applyLocal(parse(GUEST, empty()));
        localStorage.removeItem(ACTIVE);
    }
    try { bootGuard(); }
    catch (e) { window.scopixWorkspaceBootError = e.message||String(e); }

    async function onAuth(user, clientApp) {
        app = clientApp || app;
        const next = user && String(user.id || user.uid || user.sub || '');
        const current = localStorage.getItem(ACTIVE);
        if (current===next && next) {
            userId=next; show();
            return;
        }
        try {
            if (current) {
                saveKey(userKey(current), takeLocal());
            } else if (localStorage.getItem(GUEST)===null) {
                saveKey(GUEST,takeLocal());
            }
            const replacement = next ? parse(userKey(next),empty()) : parse(GUEST,empty());
            applyLocal(replacement);
            if (next) localStorage.setItem(ACTIVE,next);
            else localStorage.removeItem(ACTIVE);
            userId=next||null;
            show();
            if (next) note('账号工作区已隔离。云端同步为手动操作，请先检查云端数据；访客旧记录不会自动上传。');
            else note('当前显示访客本地工作区。');
        } catch (err) {
            // Do not apply another user's workspace if local persistence failed.
            note('切换账号本地数据失败：'+(err.message||err)+'。请先导出备份并检查存储空间。',true);
            throw err;
        }
    }
    function show() {
        const signedIn=Boolean(userId);
        if ($('scopixCloudSyncActions')) $('scopixCloudSyncActions').hidden=!signedIn;
        const messages={
            guest:'游客模式 · 本地临时保存：批注和生词仅保存在当前浏览器，清理缓存或使用其他设备后可能无法恢复。登录后可选择导入并手动同步云端。',
            account:'已登录 · 当前账号的浏览器本地资料。只有主动点击「上传本账号到云端」后才会同步；不能保证自动保存到云端。'
        };
        const notice=signedIn?messages.account:messages.guest;
        for (const id of ['scopixAnnotationStorageNotice','scopixStudyStorageNotice','scopixCloudStorageNotice','scopixGuestBannerText']) {
            if ($(id)) $(id).textContent=notice;
        }
        for (const id of ['scopixAnnotationGuestLogin','scopixStudyGuestActions','scopixGuestBannerLogin']) {
            if ($(id)) $(id).hidden=signedIn;
        }
        if ($('scopixGuestBanner')) $('scopixGuestBanner').hidden=signedIn;
        const guest=normalized(parse(GUEST,empty()));
        const button=$('scopixImportGuestButton');
        if(button) {
            button.disabled=!signedIn||!hasContent(guest);
            button.title=hasContent(guest)?'将游客学习资料合并到当前账号本地工作区（不会自动上传）':'访客没有待导入的学习资料';
            button.textContent='导入访客本地记录（生词 '+guest.vocabulary.length+' · 批注 '+guest.annotations.length+'）';
        }
    }
    function localChanged() {
        if (!userId) {
            try { saveKey(GUEST,takeLocal()); } catch (_) { note('访客记录备份失败，请导出学习资料。',true); }
            return;
        }
        try {
            saveKey(userKey(userId),takeLocal());
            note('已保存到此账号的浏览器工作区；尚未同步云端。');
        } catch (err) { note('保存账号本地工作区失败：'+(err.message||err),true); }
    }
    async function fetchMine() {
        const {data,error} = await app.rdb().from(TABLE)
            .select('user_id,vocabulary,annotations,reading_progress,revision,updated_at');
        if(error) throw error;
        const rows=Array.isArray(data)?data:(data?[data]:[]);
        if(rows.length>1 || (rows[0] && String(rows[0].user_id)!==userId))
            throw new Error('安全检查失败：返回了不属于当前账号的记录。请停止操作。');
        return rows[0] || null;
    }
    async function inspect() {
        if (!userId || busy) return;
        busy=true;
        try {
            const row=await fetchMine();
            if(!row) note('云端暂无记录。本地资料保持不变。');
            else note('云端版本 '+row.revision+'；生词 '+normalized(row).vocabulary.length+' 条、批注 '+normalized(row).annotations.length+' 条。本地尚未改变。');
        } catch (e) { note('读取云端失败：'+(e.message||e),true); }
        finally {busy=false;}
    }
    function downloadJson() {
        const data={exported_at:new Date().toISOString(),source:'Scopix V2.1 account-local export',user_id:userId,snapshot:takeLocal()};
        const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const link=document.createElement('a');
        link.href=url;link.download='scopix-local-backup-'+new Date().toISOString().slice(0,10)+'.json';
        document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        note('已请求下载本地 JSON 备份，请检查浏览器下载列表。');
    }
    async function pull() {
        if(!userId||busy)return;
        busy=true;
        try {
            const row=await fetchMine();
            if(!row){note('云端还没有这位用户的记录，无需下载。');return;}
            const remote=normalized(row), local=takeLocal();
            if(canonical(remote)===canonical(normalized(local))){
                storeBaseline(userId,row);
                note('云端与本地一致（版本 '+row.revision+'），无需替换。');return;
            }
            if (!confirm('将云端记录应用到当前账号的本地工作区？现有本地记录会先备份到浏览器存储，确认后才替换。')) {
                note('已取消下载，本地记录未改变。');return;
            }
            const key=backupCurrent('before-cloud-pull');
            applyLocal(remote);
            saveKey(userKey(userId),remote);
            storeBaseline(userId,row);
            note('已恢复云端版本 '+row.revision+'。替换前本地记录保存在备份 '+key+'。');
        }catch(e){note('下载云端记录失败：'+(e.message||e),true);}
        finally{busy=false;}
    }
    async function push() {
        if(!userId||busy)return;
        busy=true;
        try {
            const local=normalized(takeLocal());
            const remote=await fetchMine();
            if(remote && canonical(local)===canonical(normalized(remote))){
                storeBaseline(userId,remote);
                note('云端与本地已一致，不需要上传。');return;
            }
            if(!allowedUpload(remote,local)){
                note('发现云端存在未确认的新数据或版本变化。已拒绝覆盖；请先导出本地备份，再手动下载/对比云端数据。',true);
                return;
            }
            if(!confirm('确认上传当前账号的生词和批注？本次仅同步当前账号，云端记录将替换为本地版本。请确保这是测试数据或已另存备份。')){
                note('已取消上传。');return;
            }
            // Backup locally before any remote write. The CAS revision filter
            // is evaluated by PostgreSQL atomically, so another device's newer
            // revision cannot be overwritten by a stale client.
            backupCurrent('before-cloud-push');
            if(!remote) {
                const {error}=await app.rdb().from(TABLE).insert({
                    vocabulary:local.vocabulary,annotations:local.annotations,
                    reading_progress:local.reading_progress,revision:1
                });
                if(error)throw error;
            } else {
                const revision=Number(remote.revision);
                const {error,count}=await app.rdb().from(TABLE)
                    .update({
                        vocabulary:local.vocabulary,annotations:local.annotations,
                        reading_progress:local.reading_progress,revision:revision+1
                    },{count:'exact'})
                    .eq('user_id',userId).eq('revision',revision);
                if(error)throw error;
                if(count!==null && count!==undefined && count!==1)
                    throw new Error('云端版本冲突：更新行数为 '+count+'。没有覆盖其他版本。');
            }
            const after=await fetchMine();
            if(!after || canonical(normalized(after))!==canonical(local) ||
                Number(after.revision)!==Number(remote?.revision||0)+1)
                throw new Error('写入后校验不通过：可能发生版本冲突，请重新检查云端。');
            storeBaseline(userId,after);
            note('云端保存成功，版本 '+after.revision+'；生词 '+local.vocabulary.length+' 条，批注 '+local.annotations.length+' 条。');
        }catch(e){note('上传失败：'+(e.message||e)+'。本地记录仍然保留。',true);}
        finally{busy=false;}
    }
    function importGuest() {
        if(!userId||busy)return;
        const guest=normalized(parse(GUEST,empty()));
        if(!hasContent(guest)){note('访客工作区没有可导入的学习资料。');show();return;}
        const local=normalized(takeLocal());
        // Keep the account version on duplicate IDs, so a guest copy can
        // never silently replace an existing account annotation/review state.
        function mergeById(accountItems,guestItems) {
            const known=new Set(accountItems.map(x=>x?.id).filter(Boolean));
            const additions=[];
            for(const item of guestItems) {
                if(!item || typeof item.id!=='string'||known.has(item.id))continue;
                known.add(item.id);
                additions.push(item);
            }
            return accountItems.concat(additions);
        }
        const merged={
            vocabulary:mergeById(local.vocabulary,guest.vocabulary),
            annotations:mergeById(local.annotations,guest.annotations),
            reading_progress:{...guest.reading_progress,...local.reading_progress}
        };
        const addedWords=merged.vocabulary.length-local.vocabulary.length;
        const addedMarks=merged.annotations.length-local.annotations.length;
        if(addedWords===0&&addedMarks===0&&
           canonical(merged.reading_progress)===canonical(local.reading_progress)){
            note('访客记录已存在于当前账号工作区；没有需要导入的新数据。');return;
        }
        if(!confirm('准备将访客资料合并到当前账号本地工作区：新增生词 '+addedWords+' 条、批注 '+addedMarks+' 条。相同 ID 保留账号现有记录。将先备份账号本地数据；不会删除游客资料，也不会自动上传云端。是否继续？'))return;
        try {
            const key=backupCurrent('before-import-guest');
            applyLocal(merged);
            saveKey(userKey(userId),merged);
            show();
            note('访客资料已合并：新增生词 '+addedWords+' 条、批注 '+addedMarks+' 条。账号本地备份：'+key+'。仍需主动上传才会同步云端。');
        }catch(e){note('导入访客资料失败：'+(e.message||e),true);}
    }
    Object.assign(window,{
        scopixSyncOnAuthChange:onAuth,
        scopixSyncLocalChanged:localChanged,
        scopixSyncInspect:inspect,
        scopixSyncExport:downloadJson,
        scopixSyncPull:pull,
        scopixSyncPush:push,
        scopixSyncImportGuest:importGuest
    });
})();
