/**
 * 同步账本:v2 的核心数据结构。所有同步元数据(href/etag/指纹/状态)只存在这里,
 * 笔记保持干净可读。设计为可整体 JSON 序列化,崩溃安全靠"先笔记后账本"的写入顺序。
 */
import type { EventId } from "../model/event";

export type SyncState = "synced" | "localDirty" | "pendingDelete";

export interface JournalEntry {
  calendarId: string;
  /** 服务器上的资源地址(同步后存在)。 */
  href?: string;
  /** 最后一次确认的服务器 etag。 */
  etag?: string;
  /** 最后一次成功推送时本地的内容指纹;当前指纹 ≠ 它 ⇒ 本地有未推送改动。 */
  pushedFingerprint?: string;
  state: SyncState;
}

export interface SyncJournal {
  version: 2;
  /** 每个日历的增量游标(sync-collection);服务器不支持时缺省。 */
  calendars: Record<string, { url: string; syncToken?: string }>;
  events: Record<EventId, JournalEntry>;
}

export const EMPTY_JOURNAL: SyncJournal = { version: 2, calendars: {}, events: {} };

export function journalGet(j: SyncJournal, id: EventId): JournalEntry | undefined {
  return j.events[id];
}

export function journalPut(j: SyncJournal, id: EventId, entry: JournalEntry): void {
  j.events[id] = entry;
}

export function journalRemove(j: SyncJournal, id: EventId): void {
  delete j.events[id];
}
