#!/usr/bin/env python3
"""更新双色球开奖数据(data.js)。

设计要点:
- **多数据源 + 合并**:依次尝试各数据源,把结果与现有 data.js 里的记录按「期号」合并
  (已有 500 期历史不会丢,只补充新期次),最后保留最近 COUNT 期。
- **增量友好**:内容没变化就不写文件,工作流自然不会产生空提交。
- 数据源(按可信度优先;已有记录一律不被覆盖,只补充新期次):
  1. 福彩官网(最权威;会屏蔽境外机房 IP —— 本机/国内可直连)
  2. 500.com 历史数据表(当晚即有数据;GitHub 机房可访问 —— 供 Actions 当晚更新)
  3. GitHub 镜像 gudaoxuri/lottery_history(每日 00:38 UTC 更新,作为傅底)

用法:
    python3 scripts/update_data.py             # 自动:依次尝试所有数据源
    python3 scripts/update_data.py --source 500
    python3 scripts/update_data.py --source official
    python3 scripts/update_data.py --source mirror
"""

from __future__ import annotations

import argparse
import http.client
import json
import pathlib
import re
import sys
import time
import urllib.parse

OFFICIAL_API = (
    "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
    "?name=ssq&issueCount=500&issueStart=&issueEnd=&dayStart=&dayEnd="
)
MIRROR_API = (
    "https://raw.githubusercontent.com/gudaoxuri/lottery_history/main/data/ssq.json"
)
# 500.com 历史数据表:无需参数,当晚即有数据(表格页,需解析 HTML)
API_500 = "https://datachart.500.com/ssq/history/newinc/history.php"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Referer": "https://www.cwl.gov.cn/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data.js"
COUNT = 500
# 抓 HTML 页面时的请求头(500.com 用)
HEADERS_HTML = {
    "User-Agent": HEADERS["User-Agent"],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
RECORD_RE = re.compile(
    r"\[\s*(\d{7})\s*,\s*\"(\d{4}-\d{2}-\d{2})\"\s*,\s*\[([\d,\s]+)\]\s*,\s*(\d+)\s*\]"
)

Record = tuple[str, list[int], int]  # (date, reds, blue)


def _require_https(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"只允许 https 且必须含主机名: {url!r}")
    return parsed


def _https_get(url: str, timeout: int = 30, headers: dict | None = None) -> bytes:
    """发 GET 并以字节返回(仅允许 https)。"""
    parsed = _require_https(url)
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    conn = http.client.HTTPSConnection(parsed.netloc, timeout=timeout)
    try:
        conn.request("GET", path, headers=headers or HEADERS)
        resp = conn.getresponse()
        raw = resp.read()
        status = resp.status
    finally:
        conn.close()
    if status != http.client.OK:
        raise ValueError(f"HTTP {status}: {raw[:100]!r}")
    return raw


def http_get_json(url: str, timeout: int = 30):
    """用 HTTPSConnection 发 GET 并解析 JSON(scheme 固定为 https)。"""
    raw = _https_get(url, timeout)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"返回不是合法 JSON: {raw[:100]!r}") from exc


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ").strip()


def fetch_500() -> dict[int, Record]:
    """500.com 历史表(<tbody id="tdata">)。

    行结构:td[0]=期号, td[1..6]=红球, td[7]=蓝球, td[15]=开奖日期。
    这个源在 GitHub 机房也能访问,且当晚就有数据。
    """
    raw = _https_get(API_500, 30, HEADERS_HTML).decode("utf-8", "ignore")
    # 每行开头有 <!--<td>n</td>--> 注释单元格,必须先删掉,否则所有列会错位
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    m = re.search(r'id="tdata"(.*?)</tbody>', raw, re.S)
    body = m.group(1) if m else raw
    out: dict[int, Record] = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        tds = [_strip_tags(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(tds) < 16:
            continue
        issue = _norm_issue(tds[0])
        if issue is None:
            continue
        rec = _norm_record(issue, tds[15], tds[1:7], tds[7])
        if rec:
            out[issue] = rec
    if not out:
        raise ValueError(
            f"500.com 页面解析后为空(响应 {len(raw)} 字节,首段 {raw[:90]!r})"
        )
    return out


def _norm_issue(value: object) -> int | None:
    """把不同数据源的期号统一成 7 位(如 26106 -> 2026106)。"""
    digits = re.sub(r"\D", "", str(value))
    if len(digits) == 5:
        digits = "20" + digits
    if len(digits) != 7:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def _norm_record(issue: int, date: object, reds: object, blue: object) -> Record | None:
    try:
        red_list = sorted(int(x) for x in reds)  # type: ignore[union-attr]
        blue_int = int(blue)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    date_str = str(date)[:10]
    if len(red_list) != 6 or len(set(red_list)) != 6:
        return None
    if not all(1 <= n <= 33 for n in red_list) or not 1 <= blue_int <= 16:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
        return None
    return (date_str, red_list, blue_int)


def fetch_official() -> dict[int, Record]:
    payload = http_get_json(OFFICIAL_API)
    rows = payload.get("result")
    if not rows:
        raise ValueError(f"未返回 result 字段: {str(payload)[:120]}")
    out: dict[int, Record] = {}
    for row in rows:
        issue = _norm_issue(row.get("code"))
        if issue is None:
            continue
        rec = _norm_record(
            issue,
            str(row.get("date", "")),
            str(row.get("red", "")).split(","),
            row.get("blue"),
        )
        if rec:
            out[issue] = rec
    if not out:
        raise ValueError("官网数据解析后为空")
    return out


def fetch_mirror() -> dict[int, Record]:
    payload = http_get_json(MIRROR_API)
    rows = payload if isinstance(payload, list) else payload.get("data", [])
    out: dict[int, Record] = {}
    for row in rows:
        issue = _norm_issue(row.get("issueNumber"))
        if issue is None:
            continue
        rec = _norm_record(
            issue, row.get("drawDate"), row.get("redBalls"), row.get("blueBall")
        )
        if rec:
            out[issue] = rec
    if not out:
        raise ValueError("镜像数据解析后为空")
    return out


SOURCES = [
    ("福彩官网", fetch_official),
    ("500.com", fetch_500),
    ("GitHub 镜像", fetch_mirror),
]


def load_existing() -> dict[int, Record]:
    if not OUT.exists():
        return {}
    text = OUT.read_text(encoding="utf-8")
    out: dict[int, Record] = {}
    for issue_s, date_s, reds_s, blue_s in RECORD_RE.findall(text):
        try:
            issue = int(issue_s)
            reds = [int(x) for x in reds_s.split(",")]
        except ValueError:
            continue
        rec = _norm_record(issue, date_s, reds, blue_s)
        if rec:
            out[issue] = rec
    return out


def build_js(records: dict[int, Record]) -> str:
    latest = sorted(records)[-COUNT:]
    lines = []
    for issue in latest:
        date_s, reds, blue = records[issue]
        red_text = ", ".join(str(n) for n in reds)
        lines.append(f'  [{issue}, "{date_s}", [{red_text}], {blue}],')
    header = (
        f"// 双色球历史开奖数据(中国福利彩票官方数据, {len(latest)}期, 按期号升序排列)\n"
        "// 格式: [期号, 日期, 红球数组, 蓝球]\n"
        f"// 数据来源: www.cwl.gov.cn 更新至 {latest[-1]} 期 · 由 GitHub Actions 自动更新\n"
    )
    return header + "window.SSQ_DATA = [\n" + "\n".join(lines) + "\n];\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="更新双色球开奖数据")
    parser.add_argument(
        "--source", choices=["auto", "official", "500", "mirror"], default="auto"
    )
    parser.add_argument("--attempts", type=int, default=3, help="每个数据源的重试次数")
    args = parser.parse_args()

    if args.source == "auto":
        chosen = SOURCES
    else:
        key = (
            "福彩官网"
            if args.source == "official"
            else ("500.com" if args.source == "500" else "GitHub 镜像")
        )
        chosen = [s for s in SOURCES if s[0] == key]

    merged = load_existing()
    before = len(merged)
    succeeded: list[str] = []
    errors: list[str] = []

    for name, fetcher in chosen:
        last_error: Exception | None = None
        for attempt in range(1, args.attempts + 1):
            try:
                rows = fetcher()
                # 只补充新期次:已有记录不被覆盖(可信源优先)
                added = {i: r for i, r in rows.items() if i not in merged}
                merged.update(added)
                succeeded.append(f"{name}(+{len(added)})")
                print(f"[ok] {name}:取到 {len(rows)} 期,其中新增 {len(added)} 期")
                break
            except (
                OSError,
                http.client.HTTPException,
                TimeoutError,
                ValueError,
            ) as exc:
                last_error = exc
                wait = min(5 * attempt, 20)
                print(
                    f"[warn] {name} 第 {attempt}/{args.attempts} 次失败: {exc} —— {wait}s 后重试",
                    flush=True,
                )
                time.sleep(wait)
        else:
            errors.append(f"{name}: {last_error}")

    if not succeeded:
        print("[error] 所有数据源均失败:")
        for line in errors:
            print("   -", line)
        return 1

    if len(merged) == before:
        print(f"[skip] 无新增期次(仍为 {before} 期),不写入文件")
        return 0

    new_content = build_js(merged)
    old_content = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if new_content == old_content:
        print("[skip] 生成内容与现有文件一致,不写入")
        return 0

    OUT.write_text(new_content, encoding="utf-8")
    print(
        f"[done] 已更新 data.js:{before} 期 -> {len(merged)} 期,最新 {max(merged)} 期 · 来源 {', '.join(succeeded)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
