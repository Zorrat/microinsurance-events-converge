import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import type { WorkflowInput, WorkflowResult } from "@/app/lib/cre-types";
import { workflowResultSchema } from "@/app/lib/validation";

import { serverConfig } from "./env";

const execFileAsync = promisify(execFile);

const asError = (error: string): WorkflowResult => ({ ok: false, error });

let queue: Promise<void> = Promise.resolve();

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

const extractResultJson = (stdout: string): unknown | null => {
  const normalized = stripAnsi(stdout);
  const lines = normalized.split(/\r?\n/);
  const marker = "Workflow Simulation Result:";

  let markerLine = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.includes(marker)) {
      markerLine = i;
      break;
    }
  }
  if (markerLine < 0) return null;

  const lineWithMarker = lines[markerLine] ?? "";
  const markerIndex = lineWithMarker.indexOf(marker);
  const inline = lineWithMarker.slice(markerIndex + marker.length).trim();

  const candidates: string[] = [];
  if (inline) candidates.push(inline);

  const afterMarker = lines.slice(markerLine + 1);
  for (let end = afterMarker.length; end >= 1; end -= 1) {
    const candidate = afterMarker.slice(0, end).join("\n").trim();
    if (candidate) candidates.push(candidate);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  return null;
};

const runSimulation = async (input: WorkflowInput): Promise<WorkflowResult> => {
  const projectRoot = path.resolve(process.cwd(), serverConfig.creLocalProjectRoot);
  const envFile = path.resolve(process.cwd(), serverConfig.creLocalEnvFile);

  const args = [
    "workflow",
    "simulate",
    serverConfig.creLocalWorkflowPath,
    "--project-root",
    projectRoot,
    "--env",
    envFile,
    "--target",
    serverConfig.creLocalTarget,
    "--non-interactive",
    "--trigger-index",
    String(serverConfig.creLocalTriggerIndex),
    "--http-payload",
    JSON.stringify(input),
  ];
  if (serverConfig.creLocalBroadcast) {
    args.push("--broadcast");
  }

  try {
    const { stdout } = await execFileAsync(serverConfig.creLocalCliBin, args, {
      cwd: process.cwd(),
      timeout: serverConfig.creLocalTimeoutMs,
      maxBuffer: serverConfig.creLocalMaxBufferBytes,
      windowsHide: true,
    });

    const parsed = extractResultJson(stdout);
    if (!parsed) return asError("CRE_TRIGGER_FAILED:SIMULATION_NO_RESULT");

    const validated = workflowResultSchema.safeParse(parsed);
    if (!validated.success) return asError("CRE_TRIGGER_FAILED:SIMULATION_INVALID_RESULT");

    return validated.data;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stdout?: string };
    const maybeStdout = execError.stdout ? String(execError.stdout) : "";
    const parsed = maybeStdout ? extractResultJson(maybeStdout) : null;
    if (parsed) {
      const validated = workflowResultSchema.safeParse(parsed);
      if (validated.success) return validated.data;
    }

    if (execError.code === "ETIMEDOUT" || execError.killed || execError.signal === "SIGTERM") {
      return asError("CRE_TRIGGER_FAILED:SIMULATION_TIMEOUT");
    }

    if (typeof execError.code === "number") {
      return asError(`CRE_TRIGGER_FAILED:SIMULATION_EXIT_${execError.code}`);
    }

    if (execError.code === "ENOENT") {
      return asError("CRE_TRIGGER_FAILED:SIMULATION_EXEC_ERROR:CRE_CLI_NOT_FOUND");
    }

    const message = execError.message || String(error);
    return asError(`CRE_TRIGGER_FAILED:SIMULATION_EXEC_ERROR:${message}`);
  }
};

export const executeWorkflowSimulation = (input: WorkflowInput): Promise<WorkflowResult> =>
  enqueue(() => runSimulation(input));
