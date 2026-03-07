import {
  EVMClient,
  HTTPCapability,
  HTTPClient,
  Runner,
  decodeJson,
  getNetwork,
  handler,
  type HTTPPayload,
  type Runtime,
} from "@chainlink/cre-sdk";

import { handleClaim } from "./src/actions/claim";
import { handleMint } from "./src/actions/mint";
import { handleQuoteCheck } from "./src/actions/quote";
import type { Config, WorkflowInput, WorkflowResult } from "./src/types";

export const initWorkflow = (config: Config) => {
  const http = new HTTPCapability();
  const trigger = http.trigger({ authorizedKeys: config.authorizedKeys });

  return [
    handler(trigger, async (runtime: Runtime<Config>, payload: HTTPPayload): Promise<WorkflowResult> => {
      try {
        if (config.authorizedKeys.length === 0) {
          runtime.log("authorizedKeys empty: simulation-only; deployment requires configured keys");
        }
        const input = decodeJson(payload.input) as WorkflowInput;
        const network = getNetwork({
          chainFamily: config.chainFamily,
          chainSelectorName: config.chainSelectorName,
          isTestnet: config.isTestnet,
        });
        if (!network) return { ok: false, error: "Network not found in getNetwork()" };

        const httpClient = new HTTPClient();
        const evm = new EVMClient(network.chainSelector.selector);

        if (input.action === "QUOTE_CHECK") return handleQuoteCheck(runtime, httpClient, evm, input, config);
        if (input.action === "MINT") return handleMint(runtime, httpClient, evm, input, config);
        if (input.action === "CLAIM") return handleClaim(runtime, httpClient, evm, input, config);

        return { ok: false, error: "Unknown action" };
      } catch (e: any) {
        return { ok: false, error: e?.message ?? "WORKFLOW_FAILED" };
      }
    }),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
