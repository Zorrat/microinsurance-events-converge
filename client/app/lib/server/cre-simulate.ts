import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants as fsConstants, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
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
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();
const toSnippet = (value: string, max = 320): string => {
  const normalized = normalizeWhitespace(stripAnsi(value));
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
};

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

type PreparedEnvFile =
  | { ok: true; envFile: string; cleanup: () => Promise<void> }
  | { ok: false; error: string };

type PreparedCliHome =
  | { ok: true; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }
  | { ok: false; error: string };

const escapeEnvValue = (value: string): string => JSON.stringify(value);

const prepareRuntimeEnvFile = async (): Promise<PreparedEnvFile> => {
  const required = ["EVENTBRITE_API_TOKEN", "QUOTE_SIGNER_PK"];
  if (serverConfig.creLocalBroadcast) {
    required.push("CRE_ETH_PRIVATE_KEY");
  }

  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `CRE_TRIGGER_FAILED:SIMULATION_MISSING_ENV:${missing.join(",")}`,
    };
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!ENV_KEY_PATTERN.test(key)) continue;
    if (typeof value !== "string") continue;
    lines.push(`${key}=${escapeEnvValue(value)}`);
  }

  const envFile = path.join(os.tmpdir(), `cre-sim-${randomUUID()}.env`);
  try {
    await writeFile(envFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `CRE_TRIGGER_FAILED:SIMULATION_ENV_WRITE_ERROR:${message}` };
  }

  return {
    ok: true,
    envFile,
    cleanup: async () => {
      try {
        await unlink(envFile);
      } catch {
        // ignore cleanup failures
      }
    },
  };
};

const prepareSimulationEnvFile = async (): Promise<PreparedEnvFile> => {
  if (serverConfig.creLocalEnvFromProcess || !serverConfig.creLocalEnvFile) {
    return prepareRuntimeEnvFile();
  }

  const envFile = path.resolve(process.cwd(), serverConfig.creLocalEnvFile);
  try {
    await access(envFile);
  } catch {
    return { ok: false, error: `CRE_TRIGGER_FAILED:SIMULATION_ENV_FILE_NOT_FOUND:${envFile}` };
  }

  return { ok: true, envFile, cleanup: async () => undefined };
};

const decodeCredentialsBase64 = (value: string): string | null => {
  try {
    const normalized = value.trim();
    if (!normalized) return null;
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    if (!decoded.trim()) return null;
    return decoded;
  } catch {
    return null;
  }
};

const prepareCliHome = async (): Promise<PreparedCliHome> => {
  const credentialsB64 = serverConfig.creLocalCredentialsBase64;
  if (!credentialsB64) {
    return { ok: true, env: process.env, cleanup: async () => undefined };
  }

  const credentialsYaml = decodeCredentialsBase64(credentialsB64);
  if (!credentialsYaml || !credentialsYaml.includes("RefreshToken:")) {
    return { ok: false, error: "CRE_TRIGGER_FAILED:SIMULATION_AUTH_INVALID_CREDENTIALS_BASE64" };
  }

  const homeRoot = path.join(os.tmpdir(), `cre-home-${randomUUID()}`);
  const creDir = path.join(homeRoot, ".cre");
  const credsFile = path.join(creDir, "cre.yaml");

  try {
    await mkdir(creDir, { recursive: true, mode: 0o700 });
    await writeFile(credsFile, credentialsYaml.endsWith("\n") ? credentialsYaml : `${credentialsYaml}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `CRE_TRIGGER_FAILED:SIMULATION_AUTH_WRITE_ERROR:${message}` };
  }

  return {
    ok: true,
    env: { ...process.env, HOME: homeRoot },
    cleanup: async () => {
      try {
        await rm(homeRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    },
  };
};

const ensureSimulationPaths = async (projectRoot: string, workflowPath: string): Promise<string | null> => {
  try {
    await access(projectRoot, fsConstants.R_OK);
  } catch {
    return `CRE_TRIGGER_FAILED:SIMULATION_PATH_NOT_FOUND:PROJECT_ROOT:${projectRoot}`;
  }

  const workflowRoot = path.resolve(projectRoot, workflowPath);
  try {
    await access(workflowRoot, fsConstants.R_OK);
  } catch {
    return `CRE_TRIGGER_FAILED:SIMULATION_PATH_NOT_FOUND:WORKFLOW:${workflowRoot}`;
  }

  const projectYaml = path.resolve(projectRoot, "project.yaml");
  try {
    await access(projectYaml, fsConstants.R_OK);
  } catch {
    return `CRE_TRIGGER_FAILED:SIMULATION_PATH_NOT_FOUND:PROJECT_YAML:${projectYaml}`;
  }

  return null;
};

const resolveCliBin = (value: string): string => {
  if (!value.includes("/") && !value.includes("\\")) return value;
  return path.resolve(process.cwd(), value);
};

const prependPath = (env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv => {
  const currentPath = env.PATH || process.env.PATH || "";
  const parts = currentPath ? currentPath.split(path.delimiter).filter(Boolean) : [];
  if (!parts.includes(dir)) {
    parts.unshift(dir);
  }
  return { ...env, PATH: parts.join(path.delimiter) };
};

const buildCliCandidates = (configured: string): string[] => {
  const candidates: string[] = [];
  const pushUnique = (value: string | undefined) => {
    if (!value) return;
    const resolved = resolveCliBin(value);
    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  pushUnique(configured);
  pushUnique("./.cre/bin/cre");
  if (process.env.HOME) {
    pushUnique(path.join(process.env.HOME, ".cre/bin/cre"));
    pushUnique(path.join(process.env.HOME, ".local/bin/cre"));
  }
  return candidates;
};

const withLocalToolPath = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  return prependPath(env, path.resolve(process.cwd(), ".cre/bin"));
};

const isExecutable = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const findExecutableInPath = async (binName: string, env: NodeJS.ProcessEnv): Promise<string | null> => {
  const currentPath = env.PATH || process.env.PATH || "";
  const dirs = currentPath.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binName);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
};

const installBunRuntime = async (env: NodeJS.ProcessEnv): Promise<{ ok: true; env: NodeJS.ProcessEnv } | { ok: false; error: string }> => {
  const bunInstallRoot = path.join(os.tmpdir(), "cre-bun-runtime");
  const bunBinDir = path.join(bunInstallRoot, "bin");
  const bunBinary = path.join(bunBinDir, "bun");

  if (await isExecutable(bunBinary)) {
    return { ok: true, env: prependPath(env, bunBinDir) };
  }

  const installEnv = prependPath({ ...env, BUN_INSTALL: bunInstallRoot }, bunBinDir);
  try {
    await execFileAsync("bash", ["-lc", "set -euo pipefail; curl -fsSL https://bun.sh/install | bash"], {
      cwd: process.cwd(),
      env: installEnv,
      timeout: 180000,
      maxBuffer: serverConfig.creLocalMaxBufferBytes,
      windowsHide: true,
    });
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const details = [toSnippet(String(execError.stderr || "")), toSnippet(String(execError.stdout || ""))]
      .filter(Boolean)
      .join(" | ");
    if (details) {
      return { ok: false, error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_INSTALL:${details}` };
    }
    return { ok: false, error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_INSTALL" };
  }

  if (!(await isExecutable(bunBinary))) {
    return { ok: false, error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_NOT_FOUND_AFTER_INSTALL" };
  }

  return { ok: true, env: prependPath(env, bunBinDir) };
};

const prepareExecutionEnv = async (
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true; env: NodeJS.ProcessEnv } | { ok: false; error: string }> => {
  const withLocalPath = withLocalToolPath(env);
  if (await findExecutableInPath("bun", withLocalPath)) {
    return { ok: true, env: withLocalPath };
  }
  return installBunRuntime(withLocalPath);
};

const runSimulation = async (input: WorkflowInput): Promise<WorkflowResult> => {
  const projectRoot = path.resolve(process.cwd(), serverConfig.creLocalProjectRoot);
  const cliCandidates = buildCliCandidates(serverConfig.creLocalCliBin);
  const pathError = await ensureSimulationPaths(projectRoot, serverConfig.creLocalWorkflowPath);
  if (pathError) return asError(pathError);

  const preparedEnv = await prepareSimulationEnvFile();
  if (!preparedEnv.ok) return asError(preparedEnv.error);
  const preparedCliHome = await prepareCliHome();
  if (!preparedCliHome.ok) {
    await preparedEnv.cleanup();
    return asError(preparedCliHome.error);
  }

  const { envFile, cleanup } = preparedEnv;
  const { env: cliEnv, cleanup: cleanupCliHome } = preparedCliHome;
  const preparedExecEnv = await prepareExecutionEnv(cliEnv);
  if (!preparedExecEnv.ok) {
    await cleanupCliHome();
    await cleanup();
    return asError(preparedExecEnv.error);
  }
  const execEnv = preparedExecEnv.env;

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
    for (const cliBin of cliCandidates) {
      try {
        const { stdout } = await execFileAsync(cliBin, args, {
          cwd: process.cwd(),
          env: execEnv,
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
        const execError = error as NodeJS.ErrnoException & {
          killed?: boolean;
          signal?: string;
          stdout?: string;
          stderr?: string;
        };
        const maybeStdout = execError.stdout ? String(execError.stdout) : "";
        const maybeStderr = execError.stderr ? String(execError.stderr) : "";
        const parsed = maybeStdout ? extractResultJson(maybeStdout) : null;
        if (parsed) {
          const validated = workflowResultSchema.safeParse(parsed);
          if (validated.success) return validated.data;
        }

        if (execError.code === "ENOENT") {
          continue;
        }

        if (execError.code === "ETIMEDOUT" || execError.killed || execError.signal === "SIGTERM") {
          return asError("CRE_TRIGGER_FAILED:SIMULATION_TIMEOUT");
        }

        const stderrSnippet = toSnippet(maybeStderr);
        const stdoutSnippet = toSnippet(maybeStdout);
        const details = [stderrSnippet, stdoutSnippet].filter(Boolean).join(" | ");

        if (typeof execError.code === "number") {
          if (details) {
            return asError(`CRE_TRIGGER_FAILED:SIMULATION_EXIT_${execError.code}:${details}`);
          }
          return asError(`CRE_TRIGGER_FAILED:SIMULATION_EXIT_${execError.code}`);
        }

        const baseMessage = execError.message || String(error);
        const message = details ? `${baseMessage}:${details}` : baseMessage;
        return asError(`CRE_TRIGGER_FAILED:SIMULATION_EXEC_ERROR:${message}`);
      }
    }
    return asError("CRE_TRIGGER_FAILED:SIMULATION_EXEC_ERROR:CRE_CLI_NOT_FOUND");
  } finally {
    await cleanupCliHome();
    await cleanup();
  }
};

export const executeWorkflowSimulation = (input: WorkflowInput): Promise<WorkflowResult> =>
  enqueue(() => runSimulation(input));
