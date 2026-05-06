const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@react-native",
  "debugger-shell",
  "dist",
  "node",
  "index.js",
);

if (!fs.existsSync(target)) {
  console.log(
    "[patch-expo-debugger] target not found, skipping:",
    target,
  );
  process.exit(0);
}

const stub = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unstable_prepareDebuggerShell = async function () {
  return { code: "success" };
};
exports.unstable_spawnDebuggerShellWithArgs = async function () {
  return undefined;
};
`;

const current = fs.readFileSync(target, "utf8");
if (current === stub) {
  console.log("[patch-expo-debugger] already patched");
  process.exit(0);
}

fs.writeFileSync(target, stub);
console.log("[patch-expo-debugger] stubbed @react-native/debugger-shell");
