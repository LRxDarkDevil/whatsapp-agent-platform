import { chmod } from "node:fs/promises";

try {
  await chmod(new URL("../dist/cli.js", import.meta.url), 0o755);
} catch {
  // Windows does not use the executable bit.
}

