import {
  HTTPClient,
  consensusIdenticalAggregation,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";

import type { Config, EventSummary } from "../types";
import { parseTimestampSec } from "../utils";
import { getSecretValue } from "./secrets";

export const normalizeEventbriteEvent = (payload: any): EventSummary => {
  const event = payload?.event ?? payload;

  const rawStatus = event?.status ?? event?.event_status ?? event?.state ?? undefined;

  // Eventbrite event object includes UTC datetime strings under start/end.
  const eventStart =
    parseTimestampSec(event?.start?.utc) ??
    parseTimestampSec(event?.start?.local) ??
    parseTimestampSec(event?.start_at) ??
    parseTimestampSec(event?.start_time);

  const eventEnd =
    parseTimestampSec(event?.end?.utc) ??
    parseTimestampSec(event?.end?.local) ??
    parseTimestampSec(event?.end_at) ??
    parseTimestampSec(event?.end_time);

  const normalizedStatus = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
  const canceled =
    normalizedStatus === "canceled" ||
    normalizedStatus === "cancelled" ||
    Boolean(event?.canceled_at) ||
    Boolean(event?.cancelled_at);

  const parsedCapacity =
    typeof event?.capacity === "number"
      ? event.capacity
      : typeof event?.capacity === "string" && Number.isFinite(Number(event.capacity))
        ? Number(event.capacity)
        : undefined;

  const salesStatus =
    typeof event?.event_sales_status?.sales_status === "string"
      ? event.event_sales_status.sales_status
      : typeof event?.sales_status === "string"
        ? event.sales_status
        : undefined;

  // CRE consensus value encoding rejects undefined values. Build the object
  // with only defined fields.
  const summary: EventSummary = { canceled };

  const eventId = typeof event?.id === "string" ? event.id : undefined;
  const eventName =
    typeof event?.name?.text === "string"
      ? event.name.text
      : typeof event?.name === "string"
        ? event.name
        : undefined;
  const eventUrl = typeof event?.url === "string" ? event.url : undefined;
  const onlineEvent = typeof event?.online_event === "boolean" ? event.online_event : undefined;

  if (eventId !== undefined) summary.eventId = eventId;
  if (eventName !== undefined) summary.eventName = eventName;
  if (eventUrl !== undefined) summary.eventUrl = eventUrl;
  if (parsedCapacity !== undefined) summary.capacity = parsedCapacity;
  if (onlineEvent !== undefined) summary.onlineEvent = onlineEvent;
  if (salesStatus !== undefined) summary.salesStatus = salesStatus;
  if (eventStart !== undefined) summary.eventStart = eventStart;
  if (eventEnd !== undefined) summary.eventEnd = eventEnd;
  if (rawStatus !== undefined) summary.rawStatus = rawStatus;

  return summary;
};

export const fetchEventbriteEvent = (
  runtime: Runtime<Config>,
  httpClient: HTTPClient,
  eventId: string,
  config: Config,
): EventSummary => {
  const token = getSecretValue(runtime, config.eventbriteApiTokenSecretName, config);

  const getEvent = httpClient.sendRequest(
    runtime,
    (sendRequester: HTTPSendRequester, eid: string): EventSummary => {
      const base = config.eventbriteApiBaseUrl.replace(/\/$/, "");
      const url = `${base}/events/${encodeURIComponent(eid)}/`;

      const res = sendRequester
        .sendRequest({
          url,
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        })
        .result();

      if (res.statusCode !== 200) {
        throw new Error(`Eventbrite get event failed: status=${res.statusCode}`);
      }

      const text = new TextDecoder().decode(res.body);
      return normalizeEventbriteEvent(JSON.parse(text));
    },
    consensusIdenticalAggregation<EventSummary>(),
  );

  return getEvent(eventId).result();
};
