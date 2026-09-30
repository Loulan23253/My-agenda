# MyAgenda v2 — 架构蓝图(全新实现)

> 本文是 v2 重写的功能契约与架构设计。v2 是独立实现:不复制 v1(Ogenda 衍生版)的
> 任何代码、命名、注释与文件结构;但必须完整读取 v1 写下的数据(月度笔记)。

## 功能契约(全部保留,一项不缺)

1. iCloud / CalDAV 双向同步(全球 + 中国区服务器自动适配)
2. 多日历:同时同步多个日历,每日历独立分类,新日程按分类路由
3. 冲突处理:用户选择"保留我的 / 用服务器版本",单事件失败不中断
4. 月度 Markdown 笔记存储(兼容读取 v1 数据,迁移到 v2 干净格式)
5. 面板:日程流(按天)/ 日(时间网格)/ 周 / 月 / 统计 五视图
6. 周日期条(事件圆点)、底部图标导航、大标题、Apple 视觉主题
7. 面板内搜索、分类筛选、时段配置、迷你日历
8. 提醒(30s 轮询 + 防重)、快速添加、事件编辑、重复事件(EXDATE/RRULE)
9. 日记注入(新建 YYYY-MM-DD.md 自动注入,手动命令强制重建)
10. 导出 ICS 备份、自动同步间隔、上次同步时间、双语(zh/en)

## 与 v1 的根本架构差异

| 维度 | v1(Ogenda 式) | v2(本设计) |
|---|---|---|
| 同步元数据 | 写在笔记字段里(etag::/href::/base_hash::) | **独立账本文件** `.myagenda/journal.json`,笔记保持干净可读 |
| 变更检测 | 单值 FNV-1a 32 位 | **SHA-256(Web Crypto)+ 版本化**,账本记录每条 pushedHash |
| 同步驱动 | 每轮全量 REPORT | **游标增量优先**(sync-collection),不支持时回退全量;按日历独立游标 |
| 同步过程 | 一次性散装循环 | **显式阶段状态机**:SCAN → RECONCILE → COMMIT → PUBLISH,每阶段可持久化 |
| 删除语义 | server_deleted 字段标记 | 账本墓碑(tombstone)记录,笔记即时删除 |
| 代码组织 | connectors/core/sync/store/agenda-panel | kernel / model / data / sync / ui / platform / l10n |

## 数据格式

### v2 干净笔记(用户可见,不再有同步字段)

```markdown
---
type: calendar
---
# 2026-09

## 09:00–10:30 高数课
- uid:: 8F3A…@myagenda
- start:: 2026-09-27T09:00:00
- end:: 2026-09-27T10:30:00
- category:: 上学
- location:: 教学楼A

课堂要点……(用户自由文本)
```

### journal.json(同步账本,机器管理)

```json
{
  "version": 2,
  "calendars": { "<calendarId>": { "url": "…", "syncToken": "…" } },
  "events": {
    "<uid>": {
      "calendarId": "…", "href": "…", "etag": "\"…\"",
      "pushedHash": "sha256hex", "state": "synced|localDirty|pendingDelete"
    }
  }
}
```

## 里程碑

- M1 数据层:模型 / 干净笔记序列化 / 账本 / v1 数据读取(本仓库直接可测)
- M2 同步引擎:阶段状态机 / CalDAV 客户端 / 多日历路由 / 冲突策略
- M3 面板 UI:五视图 + 日期条 + 底部导航 + Apple 主题
- M4 设置 / 双语 / 日记注入 / 导出 / 提醒
- M5 迁移与对等验收(读 v1 数据 → 账本 → 干净重写,逐条核对)
- M6 部署替换生产插件(旧版 1.10.1 备份已存档)
