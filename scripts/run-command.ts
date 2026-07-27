import { spawn } from "node:child_process";

export async function runCommand(
  command: string,
  args: string[],
  environment = process.env,
): Promise<void> {
  const child = spawn(command, args, {
    env: environment,
    stdio: "inherit",
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}.`);
  }
}
