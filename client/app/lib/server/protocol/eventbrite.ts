import type { EventSummary } from "@/app/lib/protocol-types";

import { DEFAULT_EVENTBRITE_API_BASE_URL } from "./defaults";
import { parseTimestampSec } from "./utils";

const parseMaybeNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
};

export const normalizeEventbriteEvent = (payload: unknown): EventSummary => {
  const root = asRecord(payload);
  const event = asRecord(root.event ?? payload);
  const start = asRecord(event.start);
  const end = asRecord(event.end);
  const category = asRecord(event.category);
  const subcategory = asRecord(event.subcategory);
  const organizer = asRecord(event.organizer);
  const description = asRecord(event.description);
  const venue = asRecord(event.venue);
  const venueAddress = asRecord(venue.address);
  const eventSalesStatus = asRecord(event.event_sales_status);

  const rawStatus = event.status ?? event.event_status ?? event.state ?? undefined;
  const eventStart =
    parseTimestampSec(start.utc) ??
    parseTimestampSec(start.local) ??
    parseTimestampSec(event.start_at) ??
    parseTimestampSec(event.start_time);
  const eventEnd =
    parseTimestampSec(end.utc) ??
    parseTimestampSec(end.local) ??
    parseTimestampSec(event.end_at) ??
    parseTimestampSec(event.end_time);

  const normalizedStatus = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
  const canceled =
    normalizedStatus === "canceled" ||
    normalizedStatus === "cancelled" ||
    Boolean(event.canceled_at) ||
    Boolean(event.cancelled_at);

  const parsedCapacity =
    typeof event.capacity === "number"
      ? event.capacity
      : typeof event.capacity === "string" && Number.isFinite(Number(event.capacity))
        ? Number(event.capacity)
        : undefined;

  const salesStatus =
    typeof eventSalesStatus.sales_status === "string"
      ? eventSalesStatus.sales_status
      : typeof event.sales_status === "string"
        ? event.sales_status
        : undefined;

  const summary: EventSummary = { canceled };

  const eventId = typeof event.id === "string" ? event.id : undefined;
  const eventName =
    typeof asRecord(event.name).text === "string"
      ? (asRecord(event.name).text as string)
      : typeof event.name === "string"
        ? event.name
        : undefined;
  const eventUrl = typeof event.url === "string" ? event.url : undefined;
  const onlineEvent = typeof event.online_event === "boolean" ? event.online_event : undefined;
  const categoryId =
    typeof event.category_id === "string"
      ? event.category_id
      : typeof category.id === "string"
        ? category.id
        : undefined;
  const categoryName =
    typeof category.name === "string"
      ? category.name
      : typeof category.short_name === "string"
        ? category.short_name
        : undefined;
  const subcategoryId =
    typeof event.subcategory_id === "string"
      ? event.subcategory_id
      : typeof subcategory.id === "string"
        ? subcategory.id
        : undefined;
  const subcategoryName = typeof subcategory.name === "string" ? subcategory.name : undefined;
  const organizerPastEvents = parseMaybeNumber(organizer.num_past_events);
  const organizerFutureEvents = parseMaybeNumber(organizer.num_future_events);
  const descriptionText =
    typeof description.text === "string"
      ? description.text
      : typeof event.summary === "string"
        ? event.summary
        : undefined;
  const venueName = typeof venue.name === "string" ? venue.name : undefined;
  const venueCity =
    typeof venueAddress.city === "string"
      ? venueAddress.city
      : typeof venueAddress.localized_area_display === "string"
        ? venueAddress.localized_area_display
        : undefined;
  const venueRegion = typeof venueAddress.region === "string" ? venueAddress.region : undefined;
  const venueCountry = typeof venueAddress.country === "string" ? venueAddress.country : undefined;
  const isSeries = typeof event.is_series === "boolean" ? event.is_series : undefined;

  if (eventId !== undefined) summary.eventId = eventId;
  if (eventName !== undefined) summary.eventName = eventName;
  if (eventUrl !== undefined) summary.eventUrl = eventUrl;
  if (parsedCapacity !== undefined) summary.capacity = parsedCapacity;
  if (onlineEvent !== undefined) summary.onlineEvent = onlineEvent;
  if (salesStatus !== undefined) summary.salesStatus = salesStatus;
  if (eventStart !== undefined) summary.eventStart = eventStart;
  if (eventEnd !== undefined) summary.eventEnd = eventEnd;
  if (typeof rawStatus === "string") summary.rawStatus = rawStatus;
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

export const fetchEventbriteEvent = async (
  eventId: string,
  eventbriteApiToken: string,
  baseUrl = DEFAULT_EVENTBRITE_API_BASE_URL,
): Promise<EventSummary> => {
  const expandedFields = encodeURIComponent("category,subcategory,organizer,venue");
  const url = `${baseUrl.replace(/\/$/, "")}/events/${encodeURIComponent(eventId)}/?expand=${expandedFields}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${eventbriteApiToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Eventbrite get event failed: status=${response.status}`);
  }

  return normalizeEventbriteEvent((await response.json()) as unknown);
};
