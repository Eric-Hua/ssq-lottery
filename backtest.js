/* ===================================================================
 * 杀号公式回测 —— 用真实开奖数据检验每条公式,并与随机基线做显著性检验
 *
 * 方法:对每个目标期 t,用「上期(t-1)」的数据算杀号,再看目标期开出的号码里
 *       有没有被误杀。该期「杀对」= 杀掉的号码一个都没开出。
 *
 * 依赖 index.html 里定义的全局:DATA / N / ALL_RED / ALL_BLUE / m33 / m16 /
 *                              el / clearEl / toast / copyText / pad2
 * =================================================================== */
(() => {
  var WARMUP = 50; // 前 50 期只作历史预热,不参评
  var ALPHA = 0.05;
  var MAX_ROWS_FOR_RANDOM = 1500; // 随机公式对照的模拟次数
  var nTests = 33; // 实际检验的公式条数(去并集),用于 Bonferroni 校正

  var ALL_R = ALL_RED.slice();
  var ALL_B = ALL_BLUE.slice();

  /* ---------------- 数学工具 ---------------- */
  var C = {};
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    var key = n + "_" + k;
    if (C[key] !== undefined) return C[key];
    var kk = Math.min(k, n - k);
    var r = 1;
    for (var i = 0; i < kk; i++) r = (r * (n - i)) / (i + 1);
    C[key] = Math.round(r);
    return C[key];
  }
  var TOTAL_RED = comb(33, 6);

  function baseRed(k) {
    if (k <= 0) return 1;
    if (k > 27) return 0;
    return comb(33 - k, 6) / TOTAL_RED;
  }
  function baseBlue(k) {
    if (k <= 0) return 1;
    return Math.max(0, (16 - k) / 16);
  }

  // 精确二项检验(双侧,方法同 Python 版:累加概率不大于观测值的所有结果)
  var LOGFACT = (() => {
    var a = [0];
    for (var i = 1; i <= N + 2; i++) a[i] = a[i - 1] + Math.log(i);
    return a;
  })();
  function logComb(n, k) {
    return LOGFACT[n] - LOGFACT[k] - LOGFACT[n - k];
  }
  function binomTwoSided(k, n, p) {
    if (!n) return 1;
    if (p <= 0) return k === 0 ? 1 : 0;
    if (p >= 1) return k === n ? 1 : 0;
    var lp = (i) => logComb(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p);
    var obs = lp(k);
    var sum = 0;
    for (var i = 0; i <= n; i++) {
      var v = lp(i);
      if (v <= obs + 1e-12) sum += Math.exp(v);
    }
    return Math.min(1, sum);
  }
  function wilson(k, n) {
    if (!n) return [0, 0];
    var z = 1.96,
      p = k / n;
    var d = 1 + (z * z) / n;
    var c = (p + (z * z) / (2 * n)) / d;
    var h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  /* ---------------- 数据与状态 ---------------- */
  var DRAWS = DATA.map((d) => ({ issue: d[0], red: d[2], blue: d[3] }));
  var prevOf = (t) => DRAWS[t - 1];

  // 前缀计数:prefRed[n][k] = 号码 n 在 draws[0..k-1] 中出现次数
  var prefRed = [],
    prefBlue = [];
  (() => {
    var n, k, d;
    for (n = 1; n <= 33; n++) prefRed[n] = new Int32Array(N + 1);
    for (n = 1; n <= 16; n++) prefBlue[n] = new Int32Array(N + 1);
    for (k = 1; k <= N; k++) {
      d = DRAWS[k - 1];
      for (n = 1; n <= 33; n++) prefRed[n][k] = prefRed[n][k - 1];
      for (var i = 0; i < d.red.length; i++) prefRed[d.red[i]][k]++;
      for (n = 1; n <= 16; n++) prefBlue[n][k] = prefBlue[n][k - 1];
      prefBlue[d.blue][k]++;
    }
  })();

  // 每个目标期的「上期状态」:遗漏
  var missRedAt = [],
    missBlueAt = [];
  (() => {
    var lastR = [],
      lastB = [],
      n;
    for (n = 0; n <= 33; n++) lastR[n] = -1;
    for (n = 0; n <= 16; n++) lastB[n] = -1;
    for (var t = 0; t <= N; t++) {
      if (t > 0) {
        var d = DRAWS[t - 1];
        for (var i = 0; i < d.red.length; i++) lastR[d.red[i]] = t - 1;
        lastB[d.blue] = t - 1;
      }
      var mr = {},
        mb = {};
      for (n = 1; n <= 33; n++) mr[n] = lastR[n] < 0 ? t : t - 1 - lastR[n];
      for (n = 1; n <= 16; n++) mb[n] = lastB[n] < 0 ? t : t - 1 - lastB[n];
      missRedAt[t] = mr;
      missBlueAt[t] = mb;
    }
  })();

  function freqRedBefore(t, w, n) {
    var f = t - w;
    return prefRed[n][t] - (f > 0 ? prefRed[n][f] : 0);
  }
  function freqBlueBefore(t, w, n) {
    var f = t - w;
    return prefBlue[n][t] - (f > 0 ? prefBlue[n][f] : 0);
  }

  function consecRuns(reds) {
    var runs = [],
      cur = [];
    for (var i = 0; i < reds.length; i++) {
      if (!cur.length) {
        cur = [reds[i]];
      } else if (reds[i] === cur[cur.length - 1] + 1) {
        cur.push(reds[i]);
      } else {
        if (cur.length >= 2) runs.push(cur.slice());
        cur = [reds[i]];
      }
    }
    if (cur.length >= 2) runs.push(cur.slice());
    return runs;
  }

  /* ---------------- 号码小工具(用户公式用) ---------------- */
  function digitSum(v) {
    var s = String(Math.abs(Math.trunc(v))),
      out = 0;
    for (var i = 0; i < s.length; i++) out += Number(s[i]);
    return out;
  }
  function lastDigit(v) {
    return Math.abs(Math.trunc(v)) % 10;
  }
  function toBlueUnit(v) {
    var d = lastDigit(v);
    return d === 0 ? 10 : d;
  }
  function tailBlues(digit) {
    return ALL_B.filter((n) => n % 10 === digit);
  }
  function mirrorSorted(t) {
    return prevOf(t)
      .red.map((n) => 34 - n)
      .sort((a, b) => a - b);
  }

  /* ---------------- 公式定义 ----------------
   * ctx: { t, prev, prev2, prev3, missR, missB }
   * kill(ctx) 返回要杀的号码数组
   */
  function mkSite() {
    var F = [];
    function add(kind, name, desc, def, kill) {
      F.push({
        src: "本站",
        kind: kind,
        name: name,
        desc: desc,
        def: def,
        kill: kill,
      });
    }

    add("red", "红球和值杀号", "上期红球和值 mod 33", true, (c) => [
      m33(c.prev.red.reduce((a, b) => a + b, 0)),
    ]);
    add("red", "首尾和值杀号", "上期首红+尾红 mod 33", true, (c) => [
      m33(c.prev.red[0] + c.prev.red[5]),
    ]);
    add("red", "跨度杀号", "上期跨度 mod 33", true, (c) => [
      m33(c.prev.red[5] - c.prev.red[0]),
    ]);
    add("red", "奇偶和差杀号", "上期(奇数和−偶数和) mod 33", true, (c) => {
      var odd = 0,
        even = 0;
      c.prev.red.forEach((n) => {
        if (n % 2) odd += n;
        else even += n;
      });
      return [m33(Math.abs(odd - even))];
    });
    add("red", "隔位和差杀号", "上期隔位和差 mod 33", true, (c) => {
      var r = c.prev.red;
      return [m33(Math.abs(r[0] + r[2] + r[4] - (r[1] + r[3] + r[5])))];
    });
    add("red", "蓝球+5杀红", "上期蓝球+5 mod 33", true, (c) => [
      m33(c.prev.blue + 5),
    ]);
    add("red", "蓝球×2杀红", "上期蓝球×2 mod 33", true, (c) => [
      m33(c.prev.blue * 2),
    ]);
    add("red", "上期蓝球作红杀", "杀上期蓝球那个号", true, (c) => [
      c.prev.blue,
    ]);
    add("red", "连号端点杀号", "上期连号区间的首尾号", true, (c) => {
      var out = [];
      consecRuns(c.prev.red).forEach((run) => {
        out.push(run[0], run[run.length - 1]);
      });
      return out;
    });
    add("red", "超冷号杀号", "遗漏≥25期的红球", true, (c) =>
      ALL_R.filter((n) => c.missR[n] >= 25),
    );
    add("red", "过热号杀号", "近5期出现≥3次的红球", true, (c) =>
      ALL_R.filter((n) => freqRedBefore(c.t, 5, n) >= 3),
    );
    add(
      "red",
      "同尾号杀号(激进)",
      "上期出现过的尾数 → 全部同尾号",
      false,
      (c) => {
        var tails = {};
        c.prev.red.forEach((n) => {
          tails[n % 10] = true;
        });
        return ALL_R.filter((n) => tails[n % 10]);
      },
    );

    add("blue", "上期蓝球重杀", "杀上期蓝球", true, (c) => [c.prev.blue]);
    add("blue", "蓝球+1杀号", "上期蓝球+1 mod 16", true, (c) => [
      m16(c.prev.blue + 1),
    ]);
    add("blue", "蓝球-1杀号", "上期蓝球−1 mod 16", true, (c) => [
      m16(c.prev.blue - 1),
    ]);
    add("blue", "红球和值尾杀蓝", "蓝球个位 = 上期红球和值个位", true, (c) => {
      var tail = c.prev.red.reduce((a, b) => a + b, 0) % 10;
      return ALL_B.filter((n) => n % 10 === tail);
    });
    add("blue", "红球跨度杀蓝", "上期红球跨度 mod 16", true, (c) => [
      m16(c.prev.red[5] - c.prev.red[0]),
    ]);
    add("blue", "冷蓝球杀号", "遗漏≥20期的蓝球", true, (c) =>
      ALL_B.filter((n) => c.missB[n] >= 20),
    );
    add("blue", "热蓝球杀号(激进)", "近8期出现≥4次的蓝球", false, (c) =>
      ALL_B.filter((n) => freqBlueBefore(c.t, 8, n) >= 4),
    );
    return F;
  }

  function mkUser() {
    var F = [];
    function add(kind, name, desc, kill) {
      F.push({
        src: "你提供",
        kind: kind,
        name: name,
        desc: desc,
        def: true,
        kill: kill,
      });
    }

    // —— 蓝球 5 大公式(⑤ 拆成三式)
    add("blue", "①A+B 绝杀法", "上上期蓝+上期蓝,取个位(0→10)", (c) => [
      toBlueUnit(c.prev2.blue + c.prev.blue),
    ]);
    add("blue", "②A+16 绝杀法", "上期蓝+16,取个位(0→10)", (c) => [
      toBlueUnit(c.prev.blue + 16),
    ]);
    add("blue", "③A+B+C 绝杀法", "上3期蓝球之和,取个位(0→10)", (c) => [
      toBlueUnit(c.prev3.blue + c.prev2.blue + c.prev.blue),
    ]);
    add("blue", "④红球+蓝球绝杀法", "上期红球和+上期蓝,取个位(0→10)", (c) => [
      toBlueUnit(c.prev.red.reduce((a, b) => a + b, 0) + c.prev.blue),
    ]);
    add("blue", "⑤-15 减蓝球杀尾", "15−上期蓝 → 杀该尾数", (c) =>
      tailBlues(lastDigit(15 - c.prev.blue)),
    );
    add("blue", "⑤-19 减蓝球杀尾", "19−上期蓝 → 杀该尾数", (c) =>
      tailBlues(lastDigit(19 - c.prev.blue)),
    );
    add("blue", "⑤-21 减蓝球杀尾", "21−上期蓝 → 杀该尾数", (c) =>
      tailBlues(lastDigit(21 - c.prev.blue)),
    );

    // —— 红球 6 大策略(⑥ 拆成两式)
    add("red", "①号码拆分相加杀号", "上期每个红球各自拆位相加", (c) =>
      c.prev.red.map(digitSum),
    );
    add("red", "②近期高频号杀号", "近5期出现≥3次(与本站「过热号」同式)", (c) =>
      ALL_R.filter((n) => freqRedBefore(c.t, 5, n) >= 3),
    );
    add("red", "③最值号码杀号", "上期最大号 + 最小号", (c) => [
      c.prev.red[0],
      c.prev.red[5],
    ]);
    add("red", "④红蓝差值杀号", "上期最大红球 − 上期蓝球", (c) => {
      var v = c.prev.red[5] - c.prev.blue;
      return v >= 1 && v <= 33 ? [v] : [];
    });
    add("red", "⑤和值拆分杀号", "上期红球和值拆位相加", (c) => [
      digitSum(c.prev.red.reduce((a, b) => a + b, 0)),
    ]);
    add(
      "red",
      "⑥-1 对称码第3位+7",
      "对称码(红球关于17镜像 34−n)升序第3位 + 7",
      (c) => {
        var m = mirrorSorted(c.t);
        return [m[2] + 7];
      },
    );
    add(
      "red",
      "⑥-2 对称码第1位×0.88",
      "对称码升序第1位 × 0.88(向下取整)",
      (c) => {
        var m = mirrorSorted(c.t);
        return [Math.trunc(m[0] * 0.88)];
      },
    );
    return F;
  }

  /* ---------------- 回测核心 ---------------- */
  function tally(formulas, kind) {
    var acc = { n: 0, hit: 0, kill: 0, wrong: 0, base: 0, bad: 0, maxbad: 0 };
    var t, i, c, killed, seen, actual, wrong, b;
    for (t = WARMUP + 1; t < N; t++) {
      c = {
        t: t,
        prev: DRAWS[t - 1],
        prev2: DRAWS[t - 2],
        prev3: DRAWS[t - 3],
        missR: missRedAt[t],
        missB: missBlueAt[t],
      };
      killed = [];
      seen = {};
      for (i = 0; i < formulas.length; i++) {
        var arr = formulas[i].kill(c) || [];
        for (var j = 0; j < arr.length; j++) {
          var n = arr[j];
          if (kind === "red") {
            if (n >= 1 && n <= 33 && !seen[n]) {
              seen[n] = true;
              killed.push(n);
            }
          } else if (n >= 1 && n <= 16 && !seen[n]) {
            seen[n] = true;
            killed.push(n);
          }
        }
      }
      if (!killed.length) continue;
      actual = kind === "red" ? c.prev.red : null; // 占位,下面覆盖
      actual = kind === "red" ? DRAWS[t].red : [DRAWS[t].blue];
      wrong = 0;
      for (i = 0; i < killed.length; i++) {
        if (actual.indexOf(killed[i]) !== -1) wrong++;
      }
      b = kind === "red" ? baseRed(killed.length) : baseBlue(killed.length);
      acc.n++;
      acc.kill += killed.length;
      acc.base += b;
      acc.wrong += wrong;
      if (wrong === 0) {
        acc.hit++;
        acc.bad = 0;
      } else {
        acc.bad++;
        if (acc.bad > acc.maxbad) acc.maxbad = acc.bad;
      }
    }
    return acc;
  }

  function verdict(n, acc, base, p) {
    if (n < 30) return { text: "样本不足", cls: "vt-warn" };
    if (p < ALPHA / nTests) {
      if (acc > base) return { text: "显著优于随机", cls: "vt-good" };
      return { text: "显著差于随机", cls: "vt-bad" };
    }
    if (p < ALPHA) {
      if (acc > base) return { text: "略优(未过校正)", cls: "vt-warn-good" };
      return { text: "略差(未过校正)", cls: "vt-warn-bad" };
    }
    return { text: "与随机无异", cls: "vt-neutral" };
  }

  function makeRow(formulas, kind, label, desc, src) {
    var acc = tally(formulas, kind);
    var n = acc.n || 1;
    var a = acc.hit / n,
      b = acc.base / n;
    var p = acc.n ? binomTwoSided(acc.hit, acc.n, b) : 1;
    var ci = wilson(acc.hit, acc.n);
    var v = verdict(acc.n, a, b, p);
    return {
      name: label,
      desc: desc,
      src: src,
      kind: kind,
      n: acc.n,
      avgKill: acc.kill / n,
      hit: acc.hit,
      acc: a,
      base: b,
      p: p,
      ci: ci,
      avgWrong: acc.wrong / n,
      maxbad: acc.maxbad,
      verdict: v,
    };
  }

  function runAll() {
    var site = mkSite(),
      user = mkUser();
    nTests = site.length + user.length; // 单公式条数(不含并集)
    var siteRed = site.filter((f) => f.kind === "red");
    var siteBlue = site.filter((f) => f.kind === "blue");
    var userRed = user.filter((f) => f.kind === "red");
    var userBlue = user.filter((f) => f.kind === "blue");

    var rows = { red: [], blue: [] };
    var i;
    for (i = 0; i < siteRed.length; i++)
      rows.red.push(
        makeRow(
          [siteRed[i]],
          "red",
          siteRed[i].name,
          siteRed[i].desc,
          "本站" + (siteRed[i].def ? "" : "·默认关"),
        ),
      );
    rows.red.push(
      makeRow(
        siteRed.filter((f) => f.def),
        "red",
        "【本站默认 11 公式并集】",
        "页面默认勾选的范围",
        "本站",
      ),
    );
    for (i = 0; i < userRed.length; i++)
      rows.red.push(
        makeRow(
          [userRed[i]],
          "red",
          userRed[i].name,
          userRed[i].desc,
          "你提供",
        ),
      );
    rows.red.push(
      makeRow(
        userRed,
        "red",
        "【你提供的 7 式全部并用】",
        "上表 7 条红球公式的并集",
        "你提供",
      ),
    );

    for (i = 0; i < siteBlue.length; i++)
      rows.blue.push(
        makeRow(
          [siteBlue[i]],
          "blue",
          siteBlue[i].name,
          siteBlue[i].desc,
          "本站" + (siteBlue[i].def ? "" : "·默认关"),
        ),
      );
    rows.blue.push(
      makeRow(
        siteBlue.filter((f) => f.def),
        "blue",
        "【本站默认 6 公式并集】",
        "页面默认勾选的范围",
        "本站",
      ),
    );
    for (i = 0; i < userBlue.length; i++)
      rows.blue.push(
        makeRow(
          [userBlue[i]],
          "blue",
          userBlue[i].name,
          userBlue[i].desc,
          "你提供",
        ),
      );
    rows.blue.push(
      makeRow(
        userBlue,
        "blue",
        "【你提供的 7 式全部并用】",
        "上表 7 条蓝球公式的并集",
        "你提供",
      ),
    );

    return rows;
  }

  /* ---------------- 随机公式对照(蒙特卡洛) ---------------- */
  function randomPanel(kind) {
    var accs = [],
      i,
      t,
      c,
      killed,
      actual,
      v,
      hit,
      n;
    var vals = () => Math.floor(Math.random() * 19) - 9;
    for (i = 0; i < MAX_ROWS_FOR_RANDOM; i++) {
      var a = vals(),
        b = vals(),
        cc = vals(),
        d = vals(),
        e = vals(),
        f = vals();
      hit = 0;
      n = 0;
      for (t = WARMUP + 1; t < N; t++) {
        c = DRAWS[t - 1];
        if (kind === "red") {
          var sum = 0;
          for (var k = 0; k < c.red.length; k++) sum += c.red[k];
          v =
            a * sum +
            b * (c.red[5] - c.red[0]) +
            cc * c.red[0] +
            d * c.red[5] +
            e * c.blue +
            f;
          killed = [(((v % 33) + 33) % 33) + 1];
          actual = DRAWS[t].red;
        } else {
          var s2 = 0;
          for (var k2 = 0; k2 < c.red.length; k2++) s2 += c.red[k2];
          v = a * s2 + b * (c.red[5] - c.red[0]) + cc * c.blue + d;
          killed = [(((v % 16) + 16) % 16) + 1];
          actual = [DRAWS[t].blue];
        }
        n++;
        if (actual.indexOf(killed[0]) === -1) hit++;
      }
      if (n) accs.push(hit / n);
    }
    accs.sort((x, y) => x - y);
    return {
      n: accs.length,
      median: accs[Math.floor(accs.length * 0.5)],
      p90: accs[Math.floor(accs.length * 0.9)],
      p95: accs[Math.floor(accs.length * 0.95)],
      max: accs[accs.length - 1],
      samples: accs,
    };
  }

  /* ---------------- 渲染 ---------------- */
  function pct(x) {
    return (x * 100).toFixed(1) + "%";
  }
  function pp(x) {
    var v = x * 100;
    return (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";
  }
  function pf(p) {
    return p < 0.001 ? "<0.001" : p.toFixed(3);
  }

  function barCell(text, ratio, color) {
    var wrap = el("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "center";
    wrap.style.gap = "3px";
    var t = el("span", null, text);
    t.style.fontWeight = "700";
    var track = el("span");
    track.style.display = "block";
    track.style.width = "64px";
    track.style.height = "6px";
    track.style.borderRadius = "3px";
    track.style.background = "rgba(255,255,255,.08)";
    var fill = el("span");
    fill.style.display = "block";
    fill.style.height = "6px";
    fill.style.borderRadius = "3px";
    fill.style.width = Math.max(2, Math.round(Math.min(1, ratio) * 64)) + "px";
    fill.style.background = color;
    track.appendChild(fill);
    wrap.appendChild(t);
    wrap.appendChild(track);
    return wrap;
  }

  var HEADERS = [
    "公式",
    "来源",
    "参评期数",
    "平均杀号",
    "全杀对期数",
    "准确率",
    "随机基线",
    "实测−基线",
    "P 值",
    "结论",
  ];

  function renderTable(tableEl, rows) {
    clearEl(tableEl);
    var thead = el("thead"),
      tr = el("tr"),
      i;
    for (i = 0; i < HEADERS.length; i++)
      tr.appendChild(el("th", null, HEADERS[i]));
    thead.appendChild(tr);
    tableEl.appendChild(thead);

    var tbody = el("tbody");
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = el("tr");
      var isUnion = r.name.indexOf("并集") !== -1;
      if (isUnion) row.style.background = "rgba(255,255,255,.035)";

      var tdName = el("td");
      tdName.style.textAlign = "left";
      var nm = el("span", null, r.name);
      nm.style.fontWeight = isUnion ? "700" : "600";
      tdName.appendChild(nm);
      row.appendChild(tdName);

      row.appendChild(el("td", null, r.src));
      row.appendChild(el("td", null, String(r.n)));
      row.appendChild(el("td", null, r.avgKill.toFixed(2)));
      row.appendChild(el("td", null, String(r.hit)));

      var tdAcc = el("td");
      var accColor = r.acc >= r.base ? "var(--green)" : "var(--red)";
      tdAcc.appendChild(barCell(pct(r.acc), r.acc, accColor));
      row.appendChild(tdAcc);

      var tdBase = el("td");
      tdBase.appendChild(barCell(pct(r.base), r.base, "rgba(152,162,201,.75)"));
      row.appendChild(tdBase);

      var tdDiff = el("td", null, pp(r.acc - r.base));
      tdDiff.style.color = r.acc >= r.base ? "var(--green)" : "var(--red)";
      row.appendChild(tdDiff);

      row.appendChild(el("td", null, pf(r.p)));

      var tdV = el("td");
      tdV.appendChild(el("span", "vtag " + r.verdict.cls, r.verdict.text));
      row.appendChild(tdV);

      if (r.desc) {
        var tr2 = el("tr");
        var tdd = el("td");
        tdd.colSpan = HEADERS.length;
        tdd.style.textAlign = "left";
        tdd.style.color = "var(--muted)";
        tdd.style.fontSize = "11.5px";
        tdd.style.paddingTop = "0";
        tdd.textContent = "↳ " + r.desc;
        tr2.appendChild(tdd);
        tbody.appendChild(row);
        tbody.appendChild(tr2);
      } else {
        tbody.appendChild(row);
      }
    }
    tableEl.appendChild(tbody);
  }

  function renderSummary(rows) {
    var box = clearEl($("#btSummary"));
    var from = DATA[WARMUP + 1][0],
      to = DATA[N - 1][0];
    var tested = N - WARMUP - 1;
    var nSig = 0;
    rows.red.concat(rows.blue).forEach((r) => {
      if (r.verdict.cls === "vt-good" || r.verdict.cls === "vt-bad") nSig++;
    });

    var line1 = el("div", "rec-meta");
    line1.textContent =
      "回测区间:第 " +
      from +
      " ~ " +
      to +
      " 期,共 " +
      tested +
      " 期(前 " +
      WARMUP +
      " 期作历史预热);共检验 " +
      nTests +
      " 条公式(另附 " +
      (rows.red.length + rows.blue.length - nTests) +
      " 行并集,不计入校正)。";
    box.appendChild(line1);

    var line2 = el("div");
    line2.style.marginTop = "10px";
    line2.appendChild(el("span", "vtag vt-warn", "⚠️ 读表前必看"));
    var warn = el("div", "model-note");
    warn.style.borderTop = "none";
    warn.style.marginTop = "8px";
    warn.style.paddingTop = "0";
    warn.textContent =
      "杀「1 个」号码的天然准确率:红球 81.8%、蓝球 93.8%(闭眼乱杀也是这个数)。所以要同时看「平均杀号个数」和「随机基线」——只看准确率没有意义。杀号越多,越容易踩中,准确率必然下降。";
    line2.appendChild(warn);
    box.appendChild(line2);

    var line3 = el("div");
    line3.style.marginTop = "10px";
    var thr = (ALPHA / nTests).toFixed(4);
    var passTxt =
      nSig === 0
        ? "本页所有公式都没有通过多重比较校正(Bonferroni 阈值 = " +
          thr +
          "):没有任何一条能证明优于随机。"
        : "有 " + nSig + " 项通过了 Bonferroni 校正(阈值 " + thr + ")。";
    line3.appendChild(
      el(
        "span",
        "vtag " + (nSig === 0 ? "vt-neutral" : "vt-good"),
        nSig === 0 ? "结论:全部与随机无异" : "结论:有显著项",
      ),
    );
    var s3 = el("div", "model-note");
    s3.style.borderTop = "none";
    s3.style.marginTop = "8px";
    s3.style.paddingTop = "0";
    s3.textContent =
      passTxt +
      " P 值来自精确二项检验(双侧),用每期实际的杀号个数对应的随机基线做零假设。";
    line3.appendChild(s3);
    box.appendChild(line3);

    var rp = $("#btRandomPanel");
    if (!rp) return;
    clearEl(rp);
    var load = el("div", "rec-meta", "随机公式对照:计算中…");
    rp.appendChild(load);
    window.setTimeout(() => {
      var red = randomPanel("red"),
        blue = randomPanel("blue");
      clearEl(rp);
      rp.appendChild(
        el(
          "div",
          "rec-meta",
          "随机公式对照 —— 随机生成 " +
            red.n +
            " 个「每次都只杀 1 个号」的无意义公式(形如 (a×和值+b×跨度+c×首+d×尾+e×蓝+f) mod 33 + 1,系数随机),它们的准确率分布:",
        ),
      );
      var t = el("table", "hist");
      var th = el("thead"),
        htr = el("tr");
      ["项目", "红球(基线 81.8%)", "蓝球(基线 93.8%)"].forEach((x) => {
        htr.appendChild(el("th", null, x));
      });
      th.appendChild(htr);
      t.appendChild(th);
      var tb = el("tbody");
      [
        ["中位数", red.median, blue.median],
        ["90 分位", red.p90, blue.p90],
        ["95 分位", red.p95, blue.p95],
        ["最大值", red.max, blue.max],
      ].forEach((line) => {
        var tr = el("tr");
        tr.appendChild(el("td", null, line[0]));
        tr.appendChild(el("td", null, pct(line[1])));
        tr.appendChild(el("td", null, pct(line[2])));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      rp.appendChild(t);
      var note = el("div", "model-note");
      note.textContent =
        "含义:一堆完全随机的公式里,最高的一条也能达到 " +
        pct(red.max) +
        "(红)/" +
        pct(blue.max) +
        "(蓝)。所以「某公式准确率 85%」这种说法本身不构成任何证据 —— 它可能只是噪声里的幸运儿。";
      rp.appendChild(note);
    }, 30);
  }

  function toMarkdown(rows) {
    var out = [
      "| 公式 | 来源 | 参评期数 | 平均杀号个数 | 全部杀对期数 | 准确率 | 随机基线 | 实测−基线 | P 值 | 结论 |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ];
    rows.forEach((r) => {
      out.push(
        "| " +
          r.name +
          " | " +
          r.src +
          " | " +
          r.n +
          " | " +
          r.avgKill.toFixed(2) +
          " | " +
          r.hit +
          " | " +
          pct(r.acc) +
          " | " +
          pct(r.base) +
          " | " +
          pp(r.acc - r.base) +
          " | " +
          pf(r.p) +
          " | " +
          r.verdict.text +
          " |",
      );
    });
    return out.join("\n");
  }

  var cache = null;

  window.renderBacktest = () => {
    if (!cache) cache = runAll();
    if ($("#btRedTable").getAttribute("data-done") === "1") return;
    renderTable($("#btRedTable"), cache.red);
    renderTable($("#btBlueTable"), cache.blue);
    $("#btRedTable").setAttribute("data-done", "1");
    $("#btBlueTable").setAttribute("data-done", "1");
    renderSummary(cache);
  };

  // 复制按钮
  document.addEventListener("DOMContentLoaded", () => {});
  window.setTimeout(() => {
    var btn = $("#btCopyBtn");
    if (btn) {
      btn.onclick = () => {
        if (!cache) cache = runAll();
        copyText(toMarkdown(cache.red) + "\n\n" + toMarkdown(cache.blue));
      };
    }
  }, 0);
})();
