import { algorithmsInAction } from "./algorithms-in-action";
import { blogPlatform } from "./blog-platform";
import { consistencyChoices } from "./consistency-choices";
import { dinnerRush } from "./dinner-rush";
import { goGlobal } from "./go-global";
import { keyValueStore } from "./key-value-store";
import { linkShortener } from "./link-shortener";
import { liveAnalytics } from "./live-analytics";
import { liveScores } from "./live-scores";
import { orderEvents } from "./order-events";
import { outageDetective } from "./outage-detective";
import { pastebin } from "./pastebin";
import { placeAnOrder } from "./place-an-order";
import { photoFeed } from "./photo-feed";
import { productCatalogue } from "./product-catalogue";
import { splitTheShop } from "./split-the-shop";
import { stopAScraper } from "./stop-a-scraper";
import { tripHistory } from "./trip-history";
import { uploadPipeline } from "./upload-pipeline";
import type { Lab } from "./types";

export const LABS: Lab[] = [pastebin, productCatalogue, photoFeed, dinnerRush, blogPlatform, liveScores, uploadPipeline, stopAScraper, tripHistory, linkShortener, splitTheShop, outageDetective, consistencyChoices, keyValueStore, orderEvents, placeAnOrder, liveAnalytics, goGlobal, algorithmsInAction];

/** Labs on the roadmap - contributions welcome (see docs/writing-labs.md). */
export const UPCOMING = [
  { title: "Chat with delivery ticks", product: "Messaging", tags: ["WebSockets", "pub/sub", "ordering"] },
  { title: "A ticket booking system", product: "Event tickets", tags: ["locking", "holds", "payments"] },
  { title: "A ranked news feed", product: "Social", tags: ["fan-out", "hot keys", "counters"] },
  { title: "A video platform", product: "Video", tags: ["object storage", "transcoding", "CDN"] },
  { title: "Who's online", product: "Presence", tags: ["heartbeats", "pub/sub"] },
  { title: "A payments ledger", product: "Payments", tags: ["idempotency", "sagas", "outbox"] },
  { title: "Ride dispatch", product: "Maps", tags: ["geo indexes", "streams"] },
];

export const labBySlug = (slug: string) => LABS.find((l) => l.slug === slug);
export type { Lab, LabStep } from "./types";
