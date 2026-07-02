export const DEFAULT_TOOLS = [
  { name: "imagineart", aliases: ["imagine.art", "ImagineArt"] },
  { name: "kling", aliases: ["Kling AI", "Kuaishou"] },
  { name: "seedance", aliases: ["Seedance"] },
  { name: "runway", aliases: ["Runway ML", "RunwayML"] },
  { name: "pika", aliases: ["Pika Labs", "Pika Art"] },
  { name: "sora", aliases: ["OpenAI Sora"] },
  { name: "midjourney", aliases: ["MJ", "Mid Journey"] },
  { name: "ideogram", aliases: ["Ideogram AI"] },
  { name: "luma", aliases: ["Luma AI", "Dream Machine", "LumaLabs"] },
  { name: "higgsfield", aliases: ["Higgsfield AI"] },
  { name: "hailuo", aliases: ["MiniMax Video", "Hailuo AI"] },
  { name: "veo", aliases: ["Google Veo", "Veo 2", "Veo 3"] },
  { name: "flux", aliases: ["FLUX", "Black Forest Labs", "FLUX.1"] },
  { name: "heygen", aliases: ["HeyGen AI"] },
  { name: "nanobanana", aliases: ["Nano Banana"] },
  { name: "invideo", aliases: ["InVideo AI"] },
  { name: "krea", aliases: ["Krea AI"] },
  { name: "adobe firefly", aliases: ["Adobe Firefly", "Firefly"] },
  { name: "canva ai", aliases: ["Canva Magic", "Canva AI"] },
  { name: "leonardo", aliases: ["Leonardo AI", "Leonardo.Ai"] },
];

export const ARCHETYPE_QUERIES = (tool: string) => [
  `best ai video generator ${tool}`,
  `top ai image tools ${tool}`,
  `best ${tool} alternatives`,
  `${tool} vs`,
  `${tool} review`,
  `${tool} alternative`,
  `we tested ${tool}`,
  `generative ai tools roundup ${tool}`,
  `ai design tools 2025 ${tool}`,
  `ai tools comparison ${tool}`,
];

export const SEED_DOMAINS = [
  // Big tech / AI news
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "venturebeat.com",
  "arstechnica.com",
  "thenextweb.com",
  "zdnet.com",
  "futurism.com",
  "engadget.com",
  "gizmodo.com",

  // AI-specific newsletters & blogs
  "therundown.ai",
  "bensbites.co",
  "superhuman.ai",
  "aitoolreport.beehiiv.com",
  "aiweekly.co",
  "alphasignal.ai",
  "unite.ai",
  "marktechpost.com",
  "syncedreview.com",
  "dataconomy.com",

  // AI image / video / creative tools coverage
  "petapixel.com",
  "maginative.com",
  "aituts.com",
  "80.lv",
  "digitaltrends.com",
  "pcmag.com",
  "dpreview.com",
  "imaging-resource.com",
  "photographylife.com",
  "photofocus.com",

  // Developer / ML community
  "towardsdatascience.com",
  "analyticsvidhya.com",
  "hackernoon.com",
  "dev.to",
  "huggingface.co",
  "paperswithcode.com",

  // Consumer tech & how-to
  "makeuseof.com",
  "howtogeek.com",
  "lifewire.com",
  "cnet.com",

  // Creative / design
  "creativebloq.com",
  "designboom.com",
  "creativepro.com",
  "artstation.com",
  "renderguide.com",

  // Company / tool blogs
  "nvidia.com",
  "blogs.microsoft.com",
  "stability.ai",
  "openai.com",
];

export const RELEVANT_SUBREDDITS = [
  "StableDiffusion",
  "aivideo",
  "artificial",
  "midjourney",
  "AIAssistants",
  "singularity",
  "MediaSynthesis",
  "AIart",
  "ChatGPT",
  "MachineLearning",
];
