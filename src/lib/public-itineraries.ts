export type PublicItineraryCategory = 'all' | 'family' | 'culinary' | 'adventure' | 'romantic';

export type PublicItinerary = {
  name: string;
  subtitle: string;
  summary: string;
  url: string;
  image: string;
  days: number;
  destinations: number;
  activity: number;
  aspiration: number;
  romance: number;
  family: number;
  culinary: number;
  adventure: number;
  tags: string[];
  categories: Exclude<PublicItineraryCategory, 'all'>[];
};

export const publicItineraries: PublicItinerary[] = [
  {
    name: 'Bonaire Reef Week',
    subtitle: 'Seven easy days of reefs, trade winds, and waterfront dinners',
    summary:
      "A compact Caribbean sample trip built around Bonaire's shore diving, Klein Bonaire, Lac Bay wind, salt-pan landscapes, and waterfront restaurants.",
    url: 'https://ourtrips.to/t/NyLNFNHxC9',
    image: 'https://images.unsplash.com/photo-1677938103364-969b0aba46a8?w=1200&h=1600&fit=crop&q=80',
    days: 7,
    destinations: 1,
    activity: 2,
    aspiration: 2,
    romance: 3,
    family: 4,
    culinary: 3,
    adventure: 3,
    tags: ['Beach', 'Reef', 'Wingfoil', 'Family'],
    categories: ['family', 'adventure'],
  },
  {
    name: 'Antarctica Once-in-a-Lifetime',
    subtitle: 'Ushuaia, the Drake Passage, and five expedition days on the Peninsula',
    summary:
      'A high-aspiration expedition sample with zodiac landings, penguin colonies, kayaking, ice, and the kind of journey people save for years.',
    url: 'https://ourtrips.to/t/xvyQvQKRPx',
    image: 'https://images.unsplash.com/photo-1711299977694-2f5624187603?w=1200&h=1600&fit=crop&q=80',
    days: 12,
    destinations: 3,
    activity: 4,
    aspiration: 5,
    romance: 3,
    family: 2,
    culinary: 2,
    adventure: 5,
    tags: ['Expedition', 'Wildlife', 'Ice', 'Aspirational'],
    categories: ['adventure'],
  },
  {
    name: 'Japan Food & Design Arc',
    subtitle: 'Tokyo, Kanazawa, Kyoto, Naoshima, and Osaka in eleven days',
    summary:
      "A food-forward Japan route: Tokyo dining, Kanazawa craft, Kyoto atmosphere, Naoshima art, and an Osaka street-food finale.",
    url: 'https://ourtrips.to/t/uzZVTrCqCo',
    image: 'https://images.unsplash.com/photo-1649957866905-bef01af303da?w=1200&h=1600&fit=crop&q=80',
    days: 11,
    destinations: 5,
    activity: 3,
    aspiration: 4,
    romance: 4,
    family: 2,
    culinary: 5,
    adventure: 2,
    tags: ['Food', 'Design', 'Art', 'Rail'],
    categories: ['culinary', 'romantic'],
  },
  {
    name: 'Costa Rica Family Wild Loop',
    subtitle: 'Arenal, Monteverde, and Manuel Antonio with kids or teens',
    summary:
      'A nature circuit with volcano views, hot springs, hanging bridges, cloud forest, zip-lining, sloths, monkeys, and a beach finish.',
    url: 'https://ourtrips.to/t/Rc6qQyHuuv',
    image: 'https://images.unsplash.com/photo-1657036599578-1075326920a0?w=1200&h=1600&fit=crop&q=80',
    days: 9,
    destinations: 3,
    activity: 3,
    aspiration: 3,
    romance: 2,
    family: 5,
    culinary: 3,
    adventure: 4,
    tags: ['Family', 'Wildlife', 'Rainforest', 'Beach'],
    categories: ['family', 'adventure'],
  },
  {
    name: 'Patagonia Peaks & Mendoza Wine',
    subtitle: 'Buenos Aires, glaciers, Fitz Roy, and vineyard decompression',
    summary:
      'A big-scenery Argentina sample with Buenos Aires food, Perito Moreno Glacier, Fitz Roy hiking, and Mendoza wine country.',
    url: 'https://ourtrips.to/t/V944tR7WNC',
    image: 'https://images.unsplash.com/photo-1705506804933-d2f88b48d1e3?w=1200&h=1600&fit=crop&q=80',
    days: 13,
    destinations: 4,
    activity: 4,
    aspiration: 4,
    romance: 4,
    family: 2,
    culinary: 4,
    adventure: 5,
    tags: ['Hiking', 'Glaciers', 'Wine', 'Food'],
    categories: ['adventure', 'culinary', 'romantic'],
  },
  {
    name: 'Amalfi & Puglia Romance',
    subtitle: 'Naples, Ravello, Capri, Matera, and a Puglia finish',
    summary:
      "A romantic southern Italy sample with Naples food, Amalfi Coast glamour, Capri by boat, Matera's cave-city drama, and slower Puglia.",
    url: 'https://ourtrips.to/t/WoBpyRzBZa',
    image: 'https://images.unsplash.com/photo-1680212558862-137ca19670e0?w=1200&h=1600&fit=crop&q=80',
    days: 10,
    destinations: 5,
    activity: 2,
    aspiration: 4,
    romance: 5,
    family: 2,
    culinary: 4,
    adventure: 2,
    tags: ['Romance', 'Coast', 'Food', 'Road trip'],
    categories: ['romantic', 'culinary'],
  },
  {
    name: 'Morocco Family Culture Loop',
    subtitle: 'Marrakech, Atlas villages, desert camp, and Fes',
    summary:
      'A family-friendly Morocco loop with color, food, mountain air, kasbah landscapes, a desert night, and a Fes craft finale.',
    url: 'https://ourtrips.to/t/dvp5hVXhii',
    image: 'https://images.unsplash.com/photo-1596750320291-a082a23dcc19?w=1200&h=1600&fit=crop&q=80',
    days: 10,
    destinations: 5,
    activity: 3,
    aspiration: 3,
    romance: 3,
    family: 4,
    culinary: 4,
    adventure: 3,
    tags: ['Family', 'Culture', 'Desert', 'Markets'],
    categories: ['family', 'culinary'],
  },
  {
    name: 'Iceland Adrenaline Week',
    subtitle: 'Reykjavik, Golden Circle, South Coast, glaciers, and Silfra',
    summary:
      'A compact high-adventure Iceland sample with city dining, waterfalls, glacier hiking, ice caves, and Silfra snorkeling.',
    url: 'https://ourtrips.to/t/HFpU63bT9h',
    image: 'https://images.unsplash.com/photo-1502893323067-a83091e37337?w=1200&h=1600&fit=crop&q=80',
    days: 7,
    destinations: 4,
    activity: 4,
    aspiration: 4,
    romance: 3,
    family: 3,
    culinary: 3,
    adventure: 5,
    tags: ['Adventure', 'Winter', 'Glacier', 'Road trip'],
    categories: ['adventure'],
  },
  {
    name: 'Peru Luxury Food & Andes',
    subtitle: 'Lima, Arequipa, Colca, Sacred Valley, Machu Picchu, Cusco, and Amazon',
    summary:
      'A refined Peru sample with Lima gastronomy, Arequipa, Colca, luxury rail, Sacred Valley, Machu Picchu, Cusco, and Amazon.',
    url: 'https://ourtrips.to/t/aB4sMMJkqL',
    image: 'https://images.unsplash.com/photo-1752067954948-fad43a7457de?w=1200&h=1600&fit=crop&q=80',
    days: 15,
    destinations: 7,
    activity: 4,
    aspiration: 5,
    romance: 4,
    family: 2,
    culinary: 5,
    adventure: 4,
    tags: ['Food', 'Andes', 'Amazon', 'Luxury'],
    categories: ['culinary', 'adventure', 'romantic'],
  },
  {
    name: 'Namibia Desert & Safari Circuit',
    subtitle: 'Sossusvlei, Swakopmund, Damaraland, Etosha, and Okonjima',
    summary:
      'A cinematic Namibia sample with desert dunes, Atlantic coast, ancient rock art, Etosha waterholes, and a conservation-focused finish.',
    url: 'https://ourtrips.to/t/RcyLhvWCut',
    image: 'https://images.unsplash.com/photo-1613155358575-e2c48c2a2404?w=1200&h=1600&fit=crop&q=80',
    days: 12,
    destinations: 6,
    activity: 3,
    aspiration: 4,
    romance: 4,
    family: 3,
    culinary: 2,
    adventure: 4,
    tags: ['Safari', 'Desert', 'Photography', 'Road trip'],
    categories: ['adventure', 'romantic'],
  },
];

export const itineraryCategories: Array<{ id: PublicItineraryCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'family', label: 'Family' },
  { id: 'culinary', label: 'Culinary' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'romantic', label: 'Romantic' },
];
