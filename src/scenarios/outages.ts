import { build, type Preset } from "../presets";

/** Famous outages: the design reflects the original weakness, and Run replays the failure. */
export const OUTAGES: Preset[] = [
  {
    id: "out-cloudflare-2025",
    title: "Cloudflare: the feature file that doubled",
    source: "Cloudflare · Nov 2025",
    blurb: "A generated config file grew past a hard limit and crashed the core proxy everywhere at once.",
    lesson: "24.2",
    story: `On 18 November 2025 at 11:20 UTC, much of the web started returning Cloudflare 5xx errors.

**What happened:**
- At 11:05 a permissions change to a ClickHouse cluster made a second set of tables (in the \`r0\` database) visible. A query that builds the **Bot Management feature file** didn't filter by database, so it returned duplicate rows and the file roughly **doubled**.
- The file is regenerated every five minutes and pushed to every machine. The bot module preallocates room for **200 features** (about 60 are normally used). The new proxy (FL2) hit the limit and **panicked**; every request through it failed. The older proxy (FL) didn't crash but gave every request a bot score of zero.
- Only some ClickHouse nodes had the change at first, so good and bad files alternated and the errors came and went - it looked like an attack.
- Core traffic was largely back by 14:30 after a known-good file was pushed; everything was normal at 17:06. Workers KV, Access, Turnstile and the dashboard were hit too.

**On the canvas:** one API server node = the whole FL2 proxy fleet, worldwide. Behind it, the edge cache and customers' origins. Running the incident kills the proxy: a single global tier with nothing to fail over to.`,
    tryThis: [
      "Run the incident. With one global proxy tier, what share of requests survive?",
      "Add a second proxy server (the old FL path) behind the load balancer and turn on health checks. Run it again.",
      "With two proxies, is each big enough to carry everything alone?",
      "Read lesson 24.2: which guard rail on the config pipeline would have stopped the file before it shipped?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: false }],
        ["proxy", "server", { size: "2xl" }],
        ["edgecache", "cache", { hitRatio: 0.6 }],
        ["origin", "db", { size: "l" }],
      ],
      wires: "client>lb, lb>proxy, proxy>edgecache, proxy>origin",
    }),
    traffic: { reads: 25_000, writes: 500, bots: 0 },
    incident: { type: "nodeDown", nodeId: "proxy" },
  },
  {
    id: "out-cloudflare-2019",
    title: "Cloudflare: one regular expression",
    source: "Cloudflare · Jul 2019",
    blurb: "A new WAF rule backtracked catastrophically and pinned every HTTP CPU worldwide for 27 minutes.",
    lesson: "24.3",
    story: `On 2 July 2019 at 13:42 UTC, Cloudflare deployed a new rule to its Web Application Firewall managed rules.

**What happened:**
- The rule contained a regular expression with nested \`.*\` patterns. On some inputs it **backtracked catastrophically**, and every CPU core handling HTTP/HTTPS traffic across the network went to 100%.
- WAF rules were pushed to every machine worldwide within seconds - **no staged rollout** - because the process was built for fast response to new attacks.
- Traffic dropped by about 82% at the worst point. Engineers used a "global kill" for the WAF managed rules at 14:07 and traffic recovered; the outage lasted about 27 minutes.
- Cloudflare later switched to regex engines with run-time guarantees and added staged rollouts and CPU protection for rules.

**On the canvas:** one API server node = the HTTP/WAF processing on every edge machine. Running the incident takes it down, as a pinned CPU effectively did.`,
    tryThis: [
      "Run the incident. How many requests get through?",
      "Model a staged rollout: add a second edge server (the PoPs that haven't received the rule) behind the load balancer with health checks on.",
      "How big must the second server be to carry everything during the bad 27 minutes?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: false }],
        ["waf", "server", { size: "2xl" }],
        ["edgecache", "cache", { hitRatio: 0.7 }],
        ["origin", "db", { size: "l" }],
      ],
      wires: "client>lb, lb>waf, waf>edgecache, waf>origin",
    }),
    traffic: { reads: 30_000, writes: 400, bots: 0 },
    incident: { type: "nodeDown", nodeId: "waf" },
  },
  {
    id: "out-crowdstrike-2024",
    title: "CrowdStrike: 8.5 million blue screens",
    source: "CrowdStrike · Jul 2024",
    blurb: "One content update crashed every Windows host that received it in the same hour. No staged rollout.",
    lesson: "24.4",
    story: `On 19 July 2024 at 04:09 UTC, CrowdStrike shipped a content update (Channel File 291) to its Falcon sensor on Windows.

**What happened:**
- The update added detection rules for a template type that expected **21 input fields**, but the sensor supplied only 20. Reading the 21st was an **out-of-bounds memory read** inside a kernel driver, and Windows crashed - then crashed again on every reboot.
- Rapid Response Content went to all online hosts at once; a bug in the content validator let the bad file through. There was **no staged rollout** for this kind of update.
- CrowdStrike reverted the file at 05:27 UTC, but crashed machines had to be fixed by hand (boot to safe mode, delete the file), often with BitLocker recovery keys. Microsoft estimated **8.5 million devices** were affected: airlines, hospitals, banks and broadcasters went down.

**On the canvas:** a customer's system, e.g. an airline's check-in. One API server node = every Windows host running the sensor - they all received the update together. The incident takes them down.`,
    tryThis: [
      "Run the incident. What's left when every host gets the same update at once?",
      "Model rings: split the fleet into two servers behind a load balancer with health checks (a canary ring and the rest). Kill only the canary.",
      "How small can the canary ring be and still catch the crash before the rest update?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["hosts", "server", { size: "xl" }],
        ["cache", "cache", { hitRatio: 0.7 }],
        ["db", "db", { size: "l" }],
      ],
      wires: "client>hosts, hosts>cache, hosts>db",
    }),
    traffic: { reads: 15_000, writes: 800, bots: 0 },
    incident: { type: "nodeDown", nodeId: "hosts" },
  },
  {
    id: "out-aws-dns-2025",
    title: "AWS us-east-1: an empty DNS record",
    source: "AWS · Oct 2025",
    blurb: "A race in DynamoDB's DNS automation left its regional endpoint resolving to nothing; everything built on it followed.",
    lesson: "24.5",
    story: `On 19-20 October 2025, AWS's us-east-1 region had a long, cascading outage.

**What happened (AWS summary):**
- DynamoDB's DNS is managed by automation: a **DNS Planner** produces plans and **DNS Enactors** in three availability zones apply them.
- One Enactor was badly delayed applying an old plan. Meanwhile another applied a newer plan and then ran clean-up, deleting old plans - including the one the slow Enactor had just applied. The regional endpoint \`dynamodb.us-east-1.amazonaws.com\` was left with an **empty DNS record**.
- From 11:48 PM PDT, nothing could resolve DynamoDB - including AWS's own services. DNS was restored at 2:25 AM.
- The cascade continued: EC2's droplet lease manager (which uses DynamoDB) went into congestive collapse, new instances lacked network state, and Network Load Balancer health checks failed. Full recovery came at 2:20 PM PDT, about 14.5 hours after the start.

**On the canvas:** the API servers are services running in us-east-1; the database node is DynamoDB in the region. The incident takes it down, and there is no second region.`,
    tryThis: [
      "Run the incident. Reads that hit the cache survive - what about writes?",
      "Add a replica database (another region) wired to every server, turn on automatic failover, and run it again.",
      "Turn retries off: does the failure get better or worse?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["svc1", "server", { size: "l" }],
        ["svc2", "server", { size: "l" }],
        ["svc3", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.6 }],
        ["dynamodb", "db", { size: "xl" }],
      ],
      wires: "client>lb, lb>svc1, lb>svc2, lb>svc3, svc1>cache, svc2>cache, svc3>cache, svc1>dynamodb, svc2>dynamodb, svc3>dynamodb",
    }),
    traffic: { reads: 30_000, writes: 3_000, bots: 0 },
    incident: { type: "nodeDown", nodeId: "dynamodb" },
  },
  {
    id: "out-s3-2017",
    title: "AWS S3: one mistyped command",
    source: "AWS · Feb 2017",
    blurb: "A playbook command removed too many servers, taking S3's index subsystem down for hours in us-east-1.",
    lesson: "24.6",
    story: `On 28 February 2017 at 9:37 AM PST, an engineer debugging slow S3 billing ran an established playbook command to remove a small number of servers.

**What happened (AWS summary):**
- One input was entered incorrectly and a **much larger set of servers** was removed - including servers for the **index subsystem** (metadata and location of every object in the region) and the **placement subsystem** (where new objects go).
- Both needed a full restart. They hadn't been fully restarted in the larger regions for many years, and the restart with safety checks took far longer than expected. GETs, LISTs, PUTs and DELETEs failed in us-east-1 for about four hours; the index was fully back at 1:18 PM and placement at 1:54 PM.
- The AWS Service Health Dashboard itself depended on S3, so for a while it couldn't show the outage.
- AWS changed the tool to remove capacity more slowly and refuse to go below a minimum.

**On the canvas:** the API servers are S3's front end; the database node is the index subsystem; the cache holds recently used index entries. The incident removes the index.`,
    tryThis: [
      "Run the incident. Which requests still succeed, and why so few?",
      "Add a replica of the index and turn on automatic failover. How long until writes recover?",
      "Run \"Cache restart\" instead: the index survives but every lookup is cold. Is the index big enough?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["fe1", "server", { size: "l" }],
        ["fe2", "server", { size: "l" }],
        ["hot", "cache", { hitRatio: 0.5 }],
        ["index", "db", { size: "l" }],
      ],
      wires: "client>lb, lb>fe1, lb>fe2, fe1>hot, fe2>hot, fe1>index, fe2>index",
    }),
    traffic: { reads: 24_000, writes: 2_000, bots: 0 },
    incident: { type: "nodeDown", nodeId: "index" },
  },
  {
    id: "out-facebook-bgp-2021",
    title: "Facebook: the internet forgot Facebook",
    source: "Facebook · Oct 2021",
    blurb: "A backbone command cut every data centre off; DNS servers then withdrew their own routes. Six hours dark.",
    lesson: "24.7",
    story: `On 4 October 2021, Facebook, Instagram, WhatsApp and Messenger disappeared from the internet for about six hours.

**What happened (Facebook engineering):**
- During routine maintenance, a command meant to assess the capacity of the global **backbone** network unintentionally took down all backbone connections. An audit tool that should have blocked it had a bug.
- Facebook's DNS servers are built to **withdraw their BGP route** advertisements when they can't reach the data centres - a sensible health check. Now every one did it at once, so the rest of the internet could no longer find facebook.com at all.
- With the network down, the internal tools engineers would normally use were down too. People had to go to data centres physically, where security systems slowed access by design.
- Bringing traffic back had to be gradual: turning everything on at once could overload power and caches.

**On the canvas:** the load balancer node = the edge (DNS + backbone) that every request enters through. The servers and databases behind it are healthy. The incident takes the edge down.`,
    tryThis: [
      "Run the incident. The data centres are fine - why does nothing succeed?",
      "Run \"Cache restart\" on the healthy design: what does bringing everything back at once do to the database?",
      "Read lesson 24.7: what would out-of-band access have changed about the six hours?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["edge", "lb", { healthChecks: true }],
        ["web1", "server", { size: "xl" }],
        ["web2", "server", { size: "xl" }],
        ["tao", "cache", { hitRatio: 0.9 }],
        ["db", "db", { size: "l" }],
        ["rep", "db", { size: "l", role: "replica" }],
      ],
      wires: "client>edge, edge>web1, edge>web2, web1>tao, web2>tao, web1>db, web2>db, web1>rep, web2>rep",
    }),
    traffic: { reads: 40_000, writes: 2_000, bots: 0 },
    incident: { type: "nodeDown", nodeId: "edge" },
  },
  {
    id: "out-gitlab-2017",
    title: "GitLab: deleting the database",
    source: "GitLab · Jan 2017",
    blurb: "Under spam load, replication broke; while fixing it, an engineer wiped the primary. Five backup methods failed.",
    lesson: "24.8",
    story: `On 31 January 2017, GitLab.com was down for about 18 hours and lost about six hours of data.

**What happened (GitLab postmortem):**
- Spammers caused heavy database load, and replication to the secondary fell behind until it stopped.
- While re-seeding the secondary late at night, an engineer ran \`rm -rf\` on the data directory - on the **primary** (db1) instead of the secondary (db2). About 300 GB was removed before he stopped it.
- Then the backups: \`pg_dump\` had been silently failing (a version mismatch), and its failure emails were rejected; disk snapshots weren't enabled for the database servers; the replica was unusable. A manual LVM snapshot taken about six hours earlier saved them.
- Lost: roughly 5,000 projects, 5,000 comments and 700 new user accounts. GitLab live-streamed the recovery.

**On the canvas:** a primary and a replica that's no use for failover; bots stand for the spam. The incident removes the primary, and automatic failover is off - as it effectively was.`,
    tryThis: [
      "Run the incident. Why do some reads fail too, not just writes?",
      "Turn on automatic failover (Resilience) and run it again.",
      "Add a rate limiter in front for the spam. Does the database have more headroom?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["web1", "server", { size: "l" }],
        ["web2", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.6 }],
        ["db1", "db", { size: "l" }],
        ["db2", "db", { size: "l", role: "replica" }],
      ],
      wires: "client>lb, lb>web1, lb>web2, web1>cache, web2>cache, web1>db1, web2>db1, web1>db2, web2>db2",
    }),
    traffic: { reads: 12_000, writes: 800, bots: 3_000 },
    incident: { type: "nodeDown", nodeId: "db1" },
    resilience: { retries: true, dbFailover: false },
  },
  {
    id: "out-github-2018",
    title: "GitHub: 43 seconds, 24 hours",
    source: "GitHub · Oct 2018",
    blurb: "A 43-second network cut triggered a cross-country database failover, and writes split between two coasts.",
    lesson: "24.9",
    story: `On 21 October 2018, GitHub was degraded for 24 hours and 11 minutes.

**What happened (GitHub postmortem):**
- During routine maintenance to replace failing 100G optical equipment, the US East Coast network hub lost connectivity to the primary East Coast data centre for **43 seconds**.
- Orchestrator, which manages MySQL topology, saw the East primaries as gone and **promoted replicas on the West Coast**. When the network came back, the East Coast databases held a few seconds of writes that the West Coast didn't have.
- Applications now talked to databases across the country, adding latency. GitHub chose **data integrity over availability**: it stayed degraded, restored from backups, re-synced, and then reconciled the orphaned writes by hand.

**On the canvas:** the East primary and a West replica. The incident takes the primary down with failover on: writes fail during detection, then the replica takes over. The real lesson is what happens to the writes the West never saw.`,
    tryThis: [
      "Run the incident with failover on. How long do writes fail before the promotion?",
      "Turn failover off. Is it better to be down, or to be up with diverged data?",
      "Read lesson 24.9: when would you rather wait than fail over across regions?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["app1", "server", { size: "l" }],
        ["app2", "server", { size: "l" }],
        ["app3", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.8 }],
        ["east", "db", { size: "xl" }],
        ["west", "db", { size: "xl", role: "replica" }],
      ],
      wires: "client>lb, lb>app1, lb>app2, lb>app3, app1>cache, app2>cache, app3>cache, app1>east, app2>east, app3>east, app1>west, app2>west, app3>west",
    }),
    traffic: { reads: 30_000, writes: 3_000, bots: 0 },
    incident: { type: "nodeDown", nodeId: "east" },
    resilience: { retries: true, dbFailover: true },
  },
  {
    id: "out-roblox-2021",
    title: "Roblox: 73 hours down",
    source: "Roblox · Oct 2021",
    blurb: "Consul, which everything used to find everything, slowed to a halt - and the tools to debug it depended on it too.",
    lesson: "24.10",
    story: `From 28 to 31 October 2021, Roblox was down for **73 hours**.

**What happened (Roblox postmortem):**
- Roblox ran its own infrastructure, with **HashiCorp Consul** for service discovery, health checks and key-value config. Nearly every service needed Consul, and so did Vault and Nomad.
- A new Consul **streaming** feature, enabled shortly before for better performance, caused heavy contention under the high read and write load of the day.
- At the same time Consul's storage (BoltDB) hit a pathological case: its **freelist** had grown huge, so every write spent long periods scanning it.
- Monitoring and telemetry also depended on Consul, a **circular dependency** that hid the cause. Recovery meant rebuilding the Consul cluster and bringing players back slowly.

**On the canvas:** the cache node = Consul: every request looks something up there first. The database behind it was sized as if Consul never fails. The incident takes Consul down.`,
    tryThis: [
      "Run the incident. Why does a lookup service take everything down?",
      "Make the database big enough to survive without Consul. Is that realistic?",
      "Add a rate limiter and bring traffic back at half: does a slow ramp help?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["game1", "server", { size: "l" }],
        ["game2", "server", { size: "l" }],
        ["consul", "cache", { hitRatio: 0.95 }],
        ["db", "db", { size: "s" }],
      ],
      wires: "client>lb, lb>game1, lb>game2, game1>consul, game2>consul, game1>db, game2>db",
    }),
    traffic: { reads: 24_000, writes: 400, bots: 0 },
    incident: { type: "nodeDown", nodeId: "consul" },
  },
  {
    id: "out-fastly-2021",
    title: "Fastly: one customer's valid config",
    source: "Fastly · Jun 2021",
    blurb: "A latent bug, triggered by one customer's ordinary config change, broke 85% of the network in a minute.",
    lesson: "24.11",
    story: `On 8 June 2021 at 09:47 UTC, big sites (news, government, shops) started showing errors - all Fastly customers.

**What happened (Fastly summary):**
- A software deployment on 12 May had introduced a bug that only triggered with a specific customer configuration under specific circumstances.
- On 8 June one customer pushed a **valid** configuration change that met those circumstances, and **85% of Fastly's network** began returning errors.
- Fastly detected it within one minute, found the config, disabled it, and 95% of the network was back to normal within 49 minutes. The bug fix shipped later that day.

**The pattern:** one global fleet, one shared code path, one input from one tenant. Blast radius is the whole network.

**On the canvas:** the CDN node = Fastly's edge; behind it a customer's origin with two API servers, sized for what the CDN doesn't cache. The incident takes the CDN down.`,
    tryThis: [
      "Run the incident. Why does a healthy origin not help?",
      "Delete the CDN and wire the client straight to the load balancer (failing open to origin). How many servers do you need?",
      "Read lesson 24.11: how would cells have shrunk the blast radius?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["fastly", "cdn", { hitRatio: 0.85 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["cache", "cache", { hitRatio: 0.8 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>fastly, fastly>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db",
    }),
    traffic: { reads: 80_000, writes: 500, bots: 0 },
    incident: { type: "nodeDown", nodeId: "fastly" },
  },
  {
    id: "out-slack-2021",
    title: "Slack: the first Monday back",
    source: "Slack · Jan 2021",
    blurb: "Everyone came back from the holidays with cold caches at once, and the network between tiers didn't scale in time.",
    lesson: "24.12",
    story: `On Monday 4 January 2021 - the first working day of the year - Slack was down for hours.

**What happened (Slack engineering):**
- Clients had been idle over the holidays, so their caches were cold and they pulled more data than usual on reconnect. Traffic jumped sharply.
- An AWS **Transit Gateway** between Slack's network tiers didn't scale fast enough, and packets were dropped.
- Slow network calls made web servers wait: CPU fell (so autoscaling **removed** servers), then thread use spiked (so it tried to **add 1,200 servers** between 7:01 and 7:15 AM PST). The provisioning service hit the Linux open-files limit and an AWS quota, so most new servers never served traffic.
- The 7 AM peak saturated the web tier and Slack went down. It was usable again by about 9:15 AM; AWS raised Transit Gateway capacity and the network was normal by about 10:40 AM.

**On the canvas:** two API servers are the web tier, sized for a normal Monday. The incident is a 2.5x surge (the first Monday back), with client retries on.`,
    tryThis: [
      "Run the surge. Then turn retries off: how much worse did retries make it?",
      "Pre-scale: add web servers before the run. How many make the surge harmless?",
      "Run \"Cache restart\" too: cold caches on top of the surge - what fails first?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["web1", "server", { size: "l" }],
        ["web2", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.8 }],
        ["db", "db", { size: "l" }],
        ["rep", "db", { size: "l", role: "replica" }],
      ],
      wires: "client>lb, lb>web1, lb>web2, web1>cache, web2>cache, web1>db, web2>db, web1>rep, web2>rep",
    }),
    traffic: { reads: 20_000, writes: 1_000, bots: 0 },
    incident: { type: "spike", factor: 2.5 },
    resilience: { retries: true, dbFailover: false },
  },
  {
    id: "out-gcp-2025",
    title: "Google Cloud: a null pointer everywhere",
    source: "Google Cloud · Jun 2025",
    blurb: "A policy with blank fields crashed Service Control in every region; the restart herd then hammered Spanner.",
    lesson: "24.13",
    story: `On 12 June 2025, Google Cloud API calls failed with 503s around the world for hours, and many services built on Google Cloud went down with it.

**What happened (Google incident report):**
- **Service Control** checks authorisation and quota on every Google Cloud API request. On 29 May a new quota-policy check was added - with no feature flag and no handling for bad data. Its code path wasn't exercised during the region-by-region rollout.
- On 12 June (about 10:45 AM PDT) a policy with **unintended blank fields** was written to the Spanner tables that Service Control reads. It replicated **globally within seconds**, hit the null pointer, and Service Control crash-looped in every region.
- The cause was found within 10 minutes and a "red button" was rolled out within about 40 minutes. Most regions recovered within about two hours.
- In **us-central1**, every restarting task hit Spanner at once - with no randomised exponential backoff, a **herd** overloaded it, and recovery there took up to about 2 hours 40 minutes.

**On the canvas:** the API server is Service Control; the cache is its policy cache; the database is Spanner. The incident replays the restart: the cache comes back cold and every task reloads from Spanner at once.`,
    tryThis: [
      "Run the incident with retries on, then off. How much of the pain is the herd?",
      "Make Spanner bigger, or add a replica, so a cold start doesn't overload it.",
      "Set the incident to \"Kill: API server\": that's the crash itself. What would a feature flag have saved?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["sc1", "server", { size: "xl" }],
        ["sc2", "server", { size: "xl" }],
        ["policy", "cache", { hitRatio: 0.95 }],
        ["spanner", "db", { size: "l" }],
      ],
      wires: "client>lb, lb>sc1, lb>sc2, sc1>policy, sc2>policy, sc1>spanner, sc2>spanner",
    }),
    traffic: { reads: 40_000, writes: 500, bots: 0 },
    incident: { type: "cacheFlush" },
    resilience: { retries: true, dbFailover: false },
  },
];
