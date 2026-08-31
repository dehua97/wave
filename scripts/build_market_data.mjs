#!/usr/bin/env node
/**
 * 行情数据构建脚本（Node 20，纯标准库 + 内置 fetch）
 *
 * 流程：
 *   1. 按品种的数据源链抓取日K（新浪国际期货 / 同花顺 / 东方财富 / Yahoo Finance 按序 fallback，
 *      每源重试 2 次；截取最近约 10 年并做有效性校验；全链失败时复用现有 JSON 的 OHLC 兜底）；
 *   2. 计算自适应阈值的 ZigZag 摆动点；
 *   3. 在摆动点序列上滑窗匹配艾略特 5 浪驱动结构并打分；
 *   4. 因果回测「浪3/浪5 双入场、只做多」：入场只用已确认摆动点的信息，
 *      大级别摆动点做顺势过滤并提供初始止损位（含保本移动），生成交易明细与复利净值曲线；
 *   5. 合并手工策展的 scripts/news.seed.json（可缺失），原子写入 public/market_data.json。
 *
 * 运行：node scripts/build_market_data.mjs
 * 离线模式：node scripts/build_market_data.mjs --offline
 *   不访问网络，读取现有 public/market_data.json 中各品种的 key/name/group/unit/source/ohlc，
 *   用同一套逻辑重算 pivots/waves/trades/equity/events（news/calendar 照常合并 seed），原子写回。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'public', 'market_data.json');
const SEED_FILE = path.join(__dirname, 'news.seed.json');

/**
 * 品种表：key / 中文名 / 分组 / 单位 / 数据源链（按序 fallback）。
 * sources 每项：{ src: 'sina'|'ths'|'em'|'yahoo', code, fqt?, name?, unit? }，
 * name/unit 可覆盖默认值（如 Yahoo 侧创业板只能用 ETF 替代代码时如实标注）。
 */
const INSTRUMENTS = [
  { key: 'gold',    name: '黄金 XAU/USD', group: 'commodity', unit: '美元/盎司', sources: [
    { src: 'sina', code: 'GC' }, { src: 'yahoo', code: 'XAUUSD=X' }, { src: 'yahoo', code: 'GC=F' } ] },
  { key: 'au9999',  name: '黄金 Au9999',  group: 'commodity', unit: '元/克',     sources: [
    { src: 'em', code: '118.AU9999' } ] }, // 上金所现货，仅东方财富一个源
  { key: 'silver',  name: '白银 XAG/USD', group: 'commodity', unit: '美元/盎司', sources: [
    { src: 'sina', code: 'SI' }, { src: 'yahoo', code: 'XAGUSD=X' }, { src: 'yahoo', code: 'SI=F' } ] },
  { key: 'wti',     name: 'WTI 原油',     group: 'commodity', unit: '美元/桶',   sources: [
    { src: 'sina', code: 'CL' }, { src: 'yahoo', code: 'CL=F' } ] },
  { key: 'brent',   name: '布伦特原油',   group: 'commodity', unit: '美元/桶',   sources: [
    { src: 'sina', code: 'OIL' }, { src: 'yahoo', code: 'BZ=F' } ] }, // 新浪布伦特代码实测为 OIL（BZ 数据停留在 2019 年）
  { key: 'copper',  name: '铜',           group: 'commodity', unit: '美分/磅',   sources: [
    { src: 'sina', code: 'HG' }, { src: 'yahoo', code: 'HG=F' } ] },
  { key: 'sse',     name: '上证指数',     group: 'cn_index',  unit: '点',        sources: [
    { src: 'ths', code: 'hs_1A0001' }, { src: 'em', code: '1.000001' }, { src: 'yahoo', code: '000001.SS' } ] },
  { key: 'csi300',  name: '沪深300',      group: 'cn_index',  unit: '点',        sources: [
    { src: 'em', code: '1.000300' }, { src: 'yahoo', code: '000300.SS' } ] }, // 同花顺 hs_000300 返回空，不可用
  { key: 'chinext', name: '创业板指',     group: 'cn_index',  unit: '点',        sources: [
    { src: 'ths', code: 'hs_399006' }, { src: 'em', code: '0.399006' },
    // Yahoo 的 399006.SZ 只返回 1 根K线（2026-08 确认）；真指数不可得时只能回退创业板 ETF，名称/单位如实标注
    { src: 'yahoo', code: '399006.SZ' },
    { src: 'yahoo', code: '159915.SZ', name: '创业板指（ETF 跟踪）', unit: '元' },
    { src: 'yahoo', code: '159948.SZ', name: '创业板指（ETF 跟踪）', unit: '元' } ] },
  { key: 'maotai',  name: '贵州茅台',     group: 'cn_stock',  unit: '元',        sources: [
    // 前复权（THS / 东财 fqt=1）在 10 年窗口内会穿越 0 轴（累计分红已超过当年股价），
    // 比率类算法（ZigZag 阈值、收益百分比）会失真，校验不通过时逐级回退到不复权
    { src: 'ths', code: 'hs_600519' }, { src: 'em', code: '1.600519' },
    { src: 'em', code: '1.600519', fqt: 0 }, { src: 'yahoo', code: '600519.SS' } ] },
  { key: 'catl',    name: '宁德时代',     group: 'cn_stock',  unit: '元',        sources: [
    { src: 'ths', code: 'hs_300750' }, { src: 'em', code: '0.300750' },
    { src: 'em', code: '0.300750', fqt: 0 }, { src: 'yahoo', code: '300750.SZ' } ] },
  { key: 'byd',     name: '比亚迪',       group: 'cn_stock',  unit: '元',        sources: [
    { src: 'ths', code: 'hs_002594' }, { src: 'em', code: '0.002594' },
    { src: 'em', code: '0.002594', fqt: 0 }, { src: 'yahoo', code: '002594.SZ' } ] },
];

const UA = { 'User-Agent': 'Mozilla/5.0' };
const MAX_HOLD_BARS = 60;   // 回测持仓上限（根K线），超出记「超时」
const MAX_WAVES = 20;       // 每品种最多输出的划分数

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------------------
// 抓取
// ---------------------------------------------------------------------------

const RANGES = ['10y', '5y', '3y']; // Yahoo 数据区间：优先 10 年，失败逐级回退

/** 带超时与自定义请求头的 GET，返回文本；非 2xx 抛错 */
async function fetchText(url, headers = UA) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 截取最近约 10 年：以数据自身的最后一个交易日为锚往前推 10 年。
 * THS/东财的历史远超 10 年，必须截断控制文件体积。
 */
function trimTo10Y(bars) {
  const last = bars[bars.length - 1].date;
  const cutoff = String(Number(last.slice(0, 4)) - 10) + last.slice(4);
  return bars.filter((b) => b.date >= cutoff);
}

/** 单根K线有效性：价格为正且 h ≥ l */
function barOK(b) {
  return [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0) && b.h >= b.l;
}

/** 丢弃开头的无效K线：前复权数据在上市初期/窗口早期可能归零或为负（分红累计超过当年股价），这部分不可用于比率类算法 */
function dropLeadingInvalid(bars) {
  let i = 0;
  while (i < bars.length && !barOK(bars[i])) i++;
  return bars.slice(i);
}

/** K线有效性校验：数量足够、日期严格递增、每根有效（前复权穿越 0 轴的品种会在此被拒绝） */
function validBars(bars) {
  if (bars.length < 60) return false;
  let prev = '';
  for (const b of bars) {
    if (!barOK(b)) return false;
    if (b.date <= prev) return false;
    prev = b.date;
  }
  return true;
}

/**
 * 抓取单个 Yahoo 代码的日K，按 RANGES 顺序尝试数据区间（10y → 5y → 3y）。
 * 返回 [{date,o,h,l,c}]（已丢弃含 null 的 bar，日期按交易所本地时区换算）。
 */
async function fetchYahoo(code) {
  let lastErr = null;
  for (const range of RANGES) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?range=${range}&interval=1d`;
    try {
      const json = JSON.parse(await fetchText(url));
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error(json?.chart?.error?.description || 'chart.result 为空');
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      const gmtoffset = result.meta?.gmtoffset ?? 0; // 秒；换算交易所本地日期
      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue; // 丢弃含 null 的 bar
        const date = new Date((ts[i] + gmtoffset) * 1000).toISOString().slice(0, 10);
        bars.push({ date, o: round2(o), h: round2(h), l: round2(l), c: round2(c) });
      }
      return bars;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const THS_HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'http://stockpage.10jqka.com.cn/' };

/**
 * 同花顺 A股日K（http://d.10jqka.com.cn/v6/line/<代码>/01/all.js，必须带 Referer）。
 * JSONP 包裹 quotebridge_v6_line_<代码>_01_all({...})。数据为前复权，编码格式：
 *   - dates：逗号分隔的 MMdd 序列（从 start 年份起，MMdd 回落即年份 +1）；
 *   - price：每根K线 4 个数 [最低, 开盘−最低, 最高−最低, 收盘−最低]，均 ÷ priceFactor。
 * 解析正确性已用东财同日 OHLC 实证（茅台 2026-08-20 四项完全一致，2026-08-21）。
 * 附带用 today.js 快照（字段 11=最新价）与 all.js 末日收盘交叉校验；today.js 为盘中
 * 快照，交易日盘中偏差超过 0.5% 可能来自当日真实波动，故只告警不拒绝。
 */
async function fetchTHS(code) {
  const raw = await fetchText(`http://d.10jqka.com.cn/v6/line/${code}/01/all.js`, THS_HEADERS);
  const lp = raw.indexOf('('), rp = raw.lastIndexOf(')');
  if (lp < 0 || rp < lp) throw new Error('JSONP 剥壳失败');
  const j = JSON.parse(raw.slice(lp + 1, rp));
  const factor = Number(j.priceFactor) || 100;
  const nums = String(j.price).split(',').map(Number);
  const md = String(j.dates).split(',');
  if (nums.length !== md.length * 4) throw new Error(`price/dates 数量不匹配（${nums.length / 4} vs ${md.length}）`);
  let year = Number(String(j.start).slice(0, 4));
  let prev = '';
  const bars = [];
  for (let i = 0; i < md.length; i++) {
    if (md[i] < prev) year++; // MMdd 回落，跨入下一年
    prev = md[i];
    const low = nums[i * 4] / factor;
    bars.push({
      date: `${year}-${md[i].slice(0, 2)}-${md[i].slice(2, 4)}`,
      o: round2(low + nums[i * 4 + 1] / factor),
      h: round2(low + nums[i * 4 + 2] / factor),
      l: round2(low),
      c: round2(low + nums[i * 4 + 3] / factor),
    });
  }
  // today.js 快照交叉校验（最新价字段 "11" 与 all.js 末日收盘对比）
  try {
    const traw = await fetchText(`http://d.10jqka.com.cn/v6/line/${code}/01/today.js`, THS_HEADERS);
    const tj = JSON.parse(traw.slice(traw.indexOf('(') + 1, traw.lastIndexOf(')')));
    const latest = Number(tj?.[code]?.['11']);
    const lastClose = bars[bars.length - 1].c;
    if (Number.isFinite(latest) && lastClose > 0) {
      const dev = Math.abs(latest / lastClose - 1);
      if (dev > 0.005) {
        console.warn(`  [warn] ${code} today.js 最新价与 all.js 末日收盘偏差 ${(dev * 100).toFixed(2)}%（盘中快照可能含当日波动，仅提示）`);
      }
    }
  } catch (err) {
    console.warn(`  [warn] ${code} today.js 交叉校验失败（忽略）：${err.message}`);
  }
  return bars;
}

const EM_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

/**
 * 东方财富日K（push2his.eastmoney.com）。secid：沪市 1.、深市 0.、上金所 118.。
 * fqt：1=前复权（默认）、0=不复权。返回 JSON data.klines[]，每项逗号串，
 * 字段顺序为 date,open,close,high,low（注意 close 在 high/low 之前，勿按常理解析）。
 */
async function fetchEM(secid, fqt = 1) {
  const end = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const beg = String(Number(end.slice(0, 4)) - 10) + end.slice(4); // 最近约 10 年
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=101&fqt=${fqt}&beg=${beg}&end=${end}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55`;
  const j = JSON.parse(await fetchText(url, EM_HEADERS));
  const klines = j?.data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) throw new Error('klines 为空');
  return klines.map((line) => {
    const [date, o, c, h, l] = line.split(',');
    return { date, o: round2(+o), h: round2(+h), l: round2(+l), c: round2(+c) };
  });
}

const SINA_HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn' };

/**
 * 新浪国际期货日K（GlobalFuturesService.getGlobalFuturesDailyKLine，必须带 Referer）。
 * JSONP：前缀可能有注释行，载荷为 x([{date,open,high,low,close,...},...])，取第一个 '['
 * 到最后一个 ']' 之间的 JSON 数组。日期为交易所本地日期字符串，原样使用。
 */
async function fetchSina(code) {
  const raw = await fetchText(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/x/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${encodeURIComponent(code)}`,
    SINA_HEADERS,
  );
  const lb = raw.indexOf('['), rb = raw.lastIndexOf(']');
  if (lb < 0 || rb < lb) throw new Error('JSONP 剥壳失败');
  const arr = JSON.parse(raw.slice(lb, rb + 1));
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('K线数组为空');
  return arr.map((k) => ({
    date: k.date,
    o: round2(+k.open),
    h: round2(+k.high),
    l: round2(+k.low),
    c: round2(+k.close),
  }));
}

/** 数据源标签（写入输出 JSON 的 source 字段，如实记录实际来源） */
function sourceLabel(s) {
  const name = { sina: '新浪财经', ths: '同花顺', em: '东方财富', yahoo: 'Yahoo Finance' }[s.src];
  return `${name} · ${s.code}${s.src === 'em' && s.fqt === 0 ? '（不复权）' : ''}`;
}

/**
 * 按数据源链顺序尝试一个品种，第一个通过校验者胜出；每个源最多重试 2 次。
 * 返回 { bars, meta: { key, name, group, unit, source } }；全链失败返回 null。
 */
async function fetchInstrument(inst) {
  for (const s of inst.sources) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let bars;
        if (s.src === 'sina') bars = await fetchSina(s.code);
        else if (s.src === 'ths') bars = await fetchTHS(s.code);
        else if (s.src === 'em') bars = await fetchEM(s.code, s.fqt ?? 1);
        else bars = await fetchYahoo(s.code);
        bars = dropLeadingInvalid(trimTo10Y(bars));
        if (!validBars(bars)) throw new Error(`K线校验未通过（${bars.length} 根）`);
        return {
          bars,
          meta: { key: inst.key, name: s.name ?? inst.name, group: inst.group, unit: s.unit ?? inst.unit, source: sourceLabel(s) },
        };
      } catch (err) {
        console.warn(`  [warn] ${inst.key} 源 ${sourceLabel(s)} 第 ${attempt} 次抓取失败：${err.message}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ZigZag 摆动点
// ---------------------------------------------------------------------------

/**
 * 自适应阈值 ZigZag。
 * 规则：threshold = clamp(3 × 日收益率标准差, 1.5%, 5%)；可通过 thrOverride 显式指定阈值
 * （回测的大级别摆动点复用本算法，仅阈值不同）。
 * 从第一根K线开始跟踪极值：未定趋势阶段同时记录最低低点/最高高点，
 * 价格（盘中高/低价）自极值反向回撤超过阈值即确认一个摆动点并反转跟踪方向。
 * 末尾追加一个「尚未确认」的临时极值点（confirmIdx = null），供最新形态分析使用。
 * 返回 [{idx, date, price, type: 'H'|'L', confirmIdx}]，confirmIdx 为确认该点的K线序号。
 */
function computeZigZag(bars, thrOverride) {
  const rets = [];
  for (let i = 1; i < bars.length; i++) rets.push(bars[i].c / bars[i - 1].c - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const thr = thrOverride ?? clamp(3 * std, 0.015, 0.05);

  const pivots = [];
  let trend = 0; // 0 未定；1 上行（找高点）；-1 下行（找低点）
  let lowIdx = 0, lowPrice = bars[0].l;
  let highIdx = 0, highPrice = bars[0].h;
  let extremeIdx = 0, extremePrice = bars[0].c;

  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (trend === 0) {
      if (b.l < lowPrice) { lowPrice = b.l; lowIdx = i; }
      if (b.h > highPrice) { highPrice = b.h; highIdx = i; }
      if (b.h >= lowPrice * (1 + thr)) {
        pivots.push({ idx: lowIdx, date: bars[lowIdx].date, price: lowPrice, type: 'L', confirmIdx: i });
        trend = 1; extremeIdx = i; extremePrice = b.h;
      } else if (b.l <= highPrice * (1 - thr)) {
        pivots.push({ idx: highIdx, date: bars[highIdx].date, price: highPrice, type: 'H', confirmIdx: i });
        trend = -1; extremeIdx = i; extremePrice = b.l;
      }
    } else if (trend === 1) {
      if (b.h >= extremePrice) {
        extremePrice = b.h; extremeIdx = i;
      } else if (b.l <= extremePrice * (1 - thr)) {
        pivots.push({ idx: extremeIdx, date: bars[extremeIdx].date, price: extremePrice, type: 'H', confirmIdx: i });
        trend = -1; extremeIdx = i; extremePrice = b.l;
      }
    } else {
      if (b.l <= extremePrice) {
        extremePrice = b.l; extremeIdx = i;
      } else if (b.h >= extremePrice * (1 + thr)) {
        pivots.push({ idx: extremeIdx, date: bars[extremeIdx].date, price: extremePrice, type: 'L', confirmIdx: i });
        trend = 1; extremeIdx = i; extremePrice = b.h;
      }
    }
  }
  // 末尾临时极值点（未确认）
  if (pivots.length > 0 && trend !== 0) {
    const last = pivots[pivots.length - 1];
    const type = trend === 1 ? 'H' : 'L';
    if (extremeIdx !== last.idx) {
      pivots.push({ idx: extremeIdx, date: bars[extremeIdx].date, price: extremePrice, type, confirmIdx: null });
    }
  }
  return { pivots, thr };
}

// ---------------------------------------------------------------------------
// 艾略特波浪划分
// ---------------------------------------------------------------------------

/**
 * 单项斐波那契打分（满分 25）。
 * 在可接受区间 [lo, hi] 内：按与理想值的相对位置线性扣分，区间边缘扣一半（得 12.5）；
 * 超出可接受区间：扣分加重（相对超出幅度 ×2 的速度从 12.5 扣到 0）。
 */
function fibScore(ratio, ideal, lo, hi) {
  if (ratio >= lo && ratio <= hi) {
    const span = ratio < ideal ? ideal - lo : hi - ideal;
    const dev = span > 0 ? Math.abs(ratio - ideal) / span : 0;
    return 25 * (1 - 0.5 * dev);
  }
  const out = ratio < lo ? (lo - ratio) / lo : (ratio - hi) / hi;
  return Math.max(0, 12.5 * (1 - 2 * out));
}

/**
 * 在摆动点序列上滑窗匹配 6 点驱动浪结构（P0..P5）。
 * 向上：L-H-L-H-L-H；向下：H-L-H-L-H-L。
 * 硬规则（不满足直接排除）：
 *   - 浪2 不跌破浪1 起点（向上：P2 > P0；向下：P2 < P0）；
 *   - 浪3 不是 1/3/5 中最短浪；
 *   - 浪4 不进入浪1 价格区间（向上：P4 > P1；向下：P4 < P1）。
 * 斐波那契打分（0-100，四项各 25 分）：
 *   - w2回撤 = |P2-P0|/|P1-P0|，理想 0.618，可接受 0.382-0.886；
 *   - w3/w1  = |P3-P2|/|P1-P0|，理想 1.618，可接受 1.0-3.618；
 *   - w4回撤 = |P4-P3|/|P3-P2|，理想 0.382，可接受 0.146-0.618；
 *   - w5/w1  = |P5-P4|/|P1-P0|，理想 1.0，  可接受 0.382-1.618。
 * （本脚本只识别 5 浪驱动结构，不输出 3 浪调整结构。）
 */
function findWaves(pivots) {
  const candidates = [];
  for (let i = 0; i + 5 < pivots.length; i++) {
    const P = pivots.slice(i, i + 6);
    const types = P.map((p) => p.type).join('');
    let dir = 0;
    if (types === 'LHLHLH') dir = 1;
    else if (types === 'HLHLHL') dir = -1;
    else continue;

    const price = P.map((p) => p.price);
    const d = (a, b) => (price[b] - price[a]) * dir; // 沿方向的有符号幅度
    // 硬规则：浪2 不跌破浪1 起点
    if (!(d(0, 2) > 0)) continue;
    // 硬规则：浪4 不进入浪1 区间
    if (!(d(1, 4) > 0)) continue;
    const w1 = Math.abs(price[1] - price[0]);
    const w3 = Math.abs(price[3] - price[2]);
    const w5 = Math.abs(price[5] - price[4]);
    if (w1 <= 0 || w3 <= 0) continue;
    // 硬规则：浪3 不是最短浪
    if (w3 < w1 && w3 < w5) continue;

    const r2 = Math.abs(price[2] - price[0]) / w1;
    const r3 = w3 / w1;
    const r4 = Math.abs(price[4] - price[3]) / w3;
    const r5 = w5 / w1;
    const score =
      fibScore(r2, 0.618, 0.382, 0.886) +
      fibScore(r3, 1.618, 1.0, 3.618) +
      fibScore(r4, 0.382, 0.146, 0.618) +
      fibScore(r5, 1.0, 0.382, 1.618);

    candidates.push({
      score: round1(score),
      direction: dir === 1 ? 'up' : 'down',
      detail: { 'w2回撤': round3(r2), 'w3/w1': round3(r3), 'w4回撤': round3(r4), 'w5/w1': round3(r5) },
      points: P.map((p) => ({ date: p.date, price: round2(p.price), type: p.type })),
    });
  }

  // 去重：按分数降序，方向相同且 6 个点日期重合 ≥4 个的视为高度重叠，只留最高分
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of candidates) {
    const dates = new Set(c.points.map((p) => p.date));
    const dup = kept.some(
      (k) => k.direction === c.direction && k.points.filter((p) => dates.has(p.date)).length >= 4,
    );
    if (!dup) kept.push(c);
  }
  // 限制数量，但保证至少保留最近一个完整结构（按 P5 日期最大者）
  let latest = null;
  for (const c of candidates) {
    if (!latest || c.points[5].date > latest.points[5].date) latest = c;
  }
  const result = kept.slice(0, MAX_WAVES);
  if (latest && !result.includes(latest)) result.push(latest);
  return result;
}

// ---------------------------------------------------------------------------
// 回测
// ---------------------------------------------------------------------------

/**
 * 浪3/浪5 双入场因果回测（无前视偏差，只做多）。
 *
 * 双级别摆动点：小级别摆动点用于识别浪3/浪5 结构（与图表展示的 pivots 相同）；
 * 大级别摆动点（阈值 = clamp(3 × 小级别阈值, 4%, 12%)，同一 ZigZag 算法）仅用于
 * 回测的顺势过滤与止损定位，不写入输出 JSON。
 *
 * 浪3 候选：滑窗 P0、P1、P2 三个点（仅向上 L-H-L，dir 恒为 1），
 * 入场时刻不使用 P2 之后的任何信息。
 *   入场过滤（仅用 P0-P2）：
 *     - 浪2 不跌破浪1 起点（硬规则：P2 > P0）；
 *     - w2回撤 = |P2-P0|/|P1-P0| 须在 0.236–0.886 之间（过浅过深都放弃）；
 *     - 大级别顺势：入场时刻之前最近一个已确认的大级别摆动点须为低点（趋势向上）。
 *   入场：P2 被确认（出现反向阈值回撤）的次一根K线收盘价。
 *   score：w2回撤质量分（0-100），越接近理想值 0.618 越高，区间边缘降至 50。
 *   目标 = P0 起 1.618 × 浪1 幅度。
 *
 * 浪5 候选：滑窗 P0..P4 五个点（仅向上 L-H-L-H-L），
 * 入场时刻不使用 P4 之后的任何信息。
 *   入场过滤（仅用 P0..P4 可计算的信息）：
 *     - 浪2 不跌破浪1 起点；
 *     - 浪3 不是最短浪（只比较浪1 与浪3，浪5 尚未发生不参与）；
 *     - 浪4 不进入浪1 价格区间（P4 > P1）；
 *     - w4回撤 = |P4-P3|/|P3-P2| 须在 0.146–0.618 之间；
 *     - 大级别顺势过滤（同浪3）。
 *   入场：P4 被确认的次一根K线收盘价。
 *   score：w2回撤质量分（理想 0.618）与 w4回撤质量分（理想 0.382）的平均。
 *   目标 = P0 起 1.618 × 浪1 幅度（与浪3一致）。
 *
 * 止损（两种候选共用）：初始止损 = 入场时刻之前最近一个已确认大级别低点的价格；
 * 若该止损 ≥ 入场价（异常），回退用小级别结构失效位（浪3→P0、浪5→P4）。
 * 保本移动：收盘浮盈 ≥ 1×初始风险（入场价−初始止损价）后，止损上移为 max(当前止损, 入场价)。
 *
 * 出场：收盘价穿越止损记「止损」；收盘触及目标记「达标」；
 * 持仓超 60 根K线（或数据耗尽）按当日收盘出场记「超时」。
 * 互斥与移仓：同一品种同时只持一仓，所有候选按入场时刻排序。
 *   - 持仓为**同一结构**的浪3 仓位时触发该结构浪5 候选：以触发日收盘价平掉浪3 仓位
 *     （reason 记「移仓」，ret 按浪3 入场价计算），同时以同一收盘价开浪5 仓位
 *     （新仓止损按上述大级别失效位规则计算，保本规则同样适用）；
 *   - 持仓为**其他结构**的仓位：跳过新候选（单仓纪律不变）；
 *   - 空仓：正常开仓（浪3 已平仓的同结构浪5 也在此独立触发）。
 * 收益按收盘价百分比计算；trades 按出场日排序，equity 逐笔复利。
 */

/** 回撤质量分（0-100）：越接近理想值越高，落在区间 [lo, hi] 边缘时降至 50 */
function retraceScore(ratio, ideal, lo, hi) {
  const span = ratio < ideal ? ideal - lo : hi - ideal;
  return 100 * (1 - 0.5 * (Math.abs(ratio - ideal) / span));
}

/**
 * 从入场K线序号起模拟做多持仓：返回 { exitIdx, reason }。
 * 保本移动：收盘浮盈 ≥ 1×初始风险（入场价−初始止损价）后，止损上移为 max(当前止损, 入场价)。
 */
function simulate(bars, entryIdx, stop, target) {
  const entry = bars[entryIdx].c;
  const risk = entry - stop; // 初始风险（1R），保本移动触发阈值
  const lastIdx = Math.min(entryIdx + MAX_HOLD_BARS, bars.length - 1);
  for (let j = entryIdx + 1; j <= lastIdx; j++) {
    const c = bars[j].c;
    if (c <= stop) return { exitIdx: j, reason: '止损' };
    if (c >= target) return { exitIdx: j, reason: '达标' };
    // 保本移动：本根收盘判定出场后再生效，下一根起用新止损（无前视）
    if (risk > 0 && c - entry >= risk && stop < entry) stop = entry;
  }
  return { exitIdx: lastIdx, reason: '超时' }; // 超时（含数据耗尽）
}

function backtest(pivots, majorPivots, bars) {
  // 已确认的大级别摆动点（按时间序），用于顺势过滤与初始止损定位
  const majorConfirmed = majorPivots.filter((p) => p.confirmIdx != null);
  // 入场时刻之前（确认K线序号严格小于 entryIdx）最近一个已确认大级别摆动点；type 限定 'L'/'H'
  const lastMajorBefore = (entryIdx, type) => {
    for (let k = majorConfirmed.length - 1; k >= 0; k--) {
      const p = majorConfirmed[k];
      if (p.confirmIdx < entryIdx && (!type || p.type === type)) return p;
    }
    return null;
  };
  // 初始止损：最近一个已确认大级别低点；若 ≥ 入场价（异常）则回退小级别结构失效位 structStop
  const initialStop = (entryIdx, structStop) => {
    const entry = bars[entryIdx].c;
    const low = lastMajorBefore(entryIdx, 'L');
    if (low && low.price < entry) return low.price;
    return structStop;
  };

  // 先生成全部候选（浪3 + 浪5），再按入场时刻排序统一走互斥撮合
  const candidates = [];
  for (let i = 0; i + 2 < pivots.length; i++) {
    const P = pivots.slice(i, i + 5); // 浪3 只用前 3 点，浪5 用前 5 点
    const t3 = P[0].type + P[1].type + P[2].type;
    if (t3 !== 'LHL') continue; // 只做多：仅向上结构（三点不交替则该窗口两种候选都不成立）
    const dir = 1;
    const price = P.map((p) => p.price);
    const d = (a, b) => price[b] - price[a]; // 向上的有符号幅度
    if (!(d(0, 2) > 0)) continue; // 浪2 跌破浪1 起点：两种候选都不成立
    const w1 = Math.abs(price[1] - price[0]);
    if (w1 <= 0) continue;
    const r2 = Math.abs(price[2] - price[0]) / w1;
    const target = price[0] + dir * 1.618 * w1;

    // 浪3 候选
    if (r2 >= 0.236 && r2 <= 0.886 && P[2].confirmIdx != null && P[2].confirmIdx + 1 < bars.length) {
      const entryIdx = P[2].confirmIdx + 1;
      const trend = lastMajorBefore(entryIdx); // 大级别趋势 = 最近已确认大级别摆动点类型
      if (trend && trend.type === 'L') {
        // 仅趋势向上（最近已确认大级别点为低点）时允许入场
        candidates.push({
          sid: i, // 结构标识：同一滑窗的浪3/浪5 候选属于同一结构（移仓判定用）
          entryIdx,
          wave: '浪3',
          dir,
          score: round1(retraceScore(r2, 0.618, 0.236, 0.886)),
          stop: initialStop(entryIdx, price[0]), // 回退：浪3 结构失效位 = P0
          target,
        });
      }
    }

    // 浪5 候选（需要 P3、P4 存在）
    if (P.length < 5) continue;
    const w3 = Math.abs(price[3] - price[2]);
    if (w3 <= 0 || w3 < w1) continue; // 浪3 不能短于浪1（浪5 未知不参与比较）
    if (!(d(1, 4) > 0)) continue; // 浪4 进入浪1 价格区间
    const r4 = Math.abs(price[4] - price[3]) / w3;
    if (r4 < 0.146 || r4 > 0.618) continue; // w4回撤超出可接受区间
    if (P[4].confirmIdx == null || P[4].confirmIdx + 1 >= bars.length) continue;
    const entryIdx = P[4].confirmIdx + 1;
    const trend = lastMajorBefore(entryIdx);
    if (!trend || trend.type !== 'L') continue; // 大级别顺势过滤（同浪3）
    candidates.push({
      sid: i,
      entryIdx,
      wave: '浪5',
      dir,
      score: round1((retraceScore(r2, 0.618, 0.236, 0.886) + retraceScore(r4, 0.382, 0.146, 0.618)) / 2),
      stop: initialStop(entryIdx, price[4]), // 回退：浪5 结构失效位 = P4（移仓新仓同此规则）
      target,
    });
  }

  // 按入场时刻排序（同根K线入场时浪3 优先），同一时间只持一仓
  candidates.sort((a, b) => a.entryIdx - b.entryIdx || (a.wave === '浪3' ? -1 : 1));
  const trades = [];
  let openPos = null; // 当前持仓 { sid, wave, entryIdx, dir, score, exitIdx }，null 表示空仓
  const closeTrade = (pos, exitIdx, reason) => {
    const ret = ((bars[exitIdx].c - bars[pos.entryIdx].c) / bars[pos.entryIdx].c) * 100 * pos.dir;
    trades.push({
      signal: bars[pos.entryIdx].date,
      exit: bars[exitIdx].date,
      wave: pos.wave,
      dir: pos.dir,
      score: pos.score,
      ret: round2(ret),
      reason,
    });
  };
  for (const c of candidates) {
    if (openPos && c.entryIdx <= openPos.exitIdx) {
      // 持仓中：仅「同一结构的浪5 候选」触发移仓，其余候选跳过（单仓纪律）
      if (c.wave === '浪5' && openPos.wave === '浪3' && c.sid === openPos.sid) {
        closeTrade(openPos, c.entryIdx, '移仓'); // 以触发日收盘价平掉浪3 仓位
        const { exitIdx, reason } = simulate(bars, c.entryIdx, c.stop, c.target); // 同价开浪5 仓位
        closeTrade({ ...c }, exitIdx, reason);
        openPos = { ...c, exitIdx };
      }
      continue;
    }
    // 空仓：正常开仓（含浪3 已平仓后独立触发的浪5）
    const { exitIdx, reason } = simulate(bars, c.entryIdx, c.stop, c.target);
    closeTrade({ ...c }, exitIdx, reason);
    openPos = { ...c, exitIdx };
  }
  // 按出场日排序，逐笔复利生成净值曲线（0 笔交易时仅输出一条 1.0 平线）
  trades.sort((a, b) => (a.exit < b.exit ? -1 : a.exit > b.exit ? 1 : 0));
  let v = 1;
  const equity = [{ date: trades[0]?.signal ?? bars[0].date, v: 1 }];
  for (const t of trades) {
    v *= 1 + t.ret / 100;
    equity.push({ date: t.exit, v: Math.round(v * 10000) / 10000 });
  }
  return { trades, equity };
}

// ---------------------------------------------------------------------------
// 种子文件
// ---------------------------------------------------------------------------

/** 读取 scripts/news.seed.json；缺失或解析失败时返回空 news/calendar */
function loadSeed() {
  try {
    const raw = fs.readFileSync(SEED_FILE, 'utf8');
    const seed = JSON.parse(raw);
    return {
      news: Array.isArray(seed.news) ? seed.news : [],
      calendar: Array.isArray(seed.calendar) ? seed.calendar : [],
    };
  } catch {
    console.warn('[warn] 种子文件 scripts/news.seed.json 缺失或无效，news/calendar/events 输出为空');
    return { news: [], calendar: [] };
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 对单品种的日K重算 pivots/waves/trades/equity/events 并汇总统计（在线/离线共用）。
 * meta: { key, name, group, unit, source }；bars 为 [{date,o,h,l,c}]。
 * 返回 { instrument, summaryRow }。
 */
function processBars(meta, bars, seed) {
  const { pivots, thr } = computeZigZag(bars);
  const waves = findWaves(pivots);
  // 大级别摆动点：阈值 = clamp(3 × 小级别阈值, 4%, 12%)，仅供回测顺势过滤与止损定位，不写入输出
  const majorThr = clamp(3 * thr, 0.04, 0.12);
  const majorPivots = computeZigZag(bars, majorThr).pivots;
  const { trades, equity } = backtest(pivots, majorPivots, bars);

  // 种子 calendar 中关联本品种的事件日期（去重排序）
  const events = [
    ...new Set(
      seed.calendar.filter((e) => Array.isArray(e.instruments) && e.instruments.includes(meta.key)).map((e) => e.date),
    ),
  ].sort();

  const instrument = {
    key: meta.key,
    name: meta.name,
    group: meta.group,
    unit: meta.unit,
    source: meta.source,
    ohlc: bars,
    pivots: pivots.map((p) => ({ date: p.date, price: round2(p.price), type: p.type })),
    waves,
    trades,
    equity,
    events,
  };

  const wins = trades.filter((t) => t.ret > 0).length;
  const summaryRow = {
    K线数: bars.length,
    '阈值%': round2(thr * 100),
    摆动点: pivots.length,
    划分数: waves.length,
    浪3: trades.filter((t) => t.wave === '浪3').length,
    浪5: trades.filter((t) => t.wave === '浪5').length,
    移仓: trades.filter((t) => t.reason === '移仓').length,
    交易数: trades.length,
    '胜率%': trades.length ? round1((wins / trades.length) * 100) : '-',
    累计收益: equity.length ? `${round2((equity[equity.length - 1].v - 1) * 100)}%` : '-',
  };
  return { instrument, summaryRow };
}

async function main() {
  // 离线模式（--offline）：不访问网络，读取现有 public/market_data.json 的 OHLC 重算后原子写回
  const offline = process.argv.includes('--offline');
  console.log(offline ? '离线模式：读取现有 market_data.json 重算 ...' : '开始构建 market_data.json ...');
  const seed = loadSeed();
  const instruments = [];
  const summary = [];

  // 现有 JSON（离线模式必读，在线模式用于全源链失败时复用 OHLC 兜底）
  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  } catch (err) {
    if (offline) {
      console.error(`错误：离线模式读取 ${path.relative(ROOT, OUT_FILE)} 失败：${err.message}`);
      process.exit(1);
    }
  }
  const existingByKey = new Map((existing?.instruments ?? []).map((i) => [i.key, i]));

  if (offline) {
    // 品种表以现有 JSON 的 instruments 为准，元信息与 OHLC 原样复用
    for (const inst of existing.instruments ?? []) {
      console.log(`重算 ${inst.key}（${inst.name}），${inst.ohlc.length} 根K线`);
      const { instrument, summaryRow } = processBars(inst, inst.ohlc, seed);
      instruments.push(instrument);
      summary.push({ 品种: inst.key, 数据源: inst.source, ...summaryRow });
    }
  } else {
    for (const inst of INSTRUMENTS) {
      process.stdout.write(`抓取 ${inst.key}（${inst.name}）... `);
      const got = await fetchInstrument(inst);
      if (!got) {
        // 全源链失败：复用现有 JSON 的 OHLC 重算（等同离线行为）；没有则跳过
        const old = existingByKey.get(inst.key);
        if (old) {
          console.warn(`\n  [warn] ${inst.key} 所有数据源均失败，复用现有 JSON 的 OHLC 重算`);
          const { instrument, summaryRow } = processBars(old, old.ohlc, seed);
          instruments.push(instrument);
          summary.push({ 品种: inst.key, 数据源: `${old.source}（复用）`, ...summaryRow });
        } else {
          console.warn(`\n  [warn] ${inst.key} 所有数据源均失败且无现有数据，跳过该品种`);
          summary.push({ 品种: inst.key, 状态: '抓取失败' });
        }
        continue;
      }
      console.log(`使用 ${got.meta.source}，${got.bars.length} 根K线`);
      const { instrument, summaryRow } = processBars(got.meta, got.bars, seed);
      instruments.push(instrument);
      summary.push({ 品种: inst.key, 数据源: got.meta.source, ...summaryRow });
    }
  }

  if (instruments.length === 0) {
    console.error(offline ? '错误：现有数据没有任何品种，终止写入' : '错误：没有任何品种抓取成功，终止写入');
    process.exit(1);
  }

  const asof = instruments.map((i) => i.ohlc[i.ohlc.length - 1].date).sort().at(-1);
  const output = { asof, instruments, news: seed.news, calendar: seed.calendar };

  // 原子写入：先写临时文件再 rename 替换
  const tmp = OUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(output));
  fs.renameSync(tmp, OUT_FILE);
  console.log(`\n已写入 ${path.relative(ROOT, OUT_FILE)}（asof=${asof}，${instruments.length} 个品种）\n`);
  console.table(summary);
}

main().catch((err) => {
  console.error('构建失败：', err);
  process.exit(1);
});
