export const REGION = process.env.AWS_REGION || "eu-west-2";
export const TABLE = process.env.KERBSIDE_TABLE || "kerbside-app";
export const BUCKET = process.env.KERBSIDE_BUCKET || "kerbside-demo-assets";
export const PORT = Number(process.env.PORT || 5173);

export const TENANTS = [
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
