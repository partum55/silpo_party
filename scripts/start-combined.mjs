import { spawn } from "node:child_process";
import path from "node:path";

const publicPort = process.env.PORT ?? "10000";
const agentPort = process.env.AGENT_PORT ?? "4111";
const agentUrl = `http://127.0.0.1:${agentPort}`;
const children = [];
let stopping = false;
let exitCode = 0;

function launch(entry, args, env) {
  const child = spawn(entry, args, { env, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Child process exited unexpectedly (code=${code}, signal=${signal}).`);
      exitCode = code ?? 1;
      shutdown("SIGTERM");
    }
    if (children.every((process) => process.exitCode !== null || process.signalCode !== null)) {
      process.exit(exitCode);
    }
  });
  return child;
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const agent = launch(
  process.execPath,
  [path.resolve("apps/agent/.mastra/output/index.mjs")],
  { ...process.env, PORT: agentPort },
);

for (let attempt = 0; attempt < 60; attempt += 1) {
  if (agent.exitCode !== null || agent.signalCode !== null) process.exit(agent.exitCode ?? 1);
  try {
    const response = await fetch(`${agentUrl}/health`);
    if (response.ok) break;
  } catch {
    // The agent is still starting.
  }
  if (attempt === 59) {
    console.error("Mastra did not become healthy within 30 seconds.");
    exitCode = 1;
    shutdown("SIGTERM");
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!stopping) {
  launch(
    process.execPath,
    [path.resolve("node_modules/next/dist/bin/next"), "start"],
    {
      ...process.env,
      PORT: publicPort,
      HOSTNAME: "0.0.0.0",
      AGENT_URL: agentUrl,
    },
  );
}
