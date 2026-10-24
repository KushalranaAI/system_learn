import { build } from "../presets";
import type { Lab } from "./types";

export const pastebin: Lab = {
  slug: "pastebin",
  module: 2,
  title: "Build a pastebin",
  product: "Text sharing",
  summary: "Paste text, get a private link. Design the API and ids, then build and scale the simplest system that works.",
  difficulty: "easy",
  minutes: 25,
  tags: ["API design", "data modelling", "scale up"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `Anyone can paste text (up to 1 MB), get a link, and share it.

**Functional:** create a paste · read a paste by its link · pastes can expire.

**Non-functional:** reads p99 under 100 ms · links must not be guessable · ~100 reads per create.`,
    },
    {
      type: "api",
      title: "Design the API",
      body: "One endpoint to create a paste, one to read it.",
      baseUrl: "https://paste.example",
      expect: [
        { goal: "Create a paste", methods: ["POST"], statuses: [201, 200], why: "Creating a paste is a POST that answers 201 Created (200 is acceptable)." },
        { goal: "Read a paste", methods: ["GET"], statuses: [200], needsParam: true, why: "Reading is a GET on a path with the paste id as a parameter (like /pastes/:id), answered with 200 OK." },
      ],
    },
    {
      type: "quiz",
      title: "Choosing the id",
      body: "Every paste needs an id that goes in its link.",
      question: "Which id scheme fits a pastebin where pastes may be private?",
      options: [
        { text: "Auto-increment: 1, 2, 3, …", why: "Anyone can walk /pastes/1, /pastes/2, … and read every paste. Sequential ids leak data and volume." },
        { text: "8 random base62 characters", correct: true, why: "Right. 62⁸ ≈ 2 × 10¹⁴ possibilities: short, unguessable, and any server can generate one. Retry on the rare collision." },
        { text: "A hash of the paste content", why: "Identical pastes would share a link, and anyone who can guess the content can find the link." },
      ],
    },
    {
      type: "design",
      title: "Launch: 200 reads a second",
      body: "Build the smallest system that works: code to handle requests, and somewhere durable to keep the pastes.",
      starter: build({ nodes: [["client", "client"]], wires: "" }),
      test: {
        traffic: { reads: 200, writes: 2, bots: 0 },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "p99", maxMs: 100 }, { type: "uses", kind: "server" }, { type: "uses", kind: "db" }],
      },
      hints: ["You need an API server to run the code.", "Pastes must survive restarts, so they go in a database.", "Wire Client → API server → Database."],
      solution: build({ nodes: [["client", "client"], ["api", "server"], ["db", "db"]], wires: "client>api, api>db" }),
    },
    {
      type: "design",
      title: "6,000 reads a second on $300",
      body: "A popular forum starts linking to your pastes. Before adding new boxes, try the cheapest fix: bigger machines.",
      test: {
        traffic: { reads: 6000, writes: 60, bots: 0 },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "p99", maxMs: 80 }, { type: "budget", maxUsd: 300 }],
      },
      hints: [
        "Look at which card is red, then select it.",
        "Every server and database has a machine size in the inspector.",
        "A 4 vCPU server and a 4 vCPU database leave headroom and fit the budget.",
      ],
      solution: build({ nodes: [["client", "client"], ["api", "server", { size: "m" }], ["db", "db", { size: "m" }]], wires: "client>api, api>db" }),
    },
  ],
};
