/**
 * 月度笔记仓库:日程的唯一用户可见载体(每月一个 YYYY-MM.md)。
 * 读取时同时抽取 v1 遗留同步字段(etag/href),供迁移器播种账本;
 * 写入一律产出 v2 干净格式。
 */
import type { CalendarEvent } from "../model/event";
import { MONTH_FILE_RE, parseMonthlyNote, blockToEvent, serializeBlock, serializeRawBlock, serializeMonthlyNote } from "./note-format";
import type { KeyValueFileIO } from "./io";

export function monthOf(startsAt: string): string {
  const m = /^(\d{4}-\d{2})/.exec(startsAt);
  return m ? m[1] : "unknown";
}

/** v1 遗留元数据:旧笔记字段里的 href/etag,迁移时播种进账本。 */
export interface LegacyMeta {
  href?: string;
  etag?: string;
}

export interface LoadedMonthData {
  events: CalendarEvent[];
  /** uid → v1 遗留元数据(仅当笔记字段里存在时)。 */
  legacy: Record<string, LegacyMeta>;
  /** 无法还原的块数(缺 id/starts),提示用户而非静默吞掉。 */
  skipped: number;
}

export class MonthlyNoteStore {
  constructor(
    private readonly io: KeyValueFileIO,
    private readonly folder: string,
  ) {}

  private monthPath(month: string): string {
    return `${this.folder}/${month}.md`;
  }

  async listMonthPaths(): Promise<string[]> {
    const all = await this.io.listFiles(this.folder);
    return all.filter((p) => MONTH_FILE_RE.test(p.slice(p.lastIndexOf("/") + 1))).sort();
  }

  /** 全量读取(跨月文件:重复事件的定义可能在任意月份)。 */
  async loadAll(): Promise<LoadedMonthData> {
    const events: CalendarEvent[] = [];
    const legacy: Record<string, LegacyMeta> = {};
    let skipped = 0;
    const seen = new Set<string>();
    for (const path of await this.listMonthPaths()) {
      const text = await this.io.readText(path);
      if (!text) continue;
      const { blocks } = parseMonthlyNote(text);
      for (const b of blocks) {
        const ev = blockToEvent(b);
        if (!ev) {
          skipped++;
          continue;
        }
        // 跨月残留的同 id 块只认最早一份(全量写回时另一份会被清掉)
        if (seen.has(ev.id)) {
          skipped++;
          continue;
        }
        seen.add(ev.id);
        events.push(ev);
        const href = b.fields["href"];
        const etag = b.fields["etag"];
        if (href || etag) legacy[ev.id] = { href, etag };
      }
    }
    return { events, legacy, skipped };
  }

  /**
   * 重写指定月份(传入【库内全量】事件集):
   * 月度文件最终内容 = 未知/手写块(原样保留)+ startsAt 属于本月的日程块。
   * 日程跨月移动时,旧月文件里的旧块会被自动移除——这是全量语义的关键:
   * 按 id 替换 + 归属判定,任何路径(拖拽/编辑/同步/迁移)都不会留下跨月残留副本。
   */
  async writeMonth(month: string, allEvents: CalendarEvent[], preamble = ""): Promise<void> {
    await this.io.ensureDir(this.folder);
    const path = this.monthPath(month);
    const existingText = await this.io.readText(path);
    const parsed = existingText ? parseMonthlyNote(existingText) : { preamble: "", blocks: [] };
    const usePreamble = existingText ? parsed.preamble : preamble;
    const byId = new Map(allEvents.map((e) => [e.id, e]));
    const out: string[] = [];
    const emitted = new Set<string>();
    for (const b of parsed.blocks) {
      const id = b.fields["id"] ?? b.fields["uid"];
      const ev = id ? byId.get(id) : undefined;
      if (ev && monthOf(ev.startsAt) === month) {
        if (emitted.has(ev.id)) continue; // 同 id 重复块(历史残留):只保留第一份
        out.push(serializeBlock(ev, b));
        emitted.add(ev.id);
      } else if (id && ev && monthOf(ev.startsAt) !== month) {
        continue; // 日程已移往其他月份:本月的旧块删除
      } else {
        out.push(serializeRawBlock(b)); // 手写段落等非日程块原样保留
      }
    }
    const fresh = allEvents
      .filter((e) => monthOf(e.startsAt) === month && !emitted.has(e.id))
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))
      .map((e) => serializeBlock(e));
    await this.io.writeText(path, serializeMonthlyNote(usePreamble, [...out, ...fresh]));
  }

  async readMonthPreamble(month: string): Promise<string> {
    const text = await this.io.readText(this.monthPath(month));
    return text ? parseMonthlyNote(text).preamble : "";
  }

  /** 删除指定 uid 所在的整个块(跨月查找)。 */
  async removeByUids(ids: ReadonlySet<string>): Promise<number> {
    let removed = 0;
    for (const path of await this.listMonthPaths()) {
      const text = await this.io.readText(path);
      if (!text) continue;
      const { preamble, blocks } = parseMonthlyNote(text);
      const kept = blocks.filter((b) => {
        const ev = blockToEvent(b);
        if (ev && ids.has(ev.id)) {
          removed++;
          return false;
        }
        return true;
      });
      if (kept.length !== blocks.length) {
        // 删除操作只移除目标块,兄弟块一律原样保留(serializeBlock 的有损重写会损坏手写内容)
        await this.io.writeText(path, serializeMonthlyNote(preamble, kept.map((b) => serializeRawBlock(b))));
      }
    }
    return removed;
  }
}
