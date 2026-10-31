/*
 * The game's data: what grows where, what it sells for, which shops sell what.
 * Adding a shop or an item is a line here; the rest of the game reads from this file.
 */

export const MAX_LIFE = 100;

/** Tuning, in one place. Points and life are per-viewer (saved in this browser). */
export const TUNE = {
  /** life lost in an accident, before helmet and vest */
  accident: 35,
  /** no second accident within this many ms (one crash, one bruise) */
  hitGapMs: 3000,
  /** life lost per second in heavy rain without an umbrella */
  rainDrain: 0.15,
  /** life lost per second in the heat (33 °C and up) without a sun cap */
  heatDrain: 0.08,
  /** life back per second once you're safe and haven't been hurt for a while */
  regen: 0.6,
  /** quiet time (ms) before life starts coming back */
  calmMs: 12000,
  /** share of your points you drop when you faint */
  faintLoss: 0.1,
  /** life you wake up with */
  faintLife: 40,
  /** share of an accident's damage left when you're on the zebra crossing */
  crossingDamage: 0.3,
  /** points for each safe trip across the zebra crossing */
  crossingPoints: 2,
  /** extra price for the Mart's special, and for anyone carrying a town map */
  specialBonus: 2,
  mapBonus: 1.2,
  /** the clinic's treatment */
  treatPrice: 30,
};

/** The zebra crossing in front of the building (metres, the town's own axes). */
export const CROSSING = { x0: -4, x1: 4, z0: 5, z1: 15 };
/** Where you wake up after fainting: the clinic's door. */
export const CLINIC_DOOR = { x: 47, z: 4.0 };

export type ItemKind = 'produce' | 'consumable' | 'gear';

export interface Item {
  id: string;
  name: string;
  emoji: string;
  kind: ItemKind;
  /** what the Mart pays for one */
  sell?: number;
  /** what a shop charges for one */
  buy?: number;
  /** life restored when used (consumables) */
  heal?: number;
  blurb: string;
}

export const ITEMS: Record<string, Item> = {
  coconut: { id: 'coconut', name: 'Coconut', emoji: '🥥', kind: 'produce', sell: 12, blurb: 'Fresh from the palm' },
  mango: { id: 'mango', name: 'Mango', emoji: '🥭', kind: 'produce', sell: 9, blurb: 'Sweet, from the tree by the road' },
  hibiscus: { id: 'hibiscus', name: 'Hibiscus', emoji: '🌺', kind: 'produce', sell: 4, blurb: 'Red flowers from the hedge' },
  jasmine: { id: 'jasmine', name: 'Jasmine', emoji: '🌸', kind: 'produce', sell: 6, blurb: 'Mullappoo, for garlands' },
  marigold: { id: 'marigold', name: 'Marigold', emoji: '🌼', kind: 'produce', sell: 3, blurb: 'Bright orange, from the beds' },
  garland: { id: 'garland', name: 'Jasmine garland', emoji: '📿', kind: 'produce', sell: 30, blurb: 'Hand-strung, for the temple' },
  marigold_garland: { id: 'marigold_garland', name: 'Marigold garland', emoji: '🧡', kind: 'produce', sell: 20, blurb: 'Hand-strung, bright and cheerful' },

  first_aid: { id: 'first_aid', name: 'First-aid kit', emoji: '🩹', kind: 'consumable', buy: 40, heal: 50, blurb: 'Plasters, bandage, antiseptic' },
  tonic: { id: 'tonic', name: 'Health tonic', emoji: '💊', kind: 'consumable', buy: 15, heal: 15, blurb: 'A small bottle, a small boost' },
  coconut_water: { id: 'coconut_water', name: 'Tender coconut water', emoji: '🥥', kind: 'consumable', buy: 8, heal: 10, blurb: 'Cool and refreshing' },
  mango_juice: { id: 'mango_juice', name: 'Mango juice', emoji: '🧃', kind: 'consumable', buy: 12, heal: 15, blurb: 'Thick and sweet' },
  ice_cream: { id: 'ice_cream', name: 'Ice cream cone', emoji: '🍦', kind: 'consumable', buy: 10, heal: 8, blurb: 'Chocolate or vanilla' },

  umbrella: { id: 'umbrella', name: 'Umbrella', emoji: '☂️', kind: 'gear', buy: 120, blurb: 'Keeps the monsoon off you' },
  sun_cap: { id: 'sun_cap', name: 'Sun cap', emoji: '🧢', kind: 'gear', buy: 60, blurb: 'No more heat trouble at noon' },
  helmet: { id: 'helmet', name: 'Helmet', emoji: '⛑️', kind: 'gear', buy: 250, blurb: 'Halves the damage from an accident' },
  vest: { id: 'vest', name: 'Reflector vest', emoji: '🦺', kind: 'gear', buy: 150, blurb: 'Drivers see you: a quarter less damage' },
  map: { id: 'map', name: 'Kasaragod map', emoji: '🗺️', kind: 'gear', buy: 200, blurb: 'Know the market prices: +20% at the Mart' },
  flower_crown: { id: 'flower_crown', name: 'Flower crown', emoji: '🌸', kind: 'gear', buy: 80, blurb: 'Just for looks, and it smells lovely' },

  pazham_pori: { id: 'pazham_pori', name: 'Banana fritter', emoji: '🍌', kind: 'consumable', buy: 10, heal: 12, blurb: 'Hot pazham pori from the bakery' },
  unniyappam: { id: 'unniyappam', name: 'Unniyappam', emoji: '🥞', kind: 'consumable', buy: 14, heal: 14, blurb: 'Sweet little rice-and-jaggery cakes' },
  chai: { id: 'chai', name: 'Chai', emoji: '🍵', kind: 'consumable', buy: 5, heal: 5, blurb: 'Milky and sweet, one glass' },
};

/** Things a shop buys from you, made from other things. */
export interface Recipe {
  id: string;
  needs: Record<string, number>;
  makes: string;
}
export const RECIPES: Recipe[] = [
  { id: 'garland', needs: { jasmine: 4 }, makes: 'garland' },
  { id: 'marigold_garland', needs: { marigold: 6 }, makes: 'marigold_garland' },
];

export interface Shop {
  id: string;
  name: string;
  emoji: string;
  /** a treatment instead of goods (the clinic) */
  service?: { name: string; price: number };
  /** a line the shopkeeper says */
  greet: string;
  /** what the shop sells (buy shops) */
  stock?: string[];
  /** the Mart buys produce and makes garlands */
  mart?: boolean;
  /** where the stall stands: x along the footpath, its width (m) */
  x: number;
  w: number;
  /** the awning colours */
  awning: [string, string];
}

export const SHOPS: Shop[] = [
  { id: 'mart', name: 'Fruit & Flower Mart', emoji: '🧺', greet: 'Bring me your harvest, I’ll pay you fair!', mart: true, x: -47, w: 5, awning: ['#f97316', '#fde68a'] },
  { id: 'pharmacy', name: 'Medical Store', emoji: '💊', greet: 'Feeling bruised? Let’s fix you up.', stock: ['first_aid', 'tonic'], x: -34, w: 3, awning: ['#16a34a', '#f0fdf4'] },
  { id: 'snack', name: 'Juice & Snack Bar', emoji: '🥤', greet: 'Something cool for the road?', stock: ['coconut_water', 'mango_juice', 'ice_cream'], x: -25, w: 3, awning: ['#ec4899', '#fdf2f8'] },
  { id: 'umbrella', name: 'Umbrella & Sun Shop', emoji: '☂️', greet: 'Rain or shine, we’ve got you.', stock: ['umbrella', 'sun_cap'], x: 25, w: 3, awning: ['#2563eb', '#dbeafe'] },
  { id: 'gear', name: 'Helmet & Gear', emoji: '🪖', greet: 'Ride safe, walk safe, come back safe.', stock: ['helmet', 'vest'], x: 34, w: 3, awning: ['#7c3aed', '#ede9fe'] },
  { id: 'bakery', name: 'Bakery', emoji: '🥞', greet: 'Hot from the pan, have one!', stock: ['pazham_pori', 'unniyappam', 'chai'], x: -56, w: 3, awning: ['#d97706', '#fef3c7'] },
  { id: 'bookshop', name: 'Bookshop & Maps', emoji: '📚', greet: 'Best map of the town, right here.', stock: ['map'], x: -66, w: 3, awning: ['#0f766e', '#ccfbf1'] },
  { id: 'tailor', name: 'Tailor & Boutique', emoji: '🧵', greet: 'Something to make you look lovely.', stock: ['flower_crown'], x: 56, w: 3, awning: ['#be185d', '#fce7f3'] },
  { id: 'clinic', name: 'Kasaragod Clinic', emoji: '🏥', greet: 'Sit down, let’s have a look at you.', service: { name: 'Check-up & treatment', price: 30 }, x: 47, w: 3, awning: ['#dc2626', '#ffffff'] },
];

export type SourceKind = 'palm' | 'mango' | 'shrub' | 'bed';
export interface Source {
  id: string;
  kind: SourceKind;
  item: string;
  x: number;
  z: number;
  /** most you can pick before it has to grow back */
  max: number;
  /** ms for one more to grow back */
  regrow: number;
  /** flowers / fruit colour (shrubs, beds, mango) */
  color?: string;
}

/** Coconut palms along both footpaths (same spots as the palms drawn in App). */
export const PALM_SPOTS: { x: number; z: number }[] = [
  ...[-54, -44, -27, 27, 44, 54].map((x) => ({ x, z: 3.6 })),
  ...[-50, -31, -16, 13, 34, 50].map((x) => ({ x, z: 16.9 })),
];

const MIN = 60_000;
export const SOURCES: Source[] = [
  ...PALM_SPOTS.map((p, i) => ({ id: `palm-${i}`, kind: 'palm' as const, item: 'coconut', x: p.x, z: p.z, max: 3, regrow: MIN })),
  { id: 'mango-w', kind: 'mango', item: 'mango', x: -17, z: 2.0, max: 4, regrow: 0.75 * MIN, color: '#f59e0b' },
  { id: 'mango-e', kind: 'mango', item: 'mango', x: 17, z: 2.0, max: 4, regrow: 0.75 * MIN, color: '#f59e0b' },
  { id: 'hibiscus-w', kind: 'shrub', item: 'hibiscus', x: -40, z: 17.8, max: 5, regrow: 20_000, color: '#e11d48' },
  { id: 'hibiscus-e', kind: 'shrub', item: 'hibiscus', x: 40, z: 17.8, max: 5, regrow: 20_000, color: '#e11d48' },
  { id: 'jasmine-w', kind: 'shrub', item: 'jasmine', x: -23, z: 17.8, max: 6, regrow: 25_000, color: '#ffffff' },
  { id: 'jasmine-e', kind: 'shrub', item: 'jasmine', x: 23, z: 17.8, max: 6, regrow: 25_000, color: '#ffffff' },
  { id: 'marigold-w', kind: 'bed', item: 'marigold', x: -7, z: 1.4, max: 6, regrow: 15_000, color: '#f97316' },
  { id: 'marigold-e', kind: 'bed', item: 'marigold', x: 7, z: 1.4, max: 6, regrow: 15_000, color: '#f97316' },
];
export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<string, Source>;
