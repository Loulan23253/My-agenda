/**
 * v1 残留清理的纯变换(供"清理旧版残留"命令与单测共用):
 * - 日记:移除 v1 注入块(`<!--agenda-injected-->` 行及其后连续的 `>>-` 行)
 * - 月度文件:移除 v1 遗留字段行(uid/title/start/end/all_day/origin/etag/href)
 * 返回 [清理后文本, 清理计数]。
 */
export const LEGACY_FIELD_RE = /^- (uid|title|start|end|all_day|origin|etag|href)::/;

export function stripLegacyFromDaily(text: string): [string, number] {
  if (!text.includes("<!--agenda-injected-->")) return [text, 0];
  let count = 0;
  const out: string[] = [];
  let removing = false;
  for (const line of text.split("\n")) {
    if (line.includes("<!--agenda-injected-->")) {
      removing = true;
      count++;
      continue;
    }
    if (removing) {
      if (line.trim().startsWith(">>-")) { count++; continue; }
      if (line.trim() === "") { removing = false; continue; }
      removing = false;
    }
    out.push(line);
  }
  return [out.join("\n"), count];
}

export function stripLegacyFromMonthly(text: string): [string, number] {
  let count = 0;
  const out = text.split("\n").filter((l) => {
    if (LEGACY_FIELD_RE.test(l)) { count++; return false; }
    return true;
  });
  return [out.join("\n"), count];
}
