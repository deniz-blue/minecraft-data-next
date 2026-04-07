import { access, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const vendorDir = path.join(rootDir, "vendor");
const upstreamDir = path.join(vendorDir, "minecraft-data");
const upstreamUrl = "https://github.com/PrismarineJS/minecraft-data.git";

function run(command: string, args: string[], cwd = rootDir): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

await mkdir(vendorDir, { recursive: true });

if (!(await exists(path.join(rootDir, ".gitmodules")))) {
  await run("git", ["submodule", "add", upstreamUrl, upstreamDir]);
}

await run("git", ["submodule", "sync", "--", upstreamDir]);
await run("git", ["submodule", "update", "--init", "--remote", "--recursive", "--", upstreamDir]);
