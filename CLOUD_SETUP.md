# Scopix V1.6 — 登录与云端学习数据配置指南

> 当前只是代码预览版。未完成本指南前，登录按钮会显示“云端服务尚未启用”，本地生词/批注/复习仍可以使用。

## 1. 创建 Supabase 项目

1. 前往 https://supabase.com/dashboard ，创建一个项目。
2. 打开 **SQL Editor**，粘贴并执行仓库中的 `supabase/schema.sql`。
3. 在 **Authentication → Providers → Email** 启用邮箱登录（Magic Link）。
4. 在 **Authentication → URL Configuration** 设置：
   - Site URL: `https://www.scopix.cn`
   - Redirect URLs: `https://www.scopix.cn/**`、`https://scopix.cn/**` 以及用于测试的**具体** Vercel Preview URL。
   - 测试时如果邮箱链接返回正式站，而非预览站，检查这里的 Redirect URLs。
5. 确认邮件模板为 **Magic Link**（包含 `{{ .ConfirmationURL }}`），而不是仅发送纯数字 OTP。

## 2. 配置前端连接

在测试分支 `feature/cloud-auth-v1.6` 打开 `cloud-config.js`：

```js
window.SCOPIX_SUPABASE = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'sb_publishable_...'
};
```

- `url`：Supabase Project URL。
- `anonKey`：Supabase **publishable**（或旧版 anon）**公开密钥**。
- 这两个值是面向浏览器的公开配置，配合数据库的 Row Level Security 使用。
- **千万不要**将 `service_role`、`sb_secret_...`、数据库密码、SMTP 密码放在 HTML、前端 JS 或 GitHub 仓库里。
- 若仓库公开，项目 URL 与 publishable key 本身也会公开；这是 Supabase 前端的正常使用方式，务必验证 RLS。

## 3. 测试前的安全检查

在 **Table Editor → scopix_study_state** 确认启用 Row Level Security。
SQL 已限定用户只能查询、插入、修改自己的行，并且写入通过基于 revision 的原子版本校验函数进行。

请使用两个独立邮箱和两个浏览器分别登录，确认账号 A 不能访问账号 B 的数据。**如果权限测试未通过，不要合并生产分支**。

## 4. 数据同步规则

- **未登录**：原有 `localStorage` 模式不变。
- **首次登录、云端为空**：上传当前浏览器生词、批注及复习计划。
- **当前浏览器没有学习数据、云端有数据**：从云端恢复。
- **本地和云端都有但版本不同**：要求用户选择使用云端或以本地覆盖云端；不会悄悄删除任何一方。选择前请从“我的学习资料”导出 JSON 备份。
- **正常登录后改动**：稍作延迟自动向云端保存；设备重新回到前台时检查云端更新。
- **两台设备同时保存**：若数据库 revision 发生冲突，停止自动覆盖并提示用户选择。
- **退出登录**：恢复此前的访客工作区，避免在共享浏览器直接显示该账号的云端学习数据。
- **同步失败/断网**：本地学习记录依旧保留；重新联网后检查同步状态。用户可点击“检查云端更新”重试。

> 注意：这是**整份学习数据的版本保护式同步**，还不是两端字段级/逐条冲突合并。若两台设备同时更改不同单词，人工选择任一端可能丢失另一端的改动，因此建议先导出备份。

## 5. 完整验收

- 在测试预览中输入邮箱，收到登录链接，点击后网站显示“已登录”。
- 已有生词、批注和复习进度可成功上传；刷新后数据不丢失。
- 用第二台设备登录同一邮箱，看到云端记录。
- 第二台设备修改生词复习状态，第一台重新打开页面能检查到更新，并能选择云端版本。
- 使用不同邮箱登录，确认数据互相隔离。
- 故意断网新增一条生词，再联网，确认本地数据仍在且能重新同步。
- 退出登录后不再显示账号数据；重新登录后可从云端恢复。
- 未配置 Supabase 或邮件发送失败时，现有的纯本地功能仍可用。

## 6. 上线前的额外事项

- 配置正式站邮件发送服务、发送额度与滥用防护。
- 设置账号注销与删除学习数据流程，以及明确的隐私政策。
- V1.2、V1.3、V1.4、V1.5 均仍处在草稿 PR，请按顺序验收并合并，再合并 V1.6。
- 当前没有部署账号服务器，也没有真实 Supabase 项目凭据，因此不能声称邮件登录与云端同步已在线测试通过。
