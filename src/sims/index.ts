import { bloom, countMin, hyperloglog, merkle, skipList, tokenBucket } from "./algorithms";
import { cacheStampede } from "./cache-stampede";
import { geohashSim, snowflake } from "./geo-ids";
import { lsmBtree, wal } from "./storage";
import { gossip, raft } from "./consensus";
import { eventWindows } from "./event-windows";
import { hashRing } from "./hash-ring";
import { kafkaLog } from "./kafka-log";
import { pushVsPoll } from "./push-vs-poll";
import { quorum } from "./quorum";
import { retryStorm } from "./retry-storm";
import { saga } from "./saga";
import { serviceChain } from "./service-chain";
import type { SimDef } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SIMS: SimDef<any, any>[] = [
  cacheStampede, pushVsPoll, serviceChain, retryStorm, quorum, hashRing, kafkaLog, saga, eventWindows,
  bloom, hyperloglog, countMin, merkle, gossip, raft, tokenBucket, skipList, lsmBtree, geohashSim, snowflake, wal,
];

export const simById = (id: string) => SIMS.find((s) => s.id === id);
export const simsForLesson = (lesson: string) => SIMS.filter((s) => s.lessons.includes(lesson));
export type { Goal, SimDef } from "./types";
