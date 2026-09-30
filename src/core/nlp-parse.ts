/**
 * 自然语言快速添加解析器:纯函数、零 Obsidian 依赖(可在 Node 中直接自测)。
 *
 * 思路:对输入按「日期 → 全天 → 时刻 → 时长」的优先级扫描短语,命中即从原文
 * 中"消费"掉(记录区间),剩余文本经清理后作为标题。含 ASCII 数字/字母的短语
 * 要求匹配点落在词边界附近(紧邻字符不能是 [0-9A-Za-z]),避免误伤标题文字。
 */

import { addDays, dateKey, startOfDay } from "../kernel/dates";

export interface QuickAddParse {
  /** YYYY-MM-DD(无日期短语时默认今天)。 */
  dateKey: string;
  /** HH:MM;无时刻短语 → undefined(全天)。 */
  startHHMM?: string;
  /** 有时刻且识别出时长时提供;未提供时调用方默认 60。 */
  durationMin?: number;
  allDay: boolean;
  /** 剩余文本(清理分隔符后);为空时 parseQuickAdd 返回 null。 */
  title: string;
  /** 命中的日期/时刻/时长短语(调试与预览用)。 */
  hits: string[];
  /** @地点 短语提取(可选)。 */
  place?: string;
  /** #分类 短语提取(可选)。 */
  category?: string;
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                             */
/* ------------------------------------------------------------------ */

const ASCII_WORD = /[0-9A-Za-z]/;

/** 已消费的原文区间(半开区间 [start, end))。 */
interface Span {
  start: number;
  end: number;
}

/** 汉字数字 → 数值(支持 1–99 的常用写法:三、十、十二、二十三)。 */
function cjkNum(s: string): number | null {
  const u: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const d = (c: string): number | null => u[c] ?? null;
  if (s.length === 1) return s === "十" ? 10 : d(s);
  if (s.length === 2) {
    if (s[0] === "十") { const x = d(s[1]); return x == null ? null : 10 + x; }
    if (s[1] === "十") { const t = d(s[0]); return t == null ? null : t * 10; }
    return null;
  }
  if (s.length === 3 && s[1] === "十") {
    const t = d(s[0]);
    const x = d(s[2]);
    return t == null || x == null ? null : t * 10 + x;
  }
  return null;
}

function parseNumToken(tok: string): number | null {
  if (/^\d{1,2}$/.test(tok)) return Number.parseInt(tok, 10);
  return cjkNum(tok);
}

/**
 * 在 s 中找出第一个满足以下条件的匹配并标记为已消费:
 * 1) 不与已消费区间重叠;
 * 2) 词边界成立——若匹配首/尾是 ASCII 字母数字,其紧邻外侧字符不得也是字母数字;
 * 3) 可选的 check 通过(用于"去年""第 N 点"等上下文否决)。
 */
function takeMatch(
  s: string,
  re: RegExp,
  taken: Span[],
  check?: (m: RegExpExecArray, start: number) => boolean,
): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = g.exec(s); m !== null; m = g.exec(s)) {
    if (m[0].length === 0) {
      g.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    const overlap = taken.some((t) => start < t.end && end > t.start);
    const first = m[0][0];
    const last = m[0][m[0].length - 1];
    const bounded =
      !(start > 0 && ASCII_WORD.test(first) && ASCII_WORD.test(s[start - 1])) &&
      !(end < s.length && ASCII_WORD.test(last) && ASCII_WORD.test(s[end]));
    if (!overlap && bounded && (!check || check(m, start))) {
      taken.push({ start, end });
      return m;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 日期短语                                                            */
/* ------------------------------------------------------------------ */

const DOW_ORD: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };

function findDate(input: string, now: Date, taken: Span[]): { key: string; hit: string } | null {
  const base = startOfDay(now);
  const valid = (y: number, mo: number, d: number): boolean => {
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  };
  const fromYMD = (y: number, mo: number, d: number): string => dateKey(new Date(y, mo - 1, d));
  // MM-DD 不得被数字或连字符夹住(否则会咬进 2026-10-01 / 10-01-2)
  const noDashAround = (m: RegExpExecArray, start: number): boolean => {
    const end = start + m[0].length;
    return (
      !(start > 0 && /[0-9-]/.test(input[start - 1])) &&
      !(end < input.length && /[0-9-]/.test(input[end]))
    );
  };

  // 1) YYYY-MM-DD / YYYY年M月D日
  let m = takeMatch(input, /(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?/, taken, (mm) =>
    valid(+mm[1], +mm[2], +mm[3]),
  );
  if (m) return { key: fromYMD(+m[1], +m[2], +m[3]), hit: m[0] };

  // 2) MM-DD(年份取 now)
  m = takeMatch(input, /(\d{1,2})-(\d{1,2})/, taken, (mm, start) =>
    valid(now.getFullYear(), +mm[1], +mm[2]) && noDashAround(mm, start),
  );
  if (m) return { key: fromYMD(now.getFullYear(), +m[1], +m[2]), hit: m[0] };

  // 3) (明年|今年)?M月D日;"去年"前缀不命中
  m = takeMatch(input, /(明年|今年)?\s*(\d{1,2})月\s*(\d{1,2})日/, taken, (mm, start) => {
    if (start >= 2 && input.slice(start - 2, start) === "去年") return false;
    if (start > 0 && /\d/.test(input[start - 1])) return false;
    const y = mm[1] === "明年" ? now.getFullYear() + 1 : now.getFullYear();
    return valid(y, +mm[2], +mm[3]);
  });
  if (m) {
    const y = m[1] === "明年" ? now.getFullYear() + 1 : now.getFullYear();
    return { key: fromYMD(y, +m[2], +m[3]), hit: m[0] };
  }

  // 4) 大后天(先于"后天")/后天(前邻"明"时跳过,如"明后天")/明天/今天
  const rel: { re: RegExp; off: number; guard?: (start: number) => boolean }[] = [
    { re: /大后天/, off: 3 },
    { re: /后天/, off: 2, guard: (s) => !(s > 0 && input[s - 1] === "明") },
    { re: /明天/, off: 1 },
    { re: /今天/, off: 0 },
  ];
  for (const { re, off, guard } of rel) {
    const mm = takeMatch(input, re, taken, guard ? (_mm, start) => guard(start) : undefined);
    if (mm) return { key: dateKey(addDays(base, off)), hit: mm[0] };
  }

  // 5) 下(周|礼拜|星期)X → 下一周的该星期
  const todayOrd = (now.getDay() + 6) % 7; // 周一=0 … 周日=6
  m = takeMatch(input, /下\s*(?:周|礼拜|星期)\s*([一二三四五六日天])/, taken);
  if (m) {
    const delta = (DOW_ORD[m[1]] ?? 0) - todayOrd + 7;
    return { key: dateKey(addDays(base, delta)), hit: m[0] };
  }

  // 6) (本|这)?(周|礼拜|星期)X → 本周该星期;已过(周一为首)则顺延下周。
  //    紧邻前缀为 上/下/每 时否决(上周五/每周五例会不是单次日程)。
  m = takeMatch(input, /[本这]?\s*(?:周|礼拜|星期)\s*([一二三四五六日天])/, taken, (_mm, start) => {
    const prev = start > 0 ? input[start - 1] : "";
    return prev !== "上" && prev !== "下" && prev !== "每";
  });
  if (m) {
    let delta = (DOW_ORD[m[1]] ?? 0) - todayOrd;
    if (delta < 0) delta += 7;
    return { key: dateKey(addDays(base, delta)), hit: m[0] };
  }

  // 7) 轻量英文:today / tomorrow
  m = takeMatch(input, /\b(today|tomorrow)\b/i, taken);
  if (m) return { key: dateKey(addDays(base, /^tomo/i.test(m[1]) ? 1 : 0)), hit: m[0] };

  return null;
}

/* ------------------------------------------------------------------ */
/* 时刻短语                                                            */
/* ------------------------------------------------------------------ */

const RE_TIME_ZH =
  /(?:(上午|早上|凌晨|中午|下午|傍晚|晚上)\s*)?(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:[点时]\s*(半|(\d{1,2})\s*分?)?|[:：]\s*(\d{2}))/;
const RE_TIME_EN = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

function findTime(input: string, taken: Span[]): { hhmm: string; hit: string } | null {
  const p2 = (n: number): string => String(n).padStart(2, "0");

  let m = takeMatch(input, RE_TIME_ZH, taken, (mm, start) => {
    if (start > 0 && input[start - 1] === "第") return false; // "第3点意见"不是时刻
    const h = parseNumToken(mm[2]);
    if (h == null || h < 0 || h > 23) return false;
    let min = 0;
    if (mm[3] === "半") min = 30;
    else if (mm[4]) min = +mm[4];
    else if (mm[5]) min = +mm[5];
    return min >= 0 && min <= 59;
  });
  if (m) {
    let h = parseNumToken(m[2]) as number;
    const min = m[3] === "半" ? 30 : m[4] ? +m[4] : m[5] ? +m[5] : 0;
    const part = m[1];
    // 下午/傍晚/晚上且小时 < 12 → +12;中午且小时 0 → 12;凌晨/上午/早上不加
    if (part && (part === "下午" || part === "傍晚" || part === "晚上") && h < 12) h += 12;
    if (part === "中午" && h === 0) h = 12;
    return { hhmm: `${p2(h)}:${p2(min)}`, hit: m[0] };
  }

  // 轻量英文:3pm / 10:30am
  m = takeMatch(input, RE_TIME_EN, taken, (mm) => +mm[1] <= 23 && (!mm[2] || +mm[2] <= 59));
  if (m) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    const ap = m[3].toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return { hhmm: `${p2(h)}:${p2(min)}`, hit: m[0] };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 时长短语                                                            */
/* ------------------------------------------------------------------ */

const RE_DUR_HOUR =
  /(一个半|半|\d+(?:\.\d+)?|[一二两三四五六七八九十]{1,3})\s*个?\s*(半)?\s*个?\s*小时(?:\s*(半|\d{1,2})\s*分?)?/;
const RE_DUR_H = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?![a-z])/i;
const RE_DUR_MIN = /(\d+)\s*(?:分钟|分|min(?:ute)?s?|m)(?![a-z])/i;

function durHours(tok: string): number | null {
  if (tok === "一个半") return 1.5;
  if (tok === "半") return 0.5;
  if (/^\d/.test(tok)) return Number.parseFloat(tok);
  return cjkNum(tok);
}

function findDuration(input: string, taken: Span[]): { min: number; hit: string } | null {
  // N小时 / 一个半小时 / 半小时 / N小时半 / N小时M分 / 1.5h
  let m = takeMatch(input, RE_DUR_HOUR, taken, (mm) => {
    const base = durHours(mm[1]);
    if (base == null) return false;
    if (base + (mm[2] === "半" ? 0.5 : 0) > 24) return false;
    return !(mm[3] && mm[3] !== "半" && +mm[3] > 59);
  });
  if (m) {
    const base = (durHours(m[1]) as number) + (m[2] === "半" ? 0.5 : 0);
    const extra = m[3] === "半" ? 30 : m[3] ? +m[3] : 0;
    return { min: Math.round(base * 60) + extra, hit: m[0] };
  }
  // 1h / 1.5h / 2hours
  m = takeMatch(input, RE_DUR_H, taken);
  if (m) return { min: Math.round(Number.parseFloat(m[1]) * 60), hit: m[0] };
  // 45分钟 / 30分 / 30min / 30m
  m = takeMatch(input, RE_DUR_MIN, taken);
  if (m) return { min: +m[1], hit: m[0] };
  return null;
}

/* ------------------------------------------------------------------ */
/* 标题清理                                                            */
/* ------------------------------------------------------------------ */

const PUNCT = "\\s,，。.、;；:：!！?？·•…—–~\\-()（）\\[\\]【】《》“”‘’\"'`";
const LEAD_PUNCT_RE = new RegExp("^[" + PUNCT + "]+");
const TRAIL_PUNCT_RE = new RegExp("[" + PUNCT + "]+$");
const TRAIL_CONN_RE = /(?:^|\s)(开个|安排|去|开|于|在)$/;

/**
 * 开头连接词剥离长度;返回 0 表示不剥离。
 * 于/在(介词)开头即剔;开个/开/安排/去 仅当后随空白(或整串)才剔,
 * 以保护"开会/开会式"这类以"开"开头的正常标题。
 */
function leadConnectorLen(s: string): number {
  const strong = s.startsWith("于") || s.startsWith("在");
  const cands = ["开个", "安排", "去", "开", "于", "在"];
  for (const w of cands) {
    if (!s.startsWith(w)) continue;
    const rest = s.slice(w.length);
    if (!rest) return w.length;
    if (strong || /^\s/.test(rest)) return w.length;
    return 0; // 命中前缀但不满足剥离条件,不再尝试更短前缀
  }
  return 0;
}

function cleanTitle(input: string, taken: Span[]): string {
  // 已消费区间替换为空格,避免"周五18:30健身"式的粘连
  let out = "";
  for (let i = 0; i < input.length; ) {
    const t = taken.find((x) => i >= x.start && i < x.end);
    if (t) {
      out += " ";
      i = t.end;
      continue;
    }
    out += input[i++];
  }
  out = out.replace(/[ \t]+/g, " ").trim();
  for (;;) {
    const prev = out;
    out = out.replace(LEAD_PUNCT_RE, "").replace(TRAIL_PUNCT_RE, "").trim();
    const lead = leadConnectorLen(out);
    if (lead > 0) out = out.slice(lead).trim();
    const tm = out.match(TRAIL_CONN_RE);
    if (tm && tm.index !== undefined) out = out.slice(0, tm.index).trim();
    if (out === prev || !out) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/** 解析自然语言快速添加输入;无法得到非空标题时返回 null。 */
export function parseQuickAdd(input: string, now: Date): QuickAddParse | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  const taken: Span[] = [];
  const hits: string[] = [];

  const d = findDate(s, now, taken);
  if (d) hits.push(d.hit.trim());

  // "全天"关键词:强制全天(即便同时出现了时刻也丢弃)
  const allday = takeMatch(s, /全天/, taken);
  if (allday) hits.push(allday[0].trim());

  const tm = findTime(s, taken);
  if (tm) hits.push(tm.hit.trim());

  // 时刻范围「14:00-15:30 / 晚上11点到凌晨1点」:结束时刻紧跟起点 → 直接得时长(跨午夜自动进位)
  let rangeMin: number | undefined;
  if (tm) {
    const tmEnd = taken[taken.length - 1].end;
    const sep = /^\s*(?:[-–—~～]|至|到)\s*/.exec(s.slice(tmEnd));
    if (sep) {
      const sub = s.slice(tmEnd + sep[0].length);
      const mEnd = /^(?:(上午|早上|凌晨|中午|下午|傍晚|晚上)\s*)?(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:[点时]\s*(半|(\d{1,2})\s*分?)?|[:：]\s*(\d{2}))/.exec(sub);
      if (mEnd) {
        let h = parseNumToken(mEnd[2]);
        const minRaw = mEnd[3] === "半" ? 30 : mEnd[4] ? +mEnd[4] : mEnd[5] ? +mEnd[5] : 0;
        if (h != null && h >= 0 && h <= 23 && minRaw >= 0 && minRaw <= 59) {
          const part = mEnd[1];
          if (part && (part === "下午" || part === "傍晚" || part === "晚上") && h < 12) h += 12;
          if (part === "中午" && h === 0) h = 12;
          const [sh, sm] = tm.hhmm.split(":").map(Number);
          let diff = h * 60 + minRaw - (sh * 60 + sm);
          if (diff <= 0) diff += 1440;
          rangeMin = diff;
          taken.push({ start: tmEnd, end: tmEnd + sep[0].length + mEnd[0].length });
          hits.push(s.slice(tmEnd, tmEnd + sep[0].length + mEnd[0].length).trim());
        }
      }
    }
  }

  const dur = rangeMin === undefined ? findDuration(s, taken) : null;
  if (dur) hits.push(dur.hit.trim());

  // @地点 / #分类:任一未消费位置命中即提取并从标题剔除
  let place: string | undefined;
  let category: string | undefined;
  const findTags = (sym: string): string | undefined => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== sym) continue;
      if (taken.some((x) => i >= x.start && i < x.end)) continue;
      let end = i + 1;
      while (end < s.length && !/\s/.test(s[end]) && s[end] !== "@" && s[end] !== "#") end++;
      const word = s.slice(i + 1, end).trim();
      if (!word) continue;
      taken.push({ start: i, end });
      return word;
    }
    return undefined;
  };
  place = findTags("@");
  category = findTags("#");

  const startHHMM = allday ? undefined : tm?.hhmm;
  const dmin = rangeMin ?? dur?.min;
  const durationMin = tm && !allday && dmin !== undefined ? dmin : undefined;
  const title = cleanTitle(s, taken);
  if (!title) return null;

  return {
    dateKey: d ? d.key : dateKey(startOfDay(now)),
    startHHMM,
    durationMin,
    allDay: !startHHMM,
    title,
    hits,
    place,
    category,
  };
}
