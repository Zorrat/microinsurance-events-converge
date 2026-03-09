import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants as fsConstants, cp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
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

type PreparedWorkflowWorkspace =
  | { ok: true; projectRoot: string; workflowPath: string }
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

const getPlatformBunPackageNames = (): string[] => {
  const names: string[] = [];
  if (process.platform === "linux" && process.arch === "x64") {
    names.push("@oven/bun-linux-x64");
  } else if (process.platform === "linux" && process.arch === "arm64") {
    names.push("@oven/bun-linux-aarch64");
  } else if (process.platform === "darwin" && process.arch === "x64") {
    names.push("@oven/bun-darwin-x64");
  } else if (process.platform === "darwin" && process.arch === "arm64") {
    names.push("@oven/bun-darwin-aarch64");
  } else if (process.platform === "win32" && process.arch === "x64") {
    names.push("@oven/bun-windows-x64");
  }
  names.push("bun");
  return names;
};

const buildBunBinaryCandidates = (bunInstallRoot: string): string[] => {
  const candidates = [
    path.join(bunInstallRoot, "node_modules", ".bin", "bun"),
    path.join(bunInstallRoot, "node_modules", "bun", "bin", "bun.exe"),
    path.join(bunInstallRoot, "node_modules", "@oven", "bun-linux-x64", "bin", "bun"),
    path.join(bunInstallRoot, "node_modules", "@oven", "bun-linux-aarch64", "bin", "bun"),
    path.join(bunInstallRoot, "node_modules", "@oven", "bun-darwin-x64", "bin", "bun"),
    path.join(bunInstallRoot, "node_modules", "@oven", "bun-darwin-aarch64", "bin", "bun"),
    path.join(bunInstallRoot, "node_modules", "@oven", "bun-windows-x64", "bin", "bun.exe"),
    path.join(bunInstallRoot, "bin", "bun"),
  ];
  return candidates;
};

const installBunRuntime = async (env: NodeJS.ProcessEnv): Promise<{ ok: true; env: NodeJS.ProcessEnv } | { ok: false; error: string }> => {
  const bunInstallRoot = path.join(os.tmpdir(), "cre-bun-runtime");
  const bunScriptBinDir = path.join(bunInstallRoot, "bin");
  const bunScriptBinaryUnix = path.join(bunScriptBinDir, "bun");
  const bunScriptBinaryWin = path.join(bunScriptBinDir, "bun.exe");
  const bunBinaryCandidates = buildBunBinaryCandidates(bunInstallRoot);

  for (const candidate of bunBinaryCandidates) {
    if (await isExecutable(candidate)) {
      return { ok: true, env: prependPath(env, path.dirname(candidate)) };
    }
  }
  if (await isExecutable(bunScriptBinaryUnix)) {
    return { ok: true, env: prependPath(env, bunScriptBinDir) };
  }
  if (await isExecutable(bunScriptBinaryWin)) {
    return { ok: true, env: prependPath(env, bunScriptBinDir) };
  }

  // Preferred path: install platform-specific Bun package to keep /tmp usage low.
  const npmBin = await findExecutableInPath("npm", env);
  if (npmBin) {
    const bunVersion = "1.3.0";
    const npmCacheDir = path.join(bunInstallRoot, ".npm-cache");
    const npmInstallEnv = {
      ...env,
      NPM_CONFIG_CACHE: npmCacheDir,
      npm_config_cache: npmCacheDir,
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
      npm_config_progress: "false",
    };
    const installTargets = getPlatformBunPackageNames().map((name) => `${name}@${bunVersion}`);
    let lastInstallDetails = "";
    for (const target of installTargets) {
      try {
        await execFileAsync(
          npmBin,
          [
            "install",
            "--no-audit",
            "--no-fund",
            "--no-save",
            "--no-package-lock",
            "--prefer-online",
            "--install-strategy=shallow",
            "--omit=dev",
            "--ignore-scripts",
            "--prefix",
            bunInstallRoot,
            target,
          ],
          {
            cwd: process.cwd(),
            env: npmInstallEnv,
            timeout: 180000,
            maxBuffer: serverConfig.creLocalMaxBufferBytes,
            windowsHide: true,
          },
        );
      } catch (error) {
        const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        const details = [toSnippet(String(execError.stderr || "")), toSnippet(String(execError.stdout || ""))]
          .filter(Boolean)
          .join(" | ");
        if (details && details.includes("ENOSPC")) {
          return { ok: false, error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_NPM_INSTALL_ENOSPC:${details}` };
        }
        if (details) {
          lastInstallDetails = details;
        }
        continue;
      }

      for (const candidate of bunBinaryCandidates) {
        if (await isExecutable(candidate)) {
          try {
            await rm(npmCacheDir, { recursive: true, force: true });
          } catch {
            // ignore cache cleanup failures
          }
          return { ok: true, env: prependPath(env, path.dirname(candidate)) };
        }
      }
    }

    if (lastInstallDetails) {
      return {
        ok: false,
        error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_NPM_INSTALL:${lastInstallDetails}`,
      };
    }
    return { ok: false, error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_NPM_INSTALL_NO_BINARY" };
  }

  // Fallback path: bun.sh installer (requires unzip in environment).
  const installEnv = prependPath({ ...env, BUN_INSTALL: bunInstallRoot }, bunScriptBinDir);
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

  if (!(await isExecutable(bunScriptBinaryUnix)) && !(await isExecutable(bunScriptBinaryWin))) {
    return { ok: false, error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:BUN_NOT_FOUND_AFTER_INSTALL" };
  }

  return { ok: true, env: prependPath(env, bunScriptBinDir) };
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

const workflowCompilerPath = (workflowRoot: string): string =>
  path.join(workflowRoot, "node_modules", ".bin", "cre-compile");

const workflowPluginPath = (workflowRoot: string): string =>
  path.join(
    workflowRoot,
    "node_modules",
    "@chainlink",
    "cre-sdk-javy-plugin",
    "dist",
    "javy-chainlink-sdk.plugin.wasm",
  );

const prepareWorkflowWorkspace = async (
  projectRoot: string,
  workflowPath: string,
  env: NodeJS.ProcessEnv,
): Promise<PreparedWorkflowWorkspace> => {
  const sourceWorkflowRoot = path.resolve(projectRoot, workflowPath);
  const relativeWorkflowPath = path.relative(projectRoot, sourceWorkflowRoot);
  if (!relativeWorkflowPath || relativeWorkflowPath.startsWith("..")) {
    return {
      ok: false,
      error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_PATH_OUTSIDE_PROJECT:${sourceWorkflowRoot}`,
    };
  }

  if (await isExecutable(workflowCompilerPath(sourceWorkflowRoot))) {
    return { ok: true, projectRoot, workflowPath };
  }

  const runtimeBase = path.join(os.tmpdir(), "cre-workflow-runtime");
  const runtimeProjectRoot = path.join(runtimeBase, "workflows");
  const runtimeWorkflowRoot = path.join(runtimeProjectRoot, relativeWorkflowPath);

  // Reuse warmed runtime workspace whenever available.
  if (await isExecutable(workflowCompilerPath(runtimeWorkflowRoot))) {
    return { ok: true, projectRoot: runtimeProjectRoot, workflowPath: relativeWorkflowPath };
  }

  try {
    await rm(runtimeProjectRoot, { recursive: true, force: true });
    await mkdir(runtimeBase, { recursive: true });
    await cp(projectRoot, runtimeProjectRoot, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_COPY:${message}`,
    };
  }

  const npmBin = await findExecutableInPath("npm", env);
  if (!npmBin) {
    return {
      ok: false,
      error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_DEPS_NPM_NOT_FOUND",
    };
  }

  const npmCacheDir = path.join(runtimeBase, ".npm-cache");
  const npmEnv = {
    ...env,
    NPM_CONFIG_CACHE: npmCacheDir,
    npm_config_cache: npmCacheDir,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_progress: "false",
  };

  try {
    await execFileAsync(
      npmBin,
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--no-save",
        "--no-package-lock",
        "--prefer-online",
        "--install-strategy=shallow",
        "--omit=dev",
        "--ignore-scripts",
        "--prefix",
        runtimeWorkflowRoot,
      ],
      {
        cwd: process.cwd(),
        env: npmEnv,
        timeout: 180000,
        maxBuffer: serverConfig.creLocalMaxBufferBytes,
        windowsHide: true,
      },
    );
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const details = [toSnippet(String(execError.stderr || "")), toSnippet(String(execError.stdout || ""))]
      .filter(Boolean)
      .join(" | ");
    if (details && details.includes("ENOSPC")) {
      return {
        ok: false,
        error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_DEPS_INSTALL_ENOSPC:${details}`,
      };
    }
    if (details) {
      return {
        ok: false,
        error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_DEPS_INSTALL:${details}`,
      };
    }
    return {
      ok: false,
      error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_DEPS_INSTALL",
    };
  } finally {
    try {
      await rm(npmCacheDir, { recursive: true, force: true });
    } catch {
      // ignore cache cleanup failures
    }
  }

  if (!(await isExecutable(workflowCompilerPath(runtimeWorkflowRoot)))) {
    return {
      ok: false,
      error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_DEPS_MISSING_CRE_COMPILE",
    };
  }

  if (!(await isExecutable(workflowPluginPath(runtimeWorkflowRoot)))) {
    const bunBin = await findExecutableInPath("bun", env);
    if (!bunBin) {
      return {
        ok: false,
        error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_SETUP_MISSING_BUN",
      };
    }
    try {
      await execFileAsync(bunBin, ["x", "cre-setup"], {
        cwd: runtimeWorkflowRoot,
        env,
        timeout: 120000,
        maxBuffer: serverConfig.creLocalMaxBufferBytes,
        windowsHide: true,
      });
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      const details = [toSnippet(String(execError.stderr || "")), toSnippet(String(execError.stdout || ""))]
        .filter(Boolean)
        .join(" | ");
      if (details) {
        return {
          ok: false,
          error: `CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_SETUP_CRESETUP:${details}`,
        };
      }
      return {
        ok: false,
        error: "CRE_TRIGGER_FAILED:SIMULATION_RUNTIME_SETUP_FAILED:WORKFLOW_SETUP_CRESETUP",
      };
    }
  }

  return { ok: true, projectRoot: runtimeProjectRoot, workflowPath: relativeWorkflowPath };
};

const runSimulation = async (input: WorkflowInput): Promise<WorkflowResult> => {
  const configuredProjectRoot = path.resolve(process.cwd(), serverConfig.creLocalProjectRoot);
  const cliCandidates = buildCliCandidates(serverConfig.creLocalCliBin);
  const pathError = await ensureSimulationPaths(configuredProjectRoot, serverConfig.creLocalWorkflowPath);
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
  const preparedWorkspace = await prepareWorkflowWorkspace(
    configuredProjectRoot,
    serverConfig.creLocalWorkflowPath,
    execEnv,
  );
  if (!preparedWorkspace.ok) {
    await cleanupCliHome();
    await cleanup();
    return asError(preparedWorkspace.error);
  }
  const projectRoot = preparedWorkspace.projectRoot;
  const workflowPath = preparedWorkspace.workflowPath;

  const args = [
    "workflow",
    "simulate",
    workflowPath,
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
