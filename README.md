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
- `data.js` — 500 期真实开奖数据(中国福彩官网 cwl.gov.cn,2023-05-25 ~ 2026-09-10 第 2026105 期,按期号升序)

直接双击 `index.html` 即可使用,无需服务器、无需联网。

## 更新数据

`data.js` 由官方接口生成(可按需重跑)：

```bash
curl -s -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.cwl.gov.cn/" \
  "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=500&issueStart=&issueEnd=&dayStart=&dayEnd=" \
  -o /tmp/ssq.json
python3 - <<'EOF'
import json
records = []
for d in json.load(open('/tmp/ssq.json'))['result']:
    records.append([int(d['code']), d['date'][:10], [int(x) for x in d['red'].split(',')], int(d['blue'])])
records.sort(key=lambda r: r[0])
lines = ['  [%d,"%s",[%s],%d],' % (r[0], r[1], ','.join(map(str, r[2])), r[3]) for r in records]
open('data.js','w').write('window.SSQ_DATA = [\n' + '\n'.join(lines) + '\n];\n')
EOF
```

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
