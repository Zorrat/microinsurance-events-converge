import { randomUUID } from "node:crypto";

import type { WorkflowInput, WorkflowResult } from "@/app/lib/cre-types";
import { workflowResultSchema } from "@/app/lib/validation";

import { createCreJwt } from "./cre-jwt";
import { serverConfig } from "./env";
import { executeWorkflowSimulation } from "./cre-simulate";

type JsonRpcExecuteRequest = {
  id: string;
  jsonrpc: "2.0";
  method: "workflows.execute";
  params: {
    input: WorkflowInput;
    workflow: {
      workflowID: string;
    };
  };
};

type JsonRpcPollRequest = {
  id: string;
  jsonrpc: "2.0";
  method: string;
  params: {
    workflowExecutionID: string;
    workflowID: string;
  };
};

type JsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type CreGatewayResponse = {
  jsonrpc?: string;
  id?: string;
  method?: string;
  result?: unknown;
  error?: JsonRpcError;
};

const asError = (message: string): WorkflowResult => ({ ok: false, error: message });

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
};

const maybeWorkflowResult = (candidate: unknown): WorkflowResult | null => {
  const parsed = workflowResultSchema.safeParse(candidate);
  if (!parsed.success) return null;
  return parsed.data;
};

const extractInlineWorkflowResult = (response: CreGatewayResponse): WorkflowResult | null => {
  const direct = maybeWorkflowResult(response.result);
  if (direct) return direct;

  const result = asRecord(response.result);
  if (!result) return null;

  const inlineKeys = ["output", "response", "data", "workflowResult", "workflow_result"];

  for (const key of inlineKeys) {
    const maybe = maybeWorkflowResult(result[key]);
    if (maybe) return maybe;
  }

  return null;
};

const extractExecutionId = (response: CreGatewayResponse): string | null => {
  const result = asRecord(response.result);
  if (!result) return null;

  const candidates = ["workflow_execution_id", "workflowExecutionId", "execution_id", "executionId"];
  for (const key of candidates) {
    const value = result[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return null;
};

const extractStatus = (response: CreGatewayResponse): string => {
  const result = asRecord(response.result);
  if (!result) return "UNKNOWN";

  const status = result.status;
  if (typeof status === "string" && status.length > 0) return status;

  return "UNKNOWN";
};

const buildExecuteRequest = (input: WorkflowInput): JsonRpcExecuteRequest => ({
  id: randomUUID(),
  jsonrpc: "2.0",
  method: "workflows.execute",
  params: {
    input,
    workflow: {
      workflowID: serverConfig.creWorkflowId,
    },
  },
});

const buildPollRequest = (executionId: string): JsonRpcPollRequest | null => {
  if (!serverConfig.creExecutionPollMethod) return null;

  return {
    id: randomUUID(),
    jsonrpc: "2.0",
    method: serverConfig.creExecutionPollMethod,
    params: {
      workflowExecutionID: executionId,
      workflowID: serverConfig.creWorkflowId,
    },
  };
};

const toGatewayErrorMessage = (response: CreGatewayResponse, status: number): string => {
  if (response.error?.message) {
    return `CRE_TRIGGER_FAILED:${response.error.message}`;
  }

  if (status >= 400) {
    return `CRE_TRIGGER_FAILED:GATEWAY_HTTP_${status}`;
  }

  return "CRE_TRIGGER_FAILED:UNKNOWN_GATEWAY_ERROR";
};

const toNoResultMessage = (response: CreGatewayResponse): string => {
  const status = extractStatus(response);
  const executionId = extractExecutionId(response) || "n/a";

  return `CRE_TRIGGER_FAILED:NO_INLINE_WORKFLOW_RESULT(status=${status},executionId=${executionId})`;
};

const doGatewayRequest = async (
  body: JsonRpcExecuteRequest | JsonRpcPollRequest,
  url: string,
): Promise<{ ok: true; payload: CreGatewayResponse; status: number } | { ok: false; error: string }> => {
  try {
    if (!serverConfig.creSignerPk) {
      return { ok: false, error: "CRE_TRIGGER_FAILED:MISSING_TRIGGER_SIGNER_PK" };
    }
    const { token } = await createCreJwt(body, serverConfig.creSignerPk as `0x${string}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await response.text();

    let payload: CreGatewayResponse;
    try {
      payload = JSON.parse(text) as CreGatewayResponse;
    } catch {
      return { ok: false, error: "CRE_TRIGGER_FAILED:INVALID_GATEWAY_JSON" };
    }

    if (!response.ok || payload.error) {
      return { ok: false, error: toGatewayErrorMessage(payload, response.status) };
    }

    return { ok: true, payload, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `CRE_TRIGGER_FAILED:${message}` };
  }
};

const pollForWorkflowResult = async (executionId: string): Promise<WorkflowResult | null> => {
  if (!serverConfig.creExecutionPollUrl || !serverConfig.creExecutionPollMethod) return null;

  const deadline = Date.now() + serverConfig.crePollMaxMs;

  while (Date.now() <= deadline) {
    const pollRequest = buildPollRequest(executionId);
    if (!pollRequest) return null;

    const pollResponse = await doGatewayRequest(pollRequest, serverConfig.creExecutionPollUrl);
    if (pollResponse.ok) {
      const inlineResult = extractInlineWorkflowResult(pollResponse.payload);
      if (inlineResult) return inlineResult;
    }

    if (Date.now() + serverConfig.crePollIntervalMs > deadline) break;
    await delay(serverConfig.crePollIntervalMs);
  }

  return null;
};

export const executeWorkflow = async (input: WorkflowInput): Promise<WorkflowResult> => {
  if (serverConfig.creExecutionMode === "simulate") {
    return executeWorkflowSimulation(input);
  }
  return executeWorkflowGateway(input);
};

export const executeWorkflowGateway = async (input: WorkflowInput): Promise<WorkflowResult> => {
  if (!serverConfig.creWorkflowId) {
    return asError("CRE_TRIGGER_FAILED:MISSING_WORKFLOW_ID");
  }

  const executeRequest = buildExecuteRequest(input);
  const response = await doGatewayRequest(executeRequest, serverConfig.creGatewayUrl);
  if (!response.ok) {
    return asError(response.error);
  }

  const inlineResult = extractInlineWorkflowResult(response.payload);
  if (inlineResult) {
    return inlineResult;
  }

  const executionId = extractExecutionId(response.payload);
  if (executionId) {
    const polled = await pollForWorkflowResult(executionId);
    if (polled) return polled;
    return asError(`CRE_ACCEPTED:${executionId}`);
  }

  return asError(toNoResultMessage(response.payload));
};
