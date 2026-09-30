/** 平台无关的文件读写面:platform 层用 Obsidian vault 实现,测试用内存实现。 */
export interface KeyValueFileIO {
  /** 返回 null 表示文件不存在。 */
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** 列出目录下一层的文件路径(不含目录本身)。 */
  listFiles(dir: string): Promise<string[]>;
  ensureDir(dir: string): Promise<void>;
}
