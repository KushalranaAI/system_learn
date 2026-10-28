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
import { chatDelivery } from "./chat-delivery";
import { ticketBooking } from "./ticket-booking";
import { rankedFeed } from "./ranked-feed";
import { videoPlatform } from "./video-platform";
import { whosOnline } from "./whos-online";
import { paymentsLedger } from "./payments-ledger";
import { rideDispatch } from "./ride-dispatch";
import { AI_LABS } from "./ai-labs";
import { API_LABS } from "./api-labs";
import type { Lab } from "./types";

export const LABS: Lab[] = [pastebin, productCatalogue, photoFeed, dinnerRush, blogPlatform, liveScores, uploadPipeline, stopAScraper, tripHistory, linkShortener, splitTheShop, outageDetective, consistencyChoices, keyValueStore, orderEvents, placeAnOrder, liveAnalytics, goGlobal, ...API_LABS, algorithmsInAction, chatDelivery, whosOnline, videoPlatform, ticketBooking, rankedFeed, paymentsLedger, rideDispatch, ...AI_LABS];

/** Labs on the roadmap - contributions welcome (see docs/writing-labs.md). */
export const UPCOMING: { title: string; product: string; tags: string[] }[] = [];

export const labBySlug = (slug: string) => LABS.find((l) => l.slug === slug);
export type { Lab, LabStep } from "./types";
