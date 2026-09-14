#!/usr/bin/env python3
"""从中国福利彩票官网拉取最新双色球开奖数据,重新生成 data.js。

- 仅在内容发生变化时写入文件(内容不变则无 diff,工作流会跳过提交/部署)
- 官方接口不稳定时会重试;重试全部失败则以退出码 1 结束(便于在 Actions 里看到失败)
"""
from __future__ import annotations

import http.client
import json
import pathlib
import sys
import time
import urllib.parse

API = (
    "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
    "?name=ssq&issueCount=500&issueStart=&issueEnd=&dayStart=&dayEnd="
)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Referer": "https://www.cwl.gov.cn/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
ALLOWED_SCHEME = "https"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data.js"
COUNT = 500


def _require_https(url: str) -> str:
    """只允许 https,避免 file:/自定义协议被意外使用。"""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != ALLOWED_SCHEME or not parsed.netloc:
        raise ValueError(f"接口地址必须是 {ALLOWED_SCHEME} 且含主机名: {url!r}")
    return url


def _to_int(value: object, field: str, issue: object) -> int:
    """把接口字段安全地转成 int,失败时给出可读的错误。"""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"期号 {issue} 的字段 {field} 不是整数: {value!r}") from exc


def fetch_draws(timeout: int = 30) -> list[dict]:
    """用 HTTPSConnection 直连官方接口(协议固定为 HTTPS,不接受其它 scheme)。"""
    parsed = urllib.parse.urlparse(_require_https(API))
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    conn = http.client.HTTPSConnection(parsed.netloc, timeout=timeout)
    try:
        conn.request("GET", path, headers=HEADERS)
        resp = conn.getresponse()
        raw = resp.read()
        status = resp.status
    finally:
        conn.close()
    if status != http.client.OK:
        raise ValueError(f"接口返回 HTTP {status}: {raw[:120]!r}")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"接口返回不是合法 JSON: {raw[:120]!r}") from exc
    result = payload.get("result")
    if not result:
        raise ValueError(f"接口未返回 result 字段: {str(payload)[:200]}")
    return result


def fetch_with_retry(attempts: int = 6) -> list[dict]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            draws = fetch_draws()
            print(f"[ok] 第 {attempt} 次请求成功,取得 {len(draws)} 期")
            return draws
        except (OSError, http.client.HTTPException, TimeoutError, ValueError) as exc:
            last_error = exc
            wait_seconds = min(5 * attempt, 30)
            print(f"[warn] 第 {attempt}/{attempts} 次请求失败: {exc} —— {wait_seconds}s 后重试", flush=True)
            time.sleep(wait_seconds)
    raise SystemExit(f"[error] 拉取开奖数据失败(已重试 {attempts} 次): {last_error}")


def build_js(draws: list[dict]) -> str:
    records: list[tuple[int, str, list[int], int]] = []
    for draw in draws:
        issue = draw.get("code", "?")
        try:
            reds = sorted(_to_int(x, "red", issue) for x in str(draw.get("red", "")).split(","))
        except ValueError as exc:
            print(f"[warn] 跳过 {issue}: {exc}")
            continue
        if len(reds) != 6 or len(set(reds)) != 6 or not all(1 <= n <= 33 for n in reds):
            print(f"[warn] 跳过 {issue}: 红球不合法 {reds}")
            continue
        blue = _to_int(draw.get("blue"), "blue", issue)
        if not 1 <= blue <= 16:
            print(f"[warn] 跳过 {issue}: 蓝球不合法 {blue}")
            continue
        records.append((_to_int(issue, "code", issue), str(draw.get("date", ""))[:10], reds, blue))

    if not records:
        raise SystemExit("[error] 解析后没有任何有效数据")

    records.sort(key=lambda r: r[0])
    records = records[-COUNT:]

    lines = []
    for issue, date, reds, blue in records:
        red_text = ", ".join(str(n) for n in reds)
        lines.append(f'  [{issue}, "{date}", [{red_text}], {blue}],')

    latest = records[-1][0]
    header = (
        f"// 双色球历史开奖数据(中国福利彩票官方数据, {len(records)}期, 按期号升序排列)\n"
        f"// 格式: [期号, 日期, 红球数组, 蓝球]\n"
        f"// 数据来源: www.cwl.gov.cn 更新至 {latest} 期 · 由 GitHub Actions 自动更新\n"
    )
    return header + "window.SSQ_DATA = [\n" + "\n".join(lines) + "\n];\n"


def main() -> int:
    draws = fetch_with_retry()
    new_content = build_js(draws)
    old_content = OUT.read_text(encoding="utf-8") if OUT.exists() else ""

    if new_content == old_content:
        print("[skip] 数据无变化,不写入文件")
        return 0

    OUT.write_text(new_content, encoding="utf-8")
    latest = new_content.split("更新至 ", 1)[1].split(" 期", 1)[0]
    print(f"[done] 已更新 data.js —— 最新期号 {latest},记录数 {new_content.count('  [')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
