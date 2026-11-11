// Builds two isolated copies with a local signed feed. Never opens Doubao or writes /Applications.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.DOUBAO_UPDATE_QA_DIR || "/tmp/doustyle-updater-qa";
if (existsSync(dir)) throw Error("QA目录已存在，请保留证据或移走后再运行");
mkdirSync(dir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keyFile = path.join(dir, "test-signing.key");
writeFileSync(keyFile, privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64"), { mode: 0o600 });
const publicText = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
const sign = path.join(root, ".cache/sparkle-2.9.6/bin/sign_update");
const appName = "DouStyle Update QA.app";
for (const [folder, version] of [["installed", "1.0.7"], ["new", "1.0.8"]]) {
  const app = path.join(dir, folder, appName);
  run("/usr/bin/ditto", [path.join(root, "build/app/豆Style.app"), app]);
  const plist = path.join(app, "Contents/Info.plist");
  for (const [key, value] of Object.entries({ CFBundleName: "DouStyle Update QA", CFBundleDisplayName: "DouStyle Update QA",
    CFBundleIdentifier: "local.doubao.style.update-qa", CFBundleVersion: version, CFBundleShortVersionString: version,
    SUFeedURL: "http://127.0.0.1:18379/appcast.xml", SUPublicEDKey: publicText, SUEnableAutomaticChecks: "false", LSUIElement: "false" })) {
    run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  }
  run("/usr/libexec/PlistBuddy", ["-c", "Add :NSAppTransportSecurity dict", plist]);
  run("/usr/libexec/PlistBuddy", ["-c", "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true", plist]);
  const resources = path.join(app, "Contents/Resources");
  writeFileSync(path.join(resources, "launch.sh"), '#!/bin/bash\nRESOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$RESOURCE_DIR/runtime/node" "$RESOURCE_DIR/qa-child.mjs"\n');
  writeFileSync(path.join(resources, "qa-child.mjs"), `import fs from 'node:fs';
import {createInterface} from 'node:readline';
const dir=${JSON.stringify(dir)};
fs.appendFileSync(dir+'/events.log','boot '+process.env.DOUBAO_APP_VERSION+'\\n');
createInterface({input:process.stdin}).on('line',line=>fs.appendFileSync(dir+'/events.log',line+'\\n'));
process.stdout.write('ready\\n');
const trigger=dir+'/check';
fs.watchFile(trigger,{interval:250},()=>{if(fs.existsSync(trigger)){process.stdout.write('check\\n');}});
process.on('SIGTERM',()=>process.exit(0));
`);
  run("/usr/bin/codesign", ["--force", "--sign", "-", app]);
}
const archive = path.join(dir, "DouStyle-QA-1.0.8.zip");
run("/usr/bin/ditto", ["-c", "-k", "--keepParent", path.join(dir, "new", appName), archive]);
const signature = run(sign, ["--ed-key-file", keyFile, "-p", archive]).trim();
writeFileSync(path.join(dir, "appcast.xml"), `<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>豆Style 更新验证</title><item><title>豆Style 1.0.8</title><sparkle:version>1.0.8</sparkle:version><sparkle:shortVersionString>1.0.8</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.5</sparkle:minimumSystemVersion><description>本地更新测试：验证下载、安装与自动重启。</description><enclosure url="http://127.0.0.1:18379/DouStyle-QA-1.0.8.zip" length="${statSync(archive).size}" type="application/octet-stream" sparkle:edSignature="${signature}" /></item></channel></rss>`);
run(sign, ["--ed-key-file", keyFile, path.join(dir, "appcast.xml")]);
const server = createServer((req, res) => {
  const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
  console.log(req.method, name);
  if (!["appcast.xml", "DouStyle-QA-1.0.8.zip"].includes(name)) { res.writeHead(404).end(); return; }
  const bytes = readFileSync(path.join(dir, name));
  res.writeHead(200, { "Content-Length": bytes.length, "Content-Type": name.endsWith(".xml") ? "application/xml" : "application/zip" });
  res.end(bytes);
});
server.listen(18379, "127.0.0.1", () => console.log(`QA ready: ${dir}/installed/${appName}\n触发检查：在 ${dir}/check 创建空文件`));
