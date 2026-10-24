import type { Lab } from "./types";

export const consistencyChoices: Lab = {
  slug: "consistency-choices",
  module: 13,
  title: "Pick the right consistency",
  product: "Global social app",
  summary: "A social app runs in three regions. For each feature, choose replication, quorums and conflict handling - no stronger (or weaker) than it needs.",
  difficulty: "hard",
  minutes: 20,
  tags: ["CAP", "quorums", "Raft", "CRDTs", "read-your-writes"],
  steps: [
    {
      type: "intro",
      title: "The app",
      body: `A social app with users in India, Europe and the Americas, running in three regions.

Features: usernames, profile edits, posts and comments, like counts, direct messages, and a shared "group notes" editor.

For each step, pick the design that is **correct and no more expensive than necessary**.`,
    },
    {
      type: "quiz",
      title: "Unique usernames",
      body: "Two people in different regions try to claim the username 'asha' at the same moment.",
      question: "How should username claims be handled?",
      options: [
        { text: "Each region accepts claims locally and syncs later with last-write-wins", why: "Both would be told 'success', then one silently loses their name. Uniqueness needs a single decision." },
        { text: "Claims go through a single consensus-backed (linearizable) store", correct: true, why: "Right. Uniqueness is a global constraint - one place must decide. Claims are rare, so the extra cross-region latency is acceptable." },
        { text: "Use a leaderless store with W=1, R=1", why: "That's eventually consistent - both claims could succeed." },
      ],
    },
    {
      type: "quiz",
      title: "Profile edits",
      body: "Users edit their bio and expect to see the change on refresh. Others seeing it a second later is fine.",
      question: "What's the cheapest correct guarantee?",
      options: [
        { text: "Linearizable reads for everyone", why: "Correct but expensive: every profile view worldwide would pay for strong reads." },
        { text: "Read-your-writes: the editor reads from the home leader for a few seconds", correct: true, why: "Right. The author always sees their change; everyone else reads nearby replicas with a little lag." },
        { text: "Eventual consistency with no session guarantee", why: "The author might refresh and see their old bio - exactly the bug users report." },
      ],
    },
    {
      type: "quiz",
      title: "Comment threads",
      body: "Replies must never appear before the comment they answer, but a few seconds' delay is fine.",
      question: "Which consistency model is the weakest one that's still correct?",
      options: [
        { text: "Eventual", why: "Too weak: a reply could arrive at a region before its parent comment and show up orphaned." },
        { text: "Causal", correct: true, why: "Right. Causal consistency preserves 'reply after parent' without forcing a global order on unrelated comments." },
        { text: "Linearizable", why: "Correct, but much stronger (and slower) than this feature needs." },
      ],
    },
    {
      type: "quiz",
      title: "Like counts",
      body: "Millions of likes per minute, from every region. Counts may be approximate and a few seconds old.",
      question: "How should likes be counted across regions?",
      options: [
        { text: "One global row incremented through the leader", why: "A single hot row across regions - slow and contended." },
        { text: "A per-region counter merged as a CRDT (G-Counter)", correct: true, why: "Right. Each region counts locally; merging takes per-region maxima and sums them. Always converges, never loses increments." },
        { text: "Last-write-wins on the total", why: "Concurrent increments in different regions would overwrite each other and lose likes." },
      ],
    },
    {
      type: "quiz",
      title: "Quorum settings",
      body: "Direct messages are stored in a leaderless database with N=3 replicas per key. Writes must survive one replica being down, and reads must see the latest acknowledged message.",
      question: "Which W and R?",
      options: [
        { text: "W=1, R=1", why: "1 + 1 is not > 3 - reads may miss the latest message." },
        { text: "W=2, R=2", correct: true, why: "Right. Writes work with one replica down, and 2 + 2 > 3 guarantees every read overlaps the latest write's replicas." },
        { text: "W=3, R=1", why: "Reads are fast, but any single replica being down makes every write fail." },
      ],
    },
    {
      type: "quiz",
      title: "Group notes",
      body: "Team members edit the same note at the same time, sometimes offline on planes.",
      question: "How should concurrent edits be merged?",
      options: [
        { text: "Last-write-wins on the whole note", why: "One person's edits would vanish whenever two people edit at once." },
        { text: "A sequence CRDT (like Yjs or Automerge)", correct: true, why: "Right. Every character has a unique position id, so concurrent and offline edits merge the same way on every device - no lost work, no central lock." },
        { text: "A global lock: one editor at a time", why: "It doesn't work offline, and it makes collaboration painful." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: quorums with a node down",
      body: "Three replicas, one of them down, 50 ms mean replication lag, and the user reads 10 ms after writing. Get stale reads to (almost) zero while both reads and writes keep working.",
      sim: "quorum",
      params: { n: 3, down: 1 },
      locked: ["n", "down", "lagMs", "readAfterMs"],
      goals: [
        { metric: "stale", op: "<=", value: 0.001, label: "Stale reads ≤ 0.1%" },
        { metric: "writeAvail", op: ">=", value: 0.99, label: "Writes available" },
        { metric: "readAvail", op: ">=", value: 0.99, label: "Reads available" },
      ],
      hints: ["With W=1 and R=1, a read often asks the replica that hasn't got the write yet.", "Make W + R greater than N.", "With one of three down, W and R can be at most 2."],
      solution: { w: 2, r: 2 },
    },
    {
      type: "sim",
      title: "Measure it: five replicas, two down",
      body: "Now N = 5 and two replicas are down. Keep reads fresh and both paths available.",
      sim: "quorum",
      params: { n: 5, down: 2, w: 1, r: 1 },
      locked: ["n", "down", "lagMs", "readAfterMs"],
      goals: [
        { metric: "stale", op: "<=", value: 0.001, label: "Stale reads ≤ 0.1%" },
        { metric: "writeAvail", op: ">=", value: 0.99, label: "Writes available" },
        { metric: "readAvail", op: ">=", value: 0.99, label: "Reads available" },
      ],
      hints: ["W + R must exceed 5.", "Only 3 replicas are alive, so neither W nor R may exceed 3."],
      solution: { w: 3, r: 3 },
    },
  ],
};
