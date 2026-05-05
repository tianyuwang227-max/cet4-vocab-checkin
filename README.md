## CET4 Vocab Check-in

一个给两个人使用的四级单词学习网页：

- Vite + React + TypeScript
- Cloudflare Pages Functions
- Cloudflare D1
- 两个固定用户：小汪、小言子
- 每日同组新词，个人进度/错词/打卡互不影响

### Local development

```bash
npm install
npm run dev
```

Pages Functions + D1 本地联调：

```bash
npm run db:migrate:local
npm run pages:dev
```

### D1 setup

创建 Cloudflare D1 后，把 `wrangler.toml` 里的 `database_id` 替换为真实 ID：

```bash
wrangler d1 create cet4-vocab-checkin
wrangler d1 migrations apply cet4-vocab-checkin
```
