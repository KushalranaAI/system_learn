import { aiLlmServing } from "./ai-llm-serving";
import { aiRagHelpdesk } from "./ai-rag-helpdesk";
import { aiSupportAgent } from "./ai-support-agent";
import type { Lab } from "./types";

/** Labs for Part 5 (AI system design). */
export const AI_LABS: Lab[] = [aiLlmServing, aiRagHelpdesk, aiSupportAgent];
