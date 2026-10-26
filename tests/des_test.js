// Verify the extension's pure-JS DES-ECB against Node's crypto.
const fs = require("fs");
const crypto = require("crypto");

const src = fs.readFileSync("/home/z/my-project/workspace/Zen-extensions/sources/zen-jiosaavn/index.js", "utf8");

// Extract the DES module code (from "var DES = (function" to "function desDecryptUrl")
const start = src.indexOf("var DES = (function () {");
const end = src.indexOf("function desDecryptUrl");
if (start < 0 || end < 0) { console.error("DES block not found"); process.exit(1); }
const desCode = src.slice(start, end);

// Evaluate in a sandbox with log stub
const sandboxLog = { debug: () => {}, info: () => {}, error: () => {} };
const factory = new Function("log", desCode + "; return DES;");
const DES = factory(sandboxLog);

// Test vectors generated with Node's own des-ecb (key "38346591")
const KEY = Buffer.from("38346591", "utf8");
function nodeEncrypt(plaintext) {
    const cipher = crypto.createCipheriv("des-ecb", KEY, Buffer.alloc(0));
    cipher.setAutoPadding(true); // PKCS5
    return Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]).toString("hex").toUpperCase();
}

const testUrls = [
    "https://aac.saavncdn.com/806/8a2a3ca74fe0a4a2995e34a5b6bbd9c1_96.mp4",
    "https://aac.saavncdn.com/267/59e6ea41f7894d9f8c4fca0ebbdcbdb9_96.mp4",
    "https://aac.saavncdn.com/adb2bdae/img/song/abcdefghijklmnop_96.mp4?expire=1699999999"
];

let pass = 0, fail = 0;
for (const url of testUrls) {
    const hex = nodeEncrypt(url);
    const jsDecoded = DES.decrypt(hex, "38346591");
    if (jsDecoded === url) { pass++; console.log("PASS:", url.slice(0, 60)); }
    else { fail++; console.log("FAIL: expected", url, "got", jsDecoded); }
}

// Multi-block payload (any real JioSaavn ciphertext spans 2+ blocks)
const long = "https://aac.saavncdn.com/" + "x".repeat(100) + "_96.mp4";
const hex2 = nodeEncrypt(long);
if (DES.decrypt(hex2, "38346591") === long) { pass++; console.log("PASS: long multi-block url"); }
else { fail++; console.log("FAIL: long multi-block url"); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
