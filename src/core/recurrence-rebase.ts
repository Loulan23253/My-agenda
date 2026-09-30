/**
 * 拖拽换天后重写重复规则,让"重复实例"跟随新的起始日期:
 * - WEEKLY:BYDAY 改写为新星期(多值 BYDAY 视为歧义,直接去掉,由起始日决定)
 * - MONTHLY:BYMONTHDAY 改写为新日期;BYDAY(如"每月第二个周一")语义复杂,丢弃
 * - 其余(DAILY/YEARLY…)保持不变(实例跟随起始日,天然正确)
 */
const DAY_TOKENS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function rebaseRuleOnMove(rule: string, newStart: Date): string {
  const parts = rule.split(";").filter(Boolean);
  const freq = (parts.find((p) => /^FREQ=/i.test(p)) ?? "").split("=")[1]?.toUpperCase() ?? "";
  const dayToken = DAY_TOKENS[newStart.getDay()];
  let hasByday = false;
  const out = parts.map((p) => {
    const eq = p.indexOf("=");
    if (eq === -1) return p;
    const k = p.slice(0, eq).toUpperCase();
    if (freq === "WEEKLY" && k === "BYDAY") {
      hasByday = true;
      return `BYDAY=${dayToken}`;
    }
    if (freq === "MONTHLY" && k === "BYMONTHDAY") return `BYMONTHDAY=${newStart.getDate()}`;
    if (freq === "MONTHLY" && k === "BYDAY") return "";
    if (freq === "YEARLY" && (k === "BYMONTH" || k === "BYMONTHDAY")) return "";
    return p;
  }).filter(Boolean);
  if (freq === "WEEKLY" && !hasByday) out.push(`BYDAY=${dayToken}`);
  return out.join(";");
}
