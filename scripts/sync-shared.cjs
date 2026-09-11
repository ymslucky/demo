#!/usr/bin/env node
/**
 * shared → 自包含函数文件的构建期分发器。
 *
 * shared/auth-core.js 是 Clerk 会话判定的单一真源；EdgeOne 边缘函数与
 * Makers agents 单文件部署、禁止运行时 import，因此把 shared 全文注入
 * 目标文件的 "shared:auth-core" 标记区间。区间内容随提交进仓库（目标
 * 文件保持可独立部署），本脚本保证区间与源头一致：
 *
 *   node scripts/sync-shared.cjs          # 把 shared 写入所有目标区间
 *   node scripts/sync-shared.cjs --check  # 只校验一致性（npm test 前置）
 *
 * 新增注入目标：在 TARGETS 里加相对路径，并在目标文件内放置一对
 * "shared:auth-core" 开始/结束标记（见 BEGIN/END）。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_REL = path.join("shared", "auth-core.js");
const SOURCE = path.join(ROOT, SOURCE_REL);
const TARGETS = ["functions/api/todo.js", "agents/code-run/index.ts"];

const BEGIN = "/* ==shared:auth-core== */";
const END = "/* ==/shared:auth-core== */";

// 注入 .ts 目标（agents）时追加的参数/返回类型——shared 源是纯 JS，TS 目标
// 的 noImplicitAny 需要显式标注。shared 新增函数时在此登记对应签名。
const TS_SIGNATURES = [
  ["export function siteApex(raw)", "export function siteApex(raw: unknown): string | null"],
  [
    "export function normalizeIssuer(value)",
    "export function normalizeIssuer(value: unknown): string",
  ],
  [
    "export function parseList(raw)",
    "export function parseList(raw: string | undefined): string[] | null",
  ],
  [
    "export function deriveIssuers({ siteDomain, clerkIssuer } = {})",
    "export function deriveIssuers({ siteDomain, clerkIssuer } = {} as { siteDomain?: string; clerkIssuer?: string }): string[]",
  ],
  [
    "export function isAllowedAzp(azp, apex)",
    "export function isAllowedAzp(azp: unknown, apex: unknown): boolean",
  ],
  [
    "export function roleFromClaims(payload)",
    "export function roleFromClaims(payload: Record<string, unknown> | null | undefined): string",
  ],
];

/** 按目标语言产出区间内容：.ts 目标补显式类型标注，.js 目标原样。 */
function regionFor(rel, source) {
  let body = source;
  if (rel.endsWith(".ts")) {
    for (const [js, ts] of TS_SIGNATURES) {
      if (!body.includes(js)) {
        throw new Error(`${SOURCE_REL}: signature not found for TS injection: ${js}`);
      }
      body = body.replace(js, ts);
    }
  }
  return `${BEGIN}\n${body}\n${END}`;
}

function readSharedSource() {
  const source = fs.readFileSync(SOURCE, "utf8").trimEnd();
  if (source.includes(BEGIN) || source.includes(END)) {
    throw new Error(`${SOURCE_REL} must not contain the region markers themselves`);
  }
  return source;
}

function syncTarget(rel, source, write) {
  const file = path.join(ROOT, rel);
  const content = fs.readFileSync(file, "utf8");
  const beginAt = content.indexOf(BEGIN);
  const endAt = content.indexOf(END);
  if (beginAt === -1 || endAt === -1) {
    throw new Error(`${rel}: missing "shared:auth-core" region markers`);
  }
  if (endAt < beginAt) {
    throw new Error(`${rel}: region end marker precedes begin marker`);
  }
  if (content.indexOf(BEGIN, beginAt + BEGIN.length) !== -1) {
    throw new Error(`${rel}: duplicate region begin marker`);
  }
  const next = content.slice(0, beginAt) + regionFor(rel, source) + content.slice(endAt + END.length);
  if (write) {
    if (next !== content) {
      fs.writeFileSync(file, next);
      console.log(`synced: ${rel}`);
    } else {
      console.log(`up-to-date: ${rel}`);
    }
  } else if (next !== content) {
    throw new Error(
      `${rel}: region drifted from ${SOURCE_REL} — run "node scripts/sync-shared.cjs" and commit`,
    );
  }
}

const check = process.argv.includes("--check");
const source = readSharedSource();
for (const rel of TARGETS) syncTarget(rel, source, !check);
console.log(check ? "shared regions in sync" : "shared sync complete");
