import { spawn } from "node:child_process";
const child = spawn(
  "npx",
  ["expo", "start", "--dev-client", "--localhost", "--port", "8087"],
  {
    cwd: "apps/mobile",
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: "--dns-result-order=ipv4first",
      DEVELOPER_DIR:
        process.env.DEVELOPER_DIR ??
        "/Applications/Xcode.app/Contents/Developer",
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
