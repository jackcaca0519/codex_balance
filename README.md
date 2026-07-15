# Codex Balance Widget

一个放在 mac 桌角的小窗口工具：

- 每 5 分钟自动刷新一次
- 支援手动点 `重整`
- 可打开官方 Usage Dashboard 让你登入
- mac 开机登录后会自动启动

## 运行

```bash
npm install
npm start
```

在 mac 上，应用会自动注册为开机登录项。

## 打包桌面 App

```bash
npm run package:mac
```

打包结果会在 `outputs/Codex Balance Widget-darwin-arm64/Codex Balance Widget.app`
。

## 首次使用

1. 打开应用后，点 `開啟儀表板`
2. 在跳出的 Dashboard 页面登入你的 OpenAI / ChatGPT 帳號
3. 回到小窗按 `重整`

应用会把上一次抓到的结果存在本机用户资料里，重开后会先显示缓存值，再自动刷新。

## 抓取来源

默认抓取的页面是：

`https://chatgpt.com/codex/settings/usage`

如果以后官方改了路径，直接改 `main.js` 里的 `USAGE_URL`。
