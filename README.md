# 双色球选号助手

**🌐 线上地址：<https://eric-hua.github.io/ssq-lottery/>**

一个纯前端(零依赖、可离线)的双色球选号工具,包含：

| 功能 | 说明 |
| --- | --- |
| 🎯 智能选号 | 单式 / 复式 / 胆拖三种玩法选号板,实时校验并计算注数,可一键复制 |
| ✂️ 杀号公式 | 12 个红球 + 7 个蓝球民间常用杀号公式,基于最新开奖实时计算,多公式并集,被杀号码在选号板灰显 |
| 💡 带概率推荐 | 基于 500 期频率/遗漏/温冷度加权的统计指数模型,输出胆码/拖码/蓝球概率 + 约束化的 5 注推荐方案(和值、奇偶、大小、三区、连号约束),附上期回测 |
| 🎲 随机生成 | 纯随机 / 智能约束随机(1/5/10 注),可填入备选池 |
| 📜 历史开奖 | 500 期官方数据表格(和值/奇偶/大小/三区/连号/重号),期号搜索、分页、排序 |
| 📊 数据统计 | 红蓝球频次图、当前遗漏图、最近 30 期和值走势、热号/冷号 TOP 榜(近10/30/50/500 期可切) |
| 📋 备选池 | 收集心仪注数(最多 10 注),一键复制成文本去投注 |

## 文件

- `index.html` — 应用主体(样式 + 逻辑,原生 JS,无任何外部依赖)
- `data.js` — 500 期真实开奖数据(中国福彩官网 cwl.gov.cn,按期号升序;由 GitHub Actions 自动更新,见下方「更新数据」)
- `scripts/update_data.py` — 数据更新脚本(多数据源 + 增量合并)
- `.github/workflows/update-data.yml` — 每周二/四/日自动更新并部署

直接双击 `index.html` 即可使用,无需服务器、无需联网。

## 更新数据(已自动化)

**正常情况下你不需要做任何事。** 仓库里的 `scripts/update_data.py` + `.github/workflows/update-data.yml` 会在**每周二、四、日(双色球开奖日)北京时间 22:00 自动**:

1. 拉取最新开奖数据
2. 与现有数据按期号合并(保留 500 期历史,只补充新期次)
3. 有新增则提交并自动重新部署站点(另一个 UTC 17:00 的任务作为后备重试)

数据源(按顺序尝试,官网屏蔽境外机房 IP 时自动切到镜像):

| # | 数据源 | 说明 |
| --- | --- | --- |
| 1 | 福彩官网 cwl.gov.cn | 最权威,但对 GitHub 机房 IP 返回 403 |
| 2 | GitHub 镜像 `gudaoxuri/lottery_history` | 每日自动更新,境外可访问 |

### 手动运行 / 本地验证

```bash
# 自动选择数据源(本机可直连官网,会优先用官网)
python3 scripts/update_data.py

# 只走镜像源(模拟 GitHub Actions 的情况)
python3 scripts/update_data.py --source mirror

# 只走官网
python3 scripts/update_data.py --source official
```

脚本是「增量合并」的:内容没变化时不会写文件;有变化时才更新 `data.js`。手动运行后按平时的流程 `git commit && git push` 即可。

也可在 GitHub 的 **Actions → Update lottery data → Run workflow** 手动触发一次云端更新。

## 安装到手机 / 桌面(PWA)

本站是一个可安装的 PWA:

- **Android / 桌面 Chrome、Edge**:打开站点后,点击页面上方的「📲 安装到桌面」,或用地址栏右侧的安装图标
- **iPhone / iPad Safari**:点「分享」→「添加到主屏幕」

安装后能全屏运行(无浏览器地址栏),并且**离线也能用** —— Service Worker 会缓存应用外壳与开奖数据。

## 部署

本仓库通过 GitHub Actions 自动部署到 GitHub Pages:

1. Pages 的发布源设置为 **GitHub Actions**(仓库 Settings → Pages → Source)
2. 推送到 `main` 分支后,`.github/workflows/pages.yml` 会自动把仓库根目录发布为静态站点
3. 也可在 Actions 页面手动触发(`workflow_dispatch`)

## 免责声明

彩票开奖为独立随机事件,任何历史数据、公式、统计模型都无法提高中奖概率。
本工具仅供娱乐与学习,所有"概率 / 指数"均为历史统计参考值,与真实中奖概率无关。
请理性购彩、量力而行,未成年人不得购彩。
