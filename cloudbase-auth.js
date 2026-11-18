/* Scopix V2.0 auth-only pilot — CloudBase Shanghai.
 * IMPORTANT: cloud learning data syncing is intentionally disabled in this pilot.
 * Do not replace local vocabulary/annotation records with other accounts' data.
 * CloudBase JS SDK v3: https://docs.cloudbase.net/api-reference/webv3/authentication
 */
(function () {
    'use strict';
    const ENV_ID = 'scopix-dev-d0gw92jjh40131733';
    let auth = null;
    let cloudbaseApp = null;
    let user = null;
    let verification = null;
    let requestEmail = '';
    let busy = false;
    let lastSent = 0;
    const $ = id => document.getElementById(id);
    function status(message, error) {
        const node = $('scopixCloudStatus');
        if (!node) return;
        node.textContent = message;
        node.dataset.error = String(Boolean(error));
    }
    function getEmail(u) {
        return u?.email || u?.user_metadata?.email || u?.identities?.find?.(x => x?.identity_data?.email)?.identity_data?.email || '';
    }
    function render() {
        const loggedIn = Boolean(user);
        if ($('scopixCloudAccount')) $('scopixCloudAccount').textContent = loggedIn ? (getEmail(user) || '已登录') : '尚未登录';
        if ($('scopixCloudLogin')) $('scopixCloudLogin').hidden = loggedIn || Boolean(verification);
        if ($('scopixCloudOtpForm')) $('scopixCloudOtpForm').hidden = loggedIn || !verification;
        if ($('scopixCloudLogout')) $('scopixCloudLogout').hidden = !loggedIn;
        if ($('scopixCloudDbProbe')) $('scopixCloudDbProbe').hidden = !loggedIn;
        if ($('scopixCloudDbWriteProbe')) $('scopixCloudDbWriteProbe').hidden = !loggedIn;
        if ($('scopixAccountButton')) $('scopixAccountButton').textContent = loggedIn ? '☁ 已登录' : '☁ 登录与同步';
    }
    function fail(err, prefix) {
        const message = (err && (err.message || err.error_description)) || String(err || '未知错误');
        status(prefix + '：' + message, true);
    }
    function requireAuth() {
        if (!auth) {
            status('CloudBase SDK 未能初始化。请检查脚本加载、网络和 HTTP 网关的跨域设置。', true);
            return false;
        }
        return true;
    }
    function isMissingSessionError(err) {
        const code = String(err?.code || err?.errorCode || '').toLowerCase();
        const message = String(err?.message || err?.error_description || err || '').toLowerCase();
        return ['session_not_found', 'no_session', 'credentials_not_found'].includes(code) ||
            /credentials? not found|session not found|no (active )?session|missing (login )?credentials/.test(message);
    }
    async function refreshSession() {
        if (!requireAuth()) return;
        try {
            const { data, error } = await auth.getSession();
            // A fresh browser has no login credentials yet; this is expected
            // before requesting an OTP, not an authentication setup failure.
            if (error) {
                if (!isMissingSessionError(error)) throw error;
                user = null;
            } else {
                user = data?.session ? (data.user || data.session.user || null) : null;
            }
            render();
            status(user ? 'CloudBase 登录成功（仅身份认证测试）。云端学习记录尚未开启。' : 'CloudBase 已连接，请使用邮箱验证码登录。', false);
        } catch (err) {
            if (isMissingSessionError(err)) {
                user = null;
                render();
                status('CloudBase 已连接，请使用邮箱验证码登录。', false);
                return;
            }
            user = null;
            render();
            fail(err, '检查登录状态失败');
        }
    }
    async function cloudSignIn() {
        if (!requireAuth() || busy) return;
        const email = $('scopixCloudEmail')?.value.trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            status('请输入正确的邮箱地址。', true);
            return;
        }
        if (Date.now() - lastSent < 60000) {
            status('验证码已请求发送，请先检查邮箱，至少间隔 60 秒再重试。', true);
            return;
        }
        busy = true;
        if ($('scopixCloudSendCode')) $('scopixCloudSendCode').disabled = true;
        status('正在向邮箱发送验证码…');
        try {
            // The returned verifyOtp closure binds the verification message ID.
            const { data, error } = await auth.signInWithOtp({ email });
            if (error) throw error;
            if (!data || typeof data.verifyOtp !== 'function') throw new Error('SDK 没有返回验证码校验回调，请确认使用 CloudBase SDK v3。');
            verification = data.verifyOtp;
            requestEmail = email;
            lastSent = Date.now();
            render();
            status('已请求发送验证码到 ' + email + '；请输入邮件中的 6 位数字。如未收到，请检查垃圾邮件。');
            $('scopixCloudOtp')?.focus();
        } catch (err) {
            fail(err, '发送验证码失败');
        } finally {
            busy = false;
            if ($('scopixCloudSendCode')) $('scopixCloudSendCode').disabled = false;
        }
    }
    async function cloudVerifyOtp() {
        if (!requireAuth() || !verification || busy) return;
        const token = $('scopixCloudOtp')?.value.trim();
        if (!/^[0-9]{6}$/.test(token || '')) {
            status('请输入邮件中的 6 位数字验证码。', true);
            return;
        }
        busy = true;
        if ($('scopixCloudVerifyCode')) $('scopixCloudVerifyCode').disabled = true;
        status('正在验证邮箱…');
        try {
            const { data, error } = await verification({ token });
            if (error) throw error;
            if (!data?.session) throw new Error('验证码已验证，但未返回有效会话。');
            verification = null;
            const fallbackUser = data.user || data.session.user;
            user = fallbackUser || { email: requestEmail };
            render();
            await refreshSession();
        } catch (err) {
            fail(err, '登录验证失败');
        } finally {
            busy = false;
            if ($('scopixCloudVerifyCode')) $('scopixCloudVerifyCode').disabled = false;
        }
    }
    function cloudResetOtp() {
        verification = null;
        requestEmail = '';
        if ($('scopixCloudOtp')) $('scopixCloudOtp').value = '';
        render();
        status('已返回邮箱输入。若要重新发码，请注意邮件发送频率限制。');
    }
    async function cloudTestStudyDb() {
        if (!user || !cloudbaseApp) {
            status('请先使用邮箱验证码登录后再测试数据库。', true);
            return;
        }
        if (busy) return;
        busy = true;
        const button = $('scopixCloudDbProbe');
        if (button) button.disabled = true;
        status('正在以当前登录用户身份只读检查 PostgreSQL…');
        try {
            if (typeof cloudbaseApp.rdb !== 'function') {
                throw new Error('当前加载的 SDK 缺少 rdb()；需要更新 CloudBase Web SDK。');
            }
            // No user ID or secret is passed; the SDK forwards the authenticated
            // session, and PostgreSQL RLS filters rows by auth.uid().
            const { data, error } = await cloudbaseApp.rdb()
                .from('scopix_study_state_v2')
                .select('user_id,revision,updated_at');
            if (error) throw error;
            const rows = Array.isArray(data) ? data : (data ? [data] : []);
            const currentId = String(user.id || user.sub || user.uid || '');
            if (rows.some(row => currentId && String(row.user_id) !== currentId)) {
                status('安全警报：查询结果包含与当前用户不符的记录，请停止测试并检查 RLS。', true);
                return;
            }
            status('云数据库只读查询成功；当前可见学习记录 ' + rows.length + ' 条。没有修改任何生词或批注。');
        } catch (err) {
            fail(err, '数据库只读检查失败');
        } finally {
            busy = false;
            if (button) button.disabled = false;
        }
    }
    async function cloudTestStudyDbWrite() {
        if (!user || !cloudbaseApp || busy) {
            if (!user) status('请先登录再测试云端写入。', true);
            return;
        }
        busy = true;
        const button = $('scopixCloudDbWriteProbe');
        if (button) button.disabled = true;
        status('正在检查当前账号是否已有云端记录…');
        try {
            const db = cloudbaseApp.rdb();
            const { data: existing, error: queryError } = await db
                .from('scopix_study_state_v2')
                .select('user_id,revision');
            if (queryError) throw queryError;
            const records = Array.isArray(existing) ? existing : (existing ? [existing] : []);
            if (records.length) {
                status('当前账号已有 ' + records.length + ' 条可见记录。安全起见，不执行插入或覆盖。');
                return;
            }
            // RLS plus the database DEFAULT auth.uid() determine row ownership.
            // No user ID is supplied by the browser. Deliberately do not upload
            // vocabulary, annotations or review progress in this test.
            const { error: insertError } = await db
                .from('scopix_study_state_v2')
                .insert({
                    vocabulary: [],
                    annotations: [],
                    reading_progress: {},
                    revision: 0
                });
            if (insertError) throw insertError;
            const { data: check, error: readError } = await db
                .from('scopix_study_state_v2')
                .select('user_id,revision,vocabulary,annotations,reading_progress');
            if (readError) throw readError;
            const rows = Array.isArray(check) ? check : (check ? [check] : []);
            if (rows.length !== 1 || rows[0].revision !== 0 ||
                !Array.isArray(rows[0].vocabulary) || !Array.isArray(rows[0].annotations)) {
                status('写入请求已完成，但回读验证未达到预期。请暂停进一步操作并检查数据库记录。', true);
                return;
            }
            status('数据库写入与回读成功！已创建当前账号的空白测试记录（版本 0），未上传或覆盖任何学习资料。');
        } catch (err) {
            fail(err, '数据库写入测试失败');
        } finally {
            busy = false;
            if (button) button.disabled = false;
        }
    }
    async function cloudSignOut() {
        if (!requireAuth() || busy) return;
        busy = true;
        try {
            const { error } = await auth.signOut();
            if (error) throw error;
            user = null;
            verification = null;
            render();
            status('已退出 CloudBase 账号。学习记录仍保存在当前浏览器，请勿在共享设备留下个人资料。');
        } catch (err) {
            fail(err, '退出失败');
        } finally {
            busy = false;
        }
    }
    function openScopixCloudPanel() {
        if (!$('scopixCloudPanel')) return;
        $('scopixCloudPanel').hidden = false;
        $('scopixCloudOverlay').hidden = false;
        document.body.classList.add('scopix-cloud-open');
        render();
        $('scopixCloudClose')?.focus();
    }
    function closeScopixCloudPanel() {
        if (!$('scopixCloudPanel')) return;
        $('scopixCloudPanel').hidden = true;
        $('scopixCloudOverlay').hidden = true;
        document.body.classList.remove('scopix-cloud-open');
    }
    // Existing study.js / annotation.js may invoke this hook. Do not silently
    // upload unprotected data until the per-user CloudBase DB design is ready.
    function scopixCloudLocalChanged() {}
    function cloudRefresh() { status('本版本仅测试登录，云端数据同步尚未启用。'); }
    function cloudResolve() { status('云端数据同步尚未启用，不会覆盖本地记录。'); }
    Object.assign(window, {
        cloudSignIn, cloudVerifyOtp, cloudResetOtp, cloudSignOut, cloudTestStudyDb, cloudTestStudyDbWrite,
        cloudRefresh, cloudResolve, scopixCloudLocalChanged,
        openScopixCloudPanel, closeScopixCloudPanel
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && $('scopixCloudPanel') && !$('scopixCloudPanel').hidden) {
            e.preventDefault();
            closeScopixCloudPanel();
        }
    });
    // Load browser SDK on demand: first use the official maintained v3 URL,
    // then the pinned v3 bundle. Fail with a diagnostic instead of a silent error.
    async function loadCloudBaseSdk() {
        if (window.cloudbase?.init) return;
        const sources = [
            'https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js',
            'https://static.cloudbase.net/cloudbase-js-sdk/3.9.1/cloudbase.full.js'
        ];
        const failed = [];
        for (const src of sources) {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    const timeout = window.setTimeout(() => {
                        script.remove();
                        reject(new Error('加载超时'));
                    }, 12000);
                    script.src = src;
                    script.async = true;
                    script.onload = () => { clearTimeout(timeout); resolve(); };
                    script.onerror = () => {
                        clearTimeout(timeout);
                        script.remove();
                        reject(new Error('脚本请求失败（检查网络/扩展/CSP）'));
                    };
                    document.head.appendChild(script);
                });
                if (window.cloudbase?.init) return;
                failed.push(src + '：脚本已加载但未提供 cloudbase.init');
            } catch (err) {
                failed.push(src + '：' + (err.message || String(err)));
            }
        }
        throw new Error('无法加载 CloudBase Web SDK。请在浏览器直接访问 static.cloudbase.net 验证可达性，或打开 F12 → Network 查看错误。详情：' + failed.join('；'));
    }
    window.addEventListener('DOMContentLoaded', async () => {
        status('正在加载 CloudBase 登录组件…');
        try {
            await loadCloudBaseSdk();
            const app = window.cloudbase.init({ env: ENV_ID, region: 'ap-shanghai' });
            cloudbaseApp = app;
            auth = app.auth();
            await refreshSession();
        } catch (err) {
            fail(err, '初始化 CloudBase 失败');
        }
    });
})();
