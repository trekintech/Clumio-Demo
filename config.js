export const REGION = process.env.AWS_REGION || "eu-west-2";
export const TABLE = process.env.KERBSIDE_TABLE || "kerbside-app";
export const BUCKET = process.env.KERBSIDE_BUCKET || "kerbside-demo-assets";
export const PORT = Number(process.env.PORT || 5173);

// Unset (default): server builds presigned S3 URLs directly, checks the
// bucket for object existence, and the app renders 404 tiles for anything
// missing. Set to a CloudFront distribution domain once the origin group
// (source bucket primary, Clumio Instant Access secondary) exists in the
// console — see docs/s3-demo-runbook.md. In that mode the app trusts
// CloudFront completely and does not peek at the source bucket.
export const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || null;

const NAMED_TENANTS = [
  { slug: "alma-kitchen", name: "Alma Kitchen", cuisine: "Japanese" },
  { slug: "brick-lane-grill", name: "Brick Lane Grill", cuisine: "Turkish" },
  { slug: "corner-pantry", name: "Corner Pantry", cuisine: "Cafe" },
  { slug: "dockside-fish", name: "Dockside Fish", cuisine: "Seafood" },
  { slug: "east-street-thai", name: "East Street Thai", cuisine: "Thai" },
  { slug: "fenwick-pizza", name: "Fenwick Pizza", cuisine: "Italian" },
  { slug: "greenway-deli", name: "Greenway Deli", cuisine: "Deli" },
  { slug: "harbour-tapas", name: "Harbour Tapas", cuisine: "Spanish" }
];

export const BLAST_RADIUS = ["alma-kitchen", "brick-lane-grill", "corner-pantry"];

// See CLAUDE.md "Scale". The stage narrative is "three tenants corrupted out
// of four thousand" — the default here (4,119) plus the 8 named tenants
// above equals 4,127, matching the count already in public/index.html.
// Synthetic tenants exist only to make the dropdown read as a real estate;
// they get a name and orders and nothing else (see scripts/seed.js).
export const SYNTHETIC_TENANT_COUNT = Number(process.env.SYNTHETIC_TENANT_COUNT ?? 4119);

const SYNTHETIC_PREFIXES = [
  "Riverside", "Harbourside", "Northgate", "Kings Cross", "Ashfield", "Millbank",
  "Sunnyside", "Cedar Grove", "Lansdowne", "Fenchurch", "Westgate", "Old Mill",
  "Stonebridge", "Maple", "Queensway", "Abbeyfield", "Brookside", "Crown",
  "Eastfield", "Hollow Lane"
];
const SYNTHETIC_SUFFIXES = [
  "Kitchen", "Diner", "Grill", "Cafe", "Eatery", "Canteen", "Deli", "Bistro",
  "Takeaway", "Kitchen & Bar"
];
const SYNTHETIC_CUISINES = [
  "Cafe", "Italian", "Indian", "Chinese", "Mexican", "Thai", "British", "Vegan",
  "Bakery", "Pizza"
];

function syntheticTenants(count) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const num = String(i).padStart(5, "0");
    const prefix = SYNTHETIC_PREFIXES[i % SYNTHETIC_PREFIXES.length];
    const suffix = SYNTHETIC_SUFFIXES[Math.floor(i / SYNTHETIC_PREFIXES.length) % SYNTHETIC_SUFFIXES.length];
    out.push({
      slug: `synth-${num}`,
      name: `${prefix} ${suffix} #${num}`,
      cuisine: SYNTHETIC_CUISINES[i % SYNTHETIC_CUISINES.length],
      synthetic: true
    });
  }
  return out;
}

export const TENANTS = [...NAMED_TENANTS, ...syntheticTenants(SYNTHETIC_TENANT_COUNT)];

export const MENU = {
  "alma-kitchen": [
    { id: "katsu-curry", name: "Katsu curry", price: 12.5 },
    { id: "bao-set", name: "Bao set", price: 9.0 },
    { id: "gyoza", name: "Gyoza", price: 6.5 },
    { id: "ramen", name: "Tonkotsu ramen", price: 13.0 }
  ],
  "brick-lane-grill": [
    { id: "adana", name: "Adana kebab", price: 11.0 },
    { id: "lahmacun", name: "Lahmacun", price: 7.5 },
    { id: "pide", name: "Cheese pide", price: 9.5 },
    { id: "baklava", name: "Baklava", price: 4.0 }
  ],
  "corner-pantry": [
    { id: "flat-white", name: "Flat white", price: 3.4 },
    { id: "sourdough", name: "Sourdough toastie", price: 7.0 },
    { id: "granola", name: "Granola bowl", price: 6.0 },
    { id: "brownie", name: "Salted brownie", price: 3.8 }
  ]
};

export function defaultMenu(slug) {
  return MENU[slug] || [
    { id: "house-special", name: "House special", price: 10.0 },
    { id: "side-salad", name: "Side salad", price: 4.0 },
    { id: "soft-drink", name: "Soft drink", price: 2.5 }
  ];
}
