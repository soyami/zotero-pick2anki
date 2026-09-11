// ============ 词典适配器统一规范（所有源都必须输出此结构） ============
// 一个源 = 一个独立脚本（adapter）：只负责“抓取/解析该源原始数据 → 转成下面的统一结构”。
// 渲染、写卡、排序、设置一律只依赖本文件里的规范类型。
// 任何第三方爬虫/解析器只要产出该结构（definition 至少一条，否则返回 null ）即可无缝接入。
import type { OnlineDictSource } from "./settings";

/** 词典源 id（与设置中的可选源一致） */
export type DictSourceId = OnlineDictSource;

/** 单条释义 */
export interface DictDefinition {
  pos?: string;         // 词性（中文标签或原始缩写，如 "名词" / "verb" / "n."）
  meaning: string;      // 主释义（必填纯文本；英汉双解源放英文释义，纯英英源放英文，纯英汉源放中文）
  zh?: string;          // 中文释义（仅当源提供“英中成对”时才有）
  example?: string;     // 该义项自带例句原文（可选，取第一条）
  exampleZh?: string;   // 例句翻译（可选）
}

/** 额外例句（如有道 blng_sents_part，放卡片例句/Extra 区） */
export interface DictExample { en: string; zh?: string }

/** 发音直链：单一音频 URL 或分英/美 */
export type DictAudioUrl = string | { uk?: string; us?: string };

/** 一个词条的统一查词结果 */
export interface DictResult {
  word: string;                     // 必有：查词原词（大小写/短语原样保留）
  phonetic?: string;                // 可选：音标（可为 "UK /…/ US /…/" 形式）
  audioUrl?: DictAudioUrl;          // 可选：发音直链（mp3）
  definitions: DictDefinition[];    // 必有：至少一条，否则适配器应返回 null
  examples?: DictExample[];         // 可选：额外例句
  source: string;                   // 必有：来源名，如 "有道柯林斯" / "牛津高阶"
  sourceUrl?: string;               // 可选：词条页链接，可溯源
  extras?: string[];                // 可选：附加信息（词形/搭配/考试标签等；插件扩展字段，可省略）
  raw?: unknown;                    // 可选：原始返回 JSON（调试救命，生产可剥离）
}

/** 词典适配器（一个源一个） */
export interface DictAdapter {
  id: DictSourceId;
  name: string;                                  // 设置与来源展示名
  lookup(word: string): Promise<DictResult | null>; // 无至少一条 definition 时返回 null
  sourceUrlFor(word: string): string;            // 词条页链接（列表/弹窗溯源用）
}

/** 单个源在本次查询中的输出 */
export interface DictLookupSource {
  id: DictSourceId;
  name: string;
  url: string;
  ok: boolean;
  result?: DictResult | null;
  error?: string;
}

/** 一次查词的聚合结果（保留各源与顺序） */
export interface DictLookupBundle {
  word: string;
  sources: DictLookupSource[];
}
