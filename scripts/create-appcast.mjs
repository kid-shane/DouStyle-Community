import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [appArg, archiveArg, notesArg, outputArg] = process.argv.slice(2);
if (!appArg || !archiveArg || !notesArg || !outputArg) {
  throw new Error("用法: node scripts/create-appcast.mjs 应用.app 更新包.zip 更新说明.txt 输出目录");
}
const app = path.resolve(appArg), archive = path.resolve(archiveArg), output = path.resolve(outputArg);
const readPlist = key => execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
const version = readPlist("CFBundleShortVersionString"), build = readPlist("CFBundleVersion");
const feed = new URL(readPlist("SUFeedURL"));
if (feed.protocol !== "https:" || feed.hostname !== "doustyle-updates.tos-cn-beijing.volces.com") throw new Error("发布清单只允许已配置的 TOS HTTPS 地址");
if (readPlist("CFBundleIdentifier") !== "local.doubao.style") throw new Error("不是豆Style正式应用");
if (!/^\d+\.\d+\.\d+$/.test(version) || path.extname(archive) !== ".zip") throw new Error("版本或更新包格式错误");
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const embeddedPlist = execFileSync("/usr/bin/unzip", ["-p", archive, `${path.basename(app)}/Contents/Info.plist`]);
if (!embeddedPlist.equals(readFileSync(path.join(app, "Contents/Info.plist")))) throw new Error("更新包与应用版本信息不匹配，请重新打包");
const sparkle = execFileSync(path.join(root, "scripts/prepare-sparkle.sh"), { encoding: "utf8" }).trim();
const account = "local.doubao.style";
const publicKey = execFileSync(path.join(sparkle, "bin/generate_keys"), ["--account", account, "-p"], { encoding: "utf8" }).trim();
if (publicKey !== readPlist("SUPublicEDKey")) throw new Error("签名密钥与应用内公钥不匹配");
const sign = path.join(sparkle, "bin/sign_update");
const signature = execFileSync(sign, ["--account", account, "-p", archive], { encoding: "utf8" }).trim();
execFileSync(sign, ["--account", account, "--verify", archive, signature]);
const xml = value => String(value).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const downloadURL = new URL(encodeURIComponent(path.basename(archive)), feed).href;
mkdirSync(output, { recursive: true });
const feedPath = path.join(output, "appcast.xml");
writeFileSync(feedPath, `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>豆Style 更新</title>
    <language>zh-CN</language>
    <item>
      <title>豆Style ${xml(version)}</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <sparkle:version>${xml(build)}</sparkle:version>
      <sparkle:shortVersionString>${xml(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${xml(readPlist("LSMinimumSystemVersion"))}</sparkle:minimumSystemVersion>
      <description>${xml(readFileSync(notesArg, "utf8"))}</description>
      <enclosure url="${xml(downloadURL)}" sparkle:edSignature="${xml(signature)}" length="${statSync(archive).size}" type="application/octet-stream" />
    </item>
  </channel>
</rss>
`);
execFileSync(sign, ["--account", account, feedPath]);
execFileSync(sign, ["--account", account, "--verify", feedPath]);
console.log(`已生成并验证签名：${feedPath}\n先上传 ${path.basename(archive)}，验证下载后最后上传 appcast.xml。`);
