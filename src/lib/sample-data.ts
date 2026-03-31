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
