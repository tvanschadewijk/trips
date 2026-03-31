import type { TripData } from './types';

export const sampleTrips: TripData[] = [
  {
    trip: {
      name: "Scotland",
      subtitle: "West Highland Way & Oban Coast",
      dates: { start: "2026-04-24", end: "2026-05-03" },
      travelers: ["Thijs", "Alexli"],
      accent_color: "#7B5EA7",
      summary: "9-night walking trip through the Scottish Highlands — from London by sleeper train, across Rannoch Moor, over the Devil's Staircase, and finishing with seafood in Oban.",
      hero_image: "https://images.unsplash.com/photo-1732045133230-1a670eef8620?w=1200&h=1600&fit=crop&q=80",
      services: [
        {
          type: "luggage_transfer",
          label: "Luggage Transfer",
          icon: "luggage",
          provider: "Travel-Lite",
          ref: "#30503",
          price: "\u00a390",
          status: "booked",
          legs: [
            { date: "2026-04-28", route: "Bridge of Orchy Hotel \u2192 Clachaig Inn" },
            { date: "2026-04-30", route: "Clachaig Inn \u2192 The Garrison, Fort William" }
          ]
        },
        {
          type: "taxi_contact",
          label: "Taxi Contact",
          icon: "car",
          provider: "A2B Taxis Fort William",
          ref: "+44 1397 700777",
          status: "info"
        }
      ]
    },
    days: [
      {
        day_number: 1, date: "2026-04-24", title: "Amsterdam \u2192 London", subtitle: "Eurostar to Hackney",
        hero_image: "https://images.unsplash.com/photo-1642000796228-1a2179abaa70?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "train", label: "Eurostar", value: "4h 19m" }],
        blocks: [
          { time_label: "Afternoon", content: "Eurostar from Amsterdam Centraal to London St Pancras.", type: "transport" },
          { time_label: "Evening", content: "Arrive London. Check in at The Crown, Hackney.", type: "activity" }
        ],
        accommodation: { name: "The Crown Pub & Guesthouse", price: "\u20ac255", status: "booked", nights: 2, note: "418 Mare St, Hackney.",
          detail: { check_in: "15:00", check_out: "11:00", room_type: "Double Room", address: "418 Mare Street, Hackney, London E8 1HP", booking_platform: "Hotels.com", confirmation: "Trip #72072493333537" }
        },
        meals: [{ type: "dinner", name: "Dishoom King's Cross", note: "Bombay-style caf\u00e9, 5 min from St Pancras" }],
        transport: [{ mode: "train", label: "Eurostar", from: "Amsterdam Centraal", to: "London St Pancras", depart: "afternoon", arrive: "evening", duration: "4h 19m",
          detail: { class: "Standard", seats: "Coach 2, Seat 83+84", booking_ref: "QHVGZY", booking_platform: "eurostar.com", check_in: "Opens 30 min before departure", note: "Passport required. Arrive 45 min early." }
        }]
      },
      {
        day_number: 2, date: "2026-04-25", title: "London", subtitle: "Lazy city day in Hackney",
        hero_image: "https://images.unsplash.com/photo-1489130104649-4a429c0d006e?w=800&h=500&fit=crop&q=80",
        stats: [], blocks: [
          { time_label: "Morning", content: "Lazy morning, brunch in Hackney.", type: "activity" },
          { time_label: "Afternoon", content: "Explore the neighbourhood.", type: "activity" }
        ],
        accommodation: { name: "The Crown Pub & Guesthouse", price: "(night 2 of 2)", status: "booked", nights: 1, note: "Night 2 of 2" },
        meals: [], transport: []
      },
      {
        day_number: 3, date: "2026-04-26", title: "London \u2192 Glasgow", subtitle: "Caledonian Sleeper overnight",
        hero_image: "https://images.unsplash.com/photo-1763888674063-7e188c7f8103?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "moon", label: "Sleeper", value: "10h overnight" }],
        blocks: [
          { time_label: "Daytime", content: "Leisurely morning in London.", type: "activity" },
          { time_label: "21:30", content: "Caledonian Sleeper from Euston. Club Twin en-suite.", type: "transport" }
        ],
        accommodation: { name: "Caledonian Sleeper \u2014 Club Twin", price: "\u00a3455", status: "booked", nights: 1, note: "Room #6, en-suite, breakfast included",
          detail: { check_in: "Lounge opens 20:00, boarding from 20:45", check_out: "Depart by 08:00", room_type: "Club Twin En-Suite, Room #6", booking_platform: "sleeper.scot", confirmation: "CSW6237282" }
        },
        meals: [],
        transport: [{ mode: "train", label: "Caledonian Sleeper", from: "London Euston", to: "Glasgow Central", depart: "21:30", arrive: "07:30+1", duration: "~10h",
          detail: { class: "Club Twin En-Suite", cabin: "Room #6", booking_ref: "CSW6237282", booking_platform: "sleeper.scot", amenities: "Lounge, Club Car, breakfast, en-suite, Wi-Fi", check_in: "Lounge opens 20:00, boarding from 20:45" }
        }]
      },
      {
        day_number: 4, date: "2026-04-27", title: "Glasgow \u2192 Bridge of Orchy", subtitle: "West Highland Line",
        hero_image: "https://images.unsplash.com/photo-1505832018823-50331d70d237?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "train", label: "West Highland Line", value: "2h 23m" }],
        blocks: [
          { time_label: "08:22", content: "ScotRail Glasgow Queen St \u2192 Bridge of Orchy.", type: "transport" },
          { time_label: "Afternoon", content: "Arrive 10:45. Lunch at the hotel.", type: "activity" }
        ],
        accommodation: { name: "Bridge of Orchy Hotel", price: "\u20ac281", rating: "4\u2605", status: "booked", nights: 1, note: "Open fireplaces, whisky bar",
          detail: { check_in: "15:00", check_out: "10:30", room_type: "Double Room", address: "Bridge of Orchy, Argyll PA36 4AD", booking_platform: "Hotels.com", confirmation: "Trip #72072469319546" }
        },
        meals: [{ type: "dinner", name: "Bridge of Orchy Hotel", note: "Scottish cuisine, great whisky list", status: "pending" }],
        transport: [{ mode: "train", label: "ScotRail \u2014 West Highland Line", from: "Glasgow Queen St", to: "Bridge of Orchy", depart: "08:22", arrive: "10:45", duration: "2h 23m",
          detail: { class: "Standard", seats: "Unreserved \u2014 sit on the RIGHT for views", booking_ref: "6HCTKJNH", booking_platform: "scotrail.co.uk", note: "One of the most scenic rail journeys in Britain." }
        }]
      },
      {
        day_number: 5, date: "2026-04-28", title: "Bridge of Orchy \u2192 Glencoe", subtitle: "Across Rannoch Moor",
        hero_image: "https://images.unsplash.com/photo-1635336798196-0351e43b1112?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "footprints", label: "Distance", value: "19 km" }, { icon: "clock", label: "Walking", value: "~5 hrs" }, { icon: "mountain", label: "Terrain", value: "Good paths" }],
        blocks: [
          { time_label: "Morning", content: "Set off along the Old Military Road.", type: "activity" },
          { time_label: "Midday", content: "Cross Rannoch Moor.", type: "activity" },
          { time_label: "Afternoon", content: "Arrive Kingshouse. Taxi to Clachaig Inn.", type: "activity" },
          { time_label: "Evening", content: "Dinner at Clachaig Inn.", type: "activity" }
        ],
        accommodation: { name: "Clachaig Inn, Glencoe", price: "\u00a3429.52 (2 nights)", rating: "4\u2605", status: "booked", nights: 2, note: "Double Room with Mountain View. Breakfast included.",
          detail: { check_in: "4:00 PM \u2013 9:00 PM", check_out: "8:30 AM \u2013 10:30 AM", room_type: "Double Room with Mountain View", address: "Clachaig Inn Glencoe, Ballachulish, PH49 4HX", phone: "+44 1855 811252", booking_platform: "Booking.com", confirmation: "6986402316", cancellation_deadline: "Non-refundable", note: "Breakfast included. 150+ single malts." }
        },
        meals: [{ type: "lunch", name: "Inveroran Hotel", note: "Coffee & lunch on the walk" }, { type: "dinner", name: "Clachaig Inn", note: "Venison burger + whisky" }],
        transport: [{ mode: "car", label: "Taxi", from: "Kingshouse", to: "Clachaig Inn", duration: "~10 min" }]
      },
      {
        day_number: 6, date: "2026-04-29", title: "Devil's Staircase", subtitle: "THE highlight of the West Highland Way",
        hero_image: "https://images.unsplash.com/photo-1635903412579-cbb8ea8dff84?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "footprints", label: "Distance", value: "12-14 km" }, { icon: "clock", label: "Walking", value: "~4 hrs" }, { icon: "mountain", label: "Summit", value: "548m" }],
        blocks: [
          { time_label: "Morning", content: "Taxi to Kingshouse. Hike up the Devil's Staircase.", type: "activity" },
          { time_label: "Afternoon", content: "Summit and return or continue to Kinlochleven.", type: "activity" },
          { time_label: "Evening", content: "Second night at Clachaig.", type: "activity" }
        ],
        accommodation: { name: "Clachaig Inn, Glencoe", price: "(night 2 of 2)", status: "booked", nights: 1, note: "Night 2 of 2" },
        meals: [{ type: "lunch", name: "Pack lunch or Kingshouse", note: "Fuel before the climb" }, { type: "dinner", name: "Clachaig Inn \u2014 Bidean Bar", note: "Different menu from night 1" }],
        transport: []
      },
      {
        day_number: 7, date: "2026-04-30", title: "Glencoe \u2192 Fort William", subtitle: "Final WHW stretch to the finish line",
        hero_image: "https://images.unsplash.com/photo-1590523741831-ab7e8b8f9c7f?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "footprints", label: "Distance", value: "22 km" }, { icon: "clock", label: "Walking", value: "~6 hrs" }, { icon: "mountain", label: "Terrain", value: "Forest & loch paths" }],
        blocks: [
          { time_label: "Morning", content: "Taxi to Kinlochleven, then walk the final WHW section.", type: "activity" },
          { time_label: "Midday", content: "Through Nevis forest with views of Ben Nevis.", type: "activity" },
          { time_label: "Afternoon", content: "Arrive Fort William \u2014 official end of the West Highland Way!", type: "activity" },
          { time_label: "Evening", content: "Celebrate at The Garrison with local ales.", type: "activity" }
        ],
        accommodation: { name: "The Garrison, Fort William", price: "\u20ac196", rating: "4\u2605", status: "booked", nights: 1, note: "Central location, recently renovated",
          detail: { check_in: "15:00", check_out: "11:00", room_type: "Double Room", address: "High Street, Fort William PH33 6DG", booking_platform: "Booking.com", confirmation: "4821937650" }
        },
        meals: [{ type: "lunch", name: "Pack lunch from Clachaig", note: "Eat on the trail" }, { type: "dinner", name: "The Garrison Bar", note: "Celebration dinner \u2014 you finished the WHW!" }],
        transport: [{ mode: "car", label: "Taxi", from: "Clachaig Inn", to: "Kinlochleven", duration: "~15 min" }]
      },
      {
        day_number: 8, date: "2026-05-01", title: "Fort William \u2192 Oban", subtitle: "Coastal train to the seafood capital",
        hero_image: "https://images.unsplash.com/photo-1548250868-2e3aee8b2c86?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "train", label: "ScotRail", value: "1h 30m" }],
        blocks: [
          { time_label: "Morning", content: "Leisurely breakfast at The Garrison.", type: "activity" },
          { time_label: "11:20", content: "ScotRail to Oban \u2014 stunning coastal views.", type: "transport" },
          { time_label: "Afternoon", content: "Arrive Oban. Walk the harbour, visit McCaig\u2019s Tower.", type: "activity" },
          { time_label: "Evening", content: "Seafood dinner on the waterfront.", type: "activity" }
        ],
        accommodation: { name: "Perle Oban", price: "\u00a3330 (2 nights)", rating: "4\u2605", status: "booked", nights: 2, note: "Boutique hotel on the seafront. Breakfast included.",
          detail: { check_in: "15:00", check_out: "11:00", room_type: "Sea View Double", address: "Station Road, Oban PA34 5RT", phone: "+44 1631 700301", booking_platform: "Hotels.com", confirmation: "Trip #72072515447821", note: "Breakfast included. Ask for harbour-facing room." }
        },
        meals: [{ type: "dinner", name: "Ee-Usk (Eeusk)", note: "Best seafood restaurant in Oban \u2014 book ahead" }],
        transport: [{ mode: "train", label: "ScotRail", from: "Fort William", to: "Oban", depart: "11:20", arrive: "12:50", duration: "1h 30m",
          detail: { class: "Standard", seats: "Unreserved \u2014 sit on the LEFT for sea views", booking_ref: "9PQWM3KZ", booking_platform: "scotrail.co.uk", note: "Scenic route along Loch Eil and through Connel." }
        }]
      },
      {
        day_number: 9, date: "2026-05-02", title: "Oban", subtitle: "Seafood, whisky & island views",
        hero_image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=500&fit=crop&q=80",
        stats: [],
        blocks: [
          { time_label: "Morning", content: "Full Scottish breakfast at Perle. Walk along the Esplanade.", type: "activity" },
          { time_label: "Late morning", content: "Oban Distillery tour & tasting.", type: "activity" },
          { time_label: "Afternoon", content: "Wander the harbour. Fresh oysters at the Oban Seafood Hut.", type: "activity" },
          { time_label: "Evening", content: "Final dinner \u2014 The Waterfront Fishouse.", type: "activity" }
        ],
        accommodation: { name: "Perle Oban", price: "(night 2 of 2)", status: "booked", nights: 1, note: "Night 2 of 2" },
        meals: [{ type: "lunch", name: "Oban Seafood Hut", note: "Iconic green shack on the pier \u2014 oysters, langoustines" }, { type: "dinner", name: "The Waterfront Fishouse", note: "Harbourside spot, great wine list" }],
        transport: []
      },
      {
        day_number: 10, date: "2026-05-03", title: "Oban \u2192 Home", subtitle: "Glasgow, then flight back",
        hero_image: "https://images.unsplash.com/photo-1566396223585-c8fbf5fa82a1?w=800&h=500&fit=crop&q=80",
        stats: [{ icon: "train", label: "ScotRail", value: "3h" }, { icon: "plane", label: "Flight", value: "1h 20m" }],
        blocks: [
          { time_label: "08:40", content: "ScotRail Oban \u2192 Glasgow Queen Street.", type: "transport" },
          { time_label: "Midday", content: "Quick lunch in Glasgow.", type: "activity" },
          { time_label: "15:40", content: "easyJet Glasgow \u2192 Amsterdam Schiphol.", type: "transport" },
          { time_label: "Evening", content: "Home!", type: "activity" }
        ],
        accommodation: undefined,
        meals: [{ type: "lunch", name: "Glaschu", note: "Quick bite near Queen St station" }],
        transport: [
          { mode: "train", label: "ScotRail", from: "Oban", to: "Glasgow Queen St", depart: "08:40", arrive: "11:40", duration: "3h",
            detail: { class: "Standard", seats: "Unreserved", booking_ref: "7KRTM5PW", booking_platform: "scotrail.co.uk" }
          },
          { mode: "plane", label: "easyJet", from: "Glasgow (GLA)", to: "Amsterdam (AMS)", depart: "15:40", arrive: "18:00", duration: "1h 20m",
            detail: { flight: "EZY6924", terminal: "Main", booking_ref: "EH4K7QP", booking_platform: "easyjet.com", cabin_bag: "1\u00d7 under seat", hold_bag: "1\u00d7 23kg included", check_in: "Opens 30 days before", note: "Arrive 2h before departure." }
          }
        ]
      }
    ]
  },
  {
    trip: {
      name: "Rajasthan",
      subtitle: "Forts, Deserts & Pink Cities",
      dates: { start: "2026-12-20", end: "2026-12-31" },
      travelers: ["Thijs", "Alexli"],
      summary: "11-night journey through Rajasthan.",
      hero_image: "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&h=1600&fit=crop&q=80",
      overview_image: "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&h=500&fit=crop&q=80"
    },
    days: []
  }
];
