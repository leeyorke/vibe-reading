#!/usr/bin/env node
/**
 * 发版助手：把「升版本号 → 起一个 chore: release 提交 → 打 tag」变成一条命令。
 *
 * 发版规则（AGENTS.md 的「发版流程」一节有同样的说明，CI 也会校验）：
 *
 *   1. 每次发版都起一个**新提交**，提交信息固定为 `chore: release v.X.Y.Z`
 *   2. 这个提交把 package.json 的 version 改成 X.Y.Z
 *   3. tag `v.X.Y.Z` 打在**这个提交**上
 *   4. 已发布的 tag 不重打 —— 要改内容就发新的版本号
 *
 * 用法：
 *   node scripts/release.mjs patch        # 1.39.0 -> 1.39.1
 *   node scripts/release.mjs minor        # 1.39.0 -> 1.40.0
 *   node scripts/release.mjs major        # 1.39.0 -> 2.0.0
 *   node scripts/release.mjs 1.40.0      # 指定版本
 *   node scripts/release.mjs patch --push # 顺便把分支和 tag 都推上去
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGE_JSON = join(ROOT, "package.json")
const RELEASE_SUBJECT = "chore: release"

function fail(message) {
  console.error(`\n✘ ${message}\n`)
  process.exit(1)
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

/** 跑一条命令，失败时返回 null（不抛） */
function tryRun(command, args) {
  try {
    return run(command, args)
  }
  catch {
    return null
  }
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match)
    fail(`版本号格式不对：${value}（应该是 x.y.z）`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index])
      return a[index] - b[index]
  }
  return 0
}

function bumpVersion(version, kind) {
  const [major, minor, patch] = parseVersion(version)
  if (kind === "major")
    return `${major + 1}.0.0`
  if (kind === "minor")
    return `${major}.${minor + 1}.0`
  if (kind === "patch")
    return `${major}.${minor}.${patch + 1}`
  fail(`未知的版本类型：${kind}（用 patch / minor / major，或者直接写版本号）`)
}

function readPackageVersion() {
  const content = readFileSync(PACKAGE_JSON, "utf8")
  const match = /"version":\s*"([^"]+)"/.exec(content)
  if (!match)
    fail("package.json 里找不到 version 字段")
  return match[1]
}

function writePackageVersion(version) {
  const content = readFileSync(PACKAGE_JSON, "utf8")
  // 只替换 version 那一行——把整个文件 JSON.stringify 回去会改掉格式。
  const updated = content.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
  writeFileSync(PACKAGE_JSON, updated)
}

function main() {
  const args = process.argv.slice(2)
  const shouldPush = args.includes("--push")
  const target = args.find(arg => !arg.startsWith("--"))

  if (!target)
    fail("用法：node scripts/release.mjs <patch|minor|major|x.y.z> [--push]")

  const currentVersion = readPackageVersion()
  const nextVersion = /^\d+\.\d+\.\d+$/.test(target)
    ? target
    : bumpVersion(currentVersion, target)

  if (compareVersions(nextVersion, currentVersion) <= 0)
    fail(`新版本号必须比当前版本大：${currentVersion} -> ${nextVersion}`)

  const branch = run("git", ["branch", "--show-current"])
  if (branch !== "main")
    fail(`当前分支是 ${branch}，发版要在 main 上做`)

  const dirty = run("git", ["status", "--porcelain"])
  if (dirty)
    fail(`工作区不干净，先提交或 stash：\n${dirty}`)

  const head = run("git", ["rev-parse", "HEAD"])
  const remoteHead = tryRun("git", ["rev-parse", "origin/main"])
  if (remoteHead && remoteHead !== head)
    fail("本地和 origin/main 不一致，先 git pull --rebase")

  const tag = `v${nextVersion}`
  const subject = `${RELEASE_SUBJECT} ${tag}`

  if (tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]))
    fail(`本地已经有 tag ${tag} —— 已发布的 tag 不重打，要改内容就发新的版本号`)

  const remoteTags = tryRun("git", ["ls-remote", "--tags", "origin"])
  if (remoteTags === null) {
    console.warn("! 连不上远端，跳过远端 tag 检查")
  }
  else if (remoteTags.split("\n").some(line => line.endsWith(`refs/tags/${tag}`))) {
    fail(`远端已经有 tag ${tag} —— 已发布的 tag 不重打，要改内容就发新的版本号`)
  }

  writePackageVersion(nextVersion)
  // 改完校验一遍：正则可能改错地方（比如 devEngines 里也有 version 字段）
  if (JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version !== nextVersion)
    fail("package.json 的 version 改写后校验不过，已中止")

  run("git", ["add", "package.json"])
  run("git", ["commit", "-m", subject])
  run("git", ["tag", "-a", tag, "-m", subject])

  console.log(`
✅ 本地发版准备完成
   版本  ${currentVersion} -> ${nextVersion}
   提交  ${run("git", ["rev-parse", "--short", "HEAD"])}  ${subject}
   tag   ${tag}
`)

  if (shouldPush) {
    run("git", ["push", "origin", "main"])
    run("git", ["push", "origin", tag])
    console.log(`\n🚀 已推送 main 和 ${tag}，GitHub Actions 会自动打包并发布 Release\n`)
  }
  else {
    console.log(`下一步：
   git push origin main
   git push origin ${tag}
`)
  }
}

main()
