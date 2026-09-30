const PALETTE = ["#4c8dff", "#ff9500", "#06b6d4", "#34c759", "#a855f7", "#ef4444", "#ec4899", "#eab308", "#14b8a6", "#6366f1"];
const NEUTRAL = "#98a0ad";

export type ColorOf = (category: string | undefined) => string;

let customColors: Record<string, string> = {};

/** 用户在设置里为分类指定的颜色覆盖调色板(启动与修改时同步进来)。 */
export function setCategoryColors(map: Record<string, string>): void {
  customColors = map ?? {};
}

/** 分类 → 颜色(用户自定义优先,否则 FNV-1a 选盘,与内容指纹无关)。 */
export function categoryColor(category: string | undefined): string {
  const key = (category ?? "").trim();
  if (!key) return NEUTRAL;
  const custom = customColors[key];
  if (custom) return custom;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[(h >>> 0) % PALETTE.length];
}
