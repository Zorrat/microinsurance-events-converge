import {
  HTTPClient,
  consensusIdenticalAggregation,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";

import type { Config, EventSummary } from "../types";
import { parseTimestampSec } from "../utils";
import { getSecretValue } from "./secrets";

const parseMaybeNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

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
  const categoryId =
    typeof event?.category_id === "string"
      ? event.category_id
      : typeof event?.category?.id === "string"
        ? event.category.id
        : undefined;
  const categoryName =
    typeof event?.category?.name === "string"
      ? event.category.name
      : typeof event?.category?.short_name === "string"
        ? event.category.short_name
        : undefined;
  const subcategoryId =
    typeof event?.subcategory_id === "string"
      ? event.subcategory_id
      : typeof event?.subcategory?.id === "string"
        ? event.subcategory.id
        : undefined;
  const subcategoryName =
    typeof event?.subcategory?.name === "string"
      ? event.subcategory.name
      : undefined;

  const organizerPastEvents = parseMaybeNumber(event?.organizer?.num_past_events);
  const organizerFutureEvents = parseMaybeNumber(event?.organizer?.num_future_events);
  const descriptionText =
    typeof event?.description?.text === "string"
      ? event.description.text
      : typeof event?.summary === "string"
        ? event.summary
        : undefined;
  const venueName = typeof event?.venue?.name === "string" ? event.venue.name : undefined;
  const venueCity =
    typeof event?.venue?.address?.city === "string"
      ? event.venue.address.city
      : typeof event?.venue?.address?.localized_area_display === "string"
        ? event.venue.address.localized_area_display
        : undefined;
  const venueRegion = typeof event?.venue?.address?.region === "string" ? event.venue.address.region : undefined;
  const venueCountry = typeof event?.venue?.address?.country === "string" ? event.venue.address.country : undefined;
  const isSeries = typeof event?.is_series === "boolean" ? event.is_series : undefined;

  if (eventId !== undefined) summary.eventId = eventId;
  if (eventName !== undefined) summary.eventName = eventName;
  if (eventUrl !== undefined) summary.eventUrl = eventUrl;
  if (parsedCapacity !== undefined) summary.capacity = parsedCapacity;
  if (onlineEvent !== undefined) summary.onlineEvent = onlineEvent;
  if (salesStatus !== undefined) summary.salesStatus = salesStatus;
  if (eventStart !== undefined) summary.eventStart = eventStart;
  if (eventEnd !== undefined) summary.eventEnd = eventEnd;
  if (rawStatus !== undefined) summary.rawStatus = rawStatus;
  if (categoryId !== undefined) summary.categoryId = categoryId;
  if (categoryName !== undefined) summary.categoryName = categoryName;
  if (subcategoryId !== undefined) summary.subcategoryId = subcategoryId;
  if (subcategoryName !== undefined) summary.subcategoryName = subcategoryName;
  if (organizerPastEvents !== undefined) summary.organizerPastEvents = organizerPastEvents;
  if (organizerFutureEvents !== undefined) summary.organizerFutureEvents = organizerFutureEvents;
  if (descriptionText !== undefined) summary.descriptionText = descriptionText;
  if (venueName !== undefined) summary.venueName = venueName;
  if (venueCity !== undefined) summary.venueCity = venueCity;
  if (venueRegion !== undefined) summary.venueRegion = venueRegion;
  if (venueCountry !== undefined) summary.venueCountry = venueCountry;
  if (isSeries !== undefined) summary.isSeries = isSeries;

  return summary;
};

export const fetchEventbriteEvent = (
  runtime: Runtime<Config>,
  httpClient: HTTPClient,
  eventId: string,
  config: Config,
  options?: { baseUrl?: string },
): EventSummary => {
  const token = getSecretValue(runtime, config.eventbriteApiTokenSecretName, config);
  const configuredBaseUrl = options?.baseUrl?.trim() || config.eventbriteApiBaseUrl;

  const getEvent = httpClient.sendRequest(
    runtime,
    (sendRequester: HTTPSendRequester, eid: string): EventSummary => {
      const base = configuredBaseUrl.replace(/\/$/, "");
      const expandedFields = encodeURIComponent("category,subcategory,organizer,venue");
      const url = `${base}/events/${encodeURIComponent(eid)}/?expand=${expandedFields}`;
      runtime.log(`[EVENTBRITE] GET ${url}`);

      const res = sendRequester
        .sendRequest({
          url,
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        })
        .result();
      runtime.log(`[EVENTBRITE] status=${res.statusCode} eventId=${eid}`);

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
