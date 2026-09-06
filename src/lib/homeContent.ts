export const DO_ROWS = [
  {
    index: "01",
    title: "Ship web3 products that work",
    body: "Six years of contracts, indexers and dApps — the unglamorous part where the numbers have to be right and the thing has to stay up. I take a product from spec to live, not to demo.",
    points: ["Smart contracts, indexers, dashboards", "40+ dApps shipped end to end", "Flow-neutral accounting, verified NAV"],
  },
  {
    index: "02",
    title: "Build AI automation, not AI slop",
    body: "Two years deep in AI engineering: agents and automation systems wired into real workflows, judged on whether they save real hours — not on how impressive the demo looks.",
    points: ["Agent pipelines with real evals", "Automations that replace manual ops", "Open source where it helps others"],
  },
  {
    index: "03",
    title: "Make content that cuts the hype",
    body: "I film the build. What broke, what the data actually said, how to tell a real product from a screenshot. If it helps someone avoid a gimmick, it was worth posting.",
    points: ["Build-in-public threads on X", "Long-form breakdowns on LinkedIn", "Short, visual builds on Instagram"],
  },
] as const;

export const TOOL_FEATURES = [
  "Tracks every Hyperliquid and OKX vault, daily.",
  "Computes flow-neutral NAV, so deposits can't fake the return.",
  "Benchmarks every vault against BTC, ETH and SOL.",
  "Open source — ingestion and storage are public on GitHub.",
] as const;

export const MARQUEE = [
  "6 years in web3",
  "2 years in AI",
  "40+ dApps shipped",
  "open source by default",
  "karachi, pk",
  "building in public",
] as const;

export const CONTACT_ITEMS = [
  {
    name: "Book a call",
    detail: "Calendly · 30 min",
    href: "https://calendly.com/muzammilsiddiqui001/30min",
    external: true,
  },
  { name: "Telegram", detail: "@MuzammilSiddiqui_14", href: "https://t.me/MuzammilSiddiqui_14", external: true },
  { name: "Email", detail: "muzammilsiddiqui001@gmail.com", href: "mailto:muzammilsiddiqui001@gmail.com", external: false },
] as const;

export const CONNECT_LINKS = [
  { name: "Email", handle: "muzammilsiddiqui001@gmail.com", href: "mailto:muzammilsiddiqui001@gmail.com", external: false },
  {
    name: "Book a call",
    handle: "Calendly · 30 min",
    href: "https://calendly.com/muzammilsiddiqui001/30min",
    external: true,
  },
  { name: "Telegram", handle: "@MuzammilSiddiqui_14", href: "https://t.me/MuzammilSiddiqui_14", external: true },
  { name: "X", handle: "@TheWeb3B0Y", href: "https://x.com/TheWeb3B0Y", external: true },
  { name: "LinkedIn", handle: "muzammilsiddiqui001", href: "https://www.linkedin.com/in/muzammilsiddiqui001/", external: true },
  { name: "Instagram", handle: "@theweb3boy", href: "https://www.instagram.com/theweb3boy/", external: true },
] as const;

export const STATS = [
  { value: "6 yrs", label: "in web3", tone: "teal" },
  { value: "40+", label: "dApps shipped", tone: "text" },
  { value: "2 yrs", label: "in AI", tone: "copper" },
] as const;

export const PLATFORMS = [
  {
    key: "x",
    label: "X",
    initial: "𝕏",
    name: "X / Twitter",
    handle: "@TheWeb3B0Y",
    color: "#F4EEE2",
    href: "https://x.com/TheWeb3B0Y",
    cta: "Follow on X",
    format: "build-in-public threads",
    blurb:
      "Where the build happens live — daily progress, the bugs, the data that killed a good idea, and the occasional take on why a vault's screenshot doesn't mean what you think.",
    posts: [
      { kicker: "Thread", title: "Why vault screenshots lie", note: "Flow-neutral NAV, explained with real numbers.", hint: "Drop your thread screenshot" },
      { kicker: "Build log", title: "Shipping youVsBTC in public", note: "From ingestion layer to live dashboard.", hint: "Drop a build-log screenshot" },
      { kicker: "Teardown", title: "Spotting AI slop in 60 seconds", note: "The tells that separate a product from a wrapper.", hint: "Drop a teardown screenshot" },
    ],
  },
  {
    key: "li",
    label: "LinkedIn",
    initial: "in",
    name: "LinkedIn",
    handle: "muzammilsiddiqui001",
    color: "#5FD8C9",
    href: "https://www.linkedin.com/in/muzammilsiddiqui001/",
    cta: "Connect on LinkedIn",
    format: "long-form breakdowns",
    blurb:
      "The longer write-ups: architecture decisions, what six years in web3 taught me about scope, and how I evaluate whether an automation is worth building at all.",
    posts: [
      { kicker: "Case study", title: "How youVsBTC computes honest returns", note: "Time-weighted returns with flows stripped out.", hint: "Drop your post screenshot" },
      { kicker: "Essay", title: "Execution beats ideas, every time", note: "What actually gets a product out the door.", hint: "Drop your post screenshot" },
      { kicker: "Hiring", title: "What I look for in a build partner", note: "For teams who need real execution.", hint: "Drop your post screenshot" },
    ],
  },
  {
    key: "ig",
    label: "Instagram",
    initial: "◎",
    name: "Instagram",
    handle: "@theweb3boy",
    color: "#E2793B",
    href: "https://www.instagram.com/theweb3boy/",
    cta: "Follow on Instagram",
    format: "short visual builds",
    blurb:
      "The visual side — screen recordings, before/after of a dashboard, and short clips that make a complex idea land in under a minute.",
    posts: [
      { kicker: "Reel", title: "The dashboard, in 40 seconds", note: "Pin three vaults, watch BTC lose.", hint: "Drop a reel cover" },
      { kicker: "Reel", title: "Karachi, 2am, still shipping", note: "The unedited version of building.", hint: "Drop a reel cover" },
      { kicker: "Carousel", title: "Read a vault chart properly", note: "Five slides, no jargon.", hint: "Drop a carousel cover" },
    ],
  },
] as const;

export type PlatformKey = (typeof PLATFORMS)[number]["key"];
