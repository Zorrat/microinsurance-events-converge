import type { Runtime } from "@chainlink/cre-sdk";
import type { Config } from "../types";

export const getSecretValue = (
  runtime: Runtime<Config>,
  id: string,
  config: Config,
): string => {
  const namespace = config.secretsNamespace ?? "env";
  const secret = runtime.getSecret({ id, namespace }).result();
  if (!secret.value) throw new Error(`Missing secret value for ${id}`);
  return secret.value;
};
