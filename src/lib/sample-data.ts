import type { TripData } from './types';

export const sampleTrips: TripData[] = [
  {
    trip: {
      name: "New York",
      subtitle: "Three Days in the City That Never Sleeps",
      dates: { start: "2026-05-15", end: "2026-05-17" },
      travelers: ["Thijs"],
      summary: "A 3-day whirlwind through Manhattan and Brooklyn \u2014 iconic landmarks, world-class museums, incredible food, and long walks through the city\u2019s best neighbourhoods.",
      hero_image: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&h=1600&fit=crop&crop=center&q=80",
      services: [],
      notes: [
        { title: "Getting Around", icon: "route", content: "Buy a 7-day unlimited MetroCard ($34) at any subway station. It covers all subway lines and local buses. Taxis and Uber are easy to find but expensive in rush hour. Walking is the best way to experience the city." },
        { title: "Money & Tipping", icon: "info", content: "Tip 18\u201320% at sit-down restaurants, $1\u20132 per drink at bars, $2\u20135 per bag for hotel porters. Tax (8.875%) is added at checkout \u2014 prices on menus don\u2019t include tax." },
        { title: "Emergency Contacts", icon: "warning", content: "Emergency: 911. Dutch Embassy in New York: +1 877-388-2443. Travel insurance: Allianz policy #TRV-2026-8847. Hotel: +1 212-581-3300." }
      ]
    },
    days: [
      {
        day_number: 1, date: "2026-05-15", title: "Arrival \u2192 Midtown & Downtown", subtitle: "Times Square, 9/11 Memorial & Little Italy",
        description: "Hit the ground running with a whirlwind first day through the heart of Manhattan \u2014 from the neon buzz of Times Square to the solemn beauty of the 9/11 Memorial, ending with a sunset walk across the Brooklyn Bridge.",
        hero_image: "https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?w=800&h=500&fit=crop&crop=center&q=80",
        stats: [{ icon: "footprints", label: "Walking", value: "~14 km" }, { icon: "clock", label: "Full day", value: "AM\u2013PM" }],
        blocks: [
          { time_label: "Morning", content: "Arrive JFK. Taxi or AirTrain + subway to Midtown. Drop bags at hotel.", type: "activity" },
          { time_label: "Late morning", content: "Walk through Times Square and up to the top of the Rockefeller Center (Top of the Rock) for panoramic skyline views.", type: "activity" },
          { time_label: "Afternoon", content: "Subway down to the 9/11 Memorial & Museum. Walk through the reflecting pools and spend time in the museum.", type: "activity" },
          { time_label: "Late afternoon", content: "Walk north through the Financial District and across to Little Italy and Chinatown. Browse the street stalls.", type: "activity" },
          { time_label: "Evening", content: "Dinner in Little Italy, then walk across the Brooklyn Bridge at sunset for skyline views.", type: "activity" }
        ],
        accommodation: {
          name: "The Manhattan at Times Square", price: "$680 (3 nights)", rating: "4\u2605", status: "booked", nights: 3,
          note: "Heart of Midtown, walking distance to Broadway and Central Park.",
          detail: {
            check_in: "3:00 PM", check_out: "11:00 AM", room_type: "Superior King Room",
            address: "790 7th Avenue, Midtown, New York, NY 10019",
            phone: "+1 212-581-3300", booking_platform: "Booking.com", confirmation: "3847291056",
            wifi: "Free", note: "Request high floor for city view."
          }
        },
        meals: [
          { type: "lunch", name: "Joe's Pizza", note: "Classic NYC slice \u2014 7 Carmine St, Greenwich Village", status: "pending",
            detail: { address: "7 Carmine St, Greenwich Village, NY 10014", phone: "+1 212-366-1182", cuisine: "Pizza", price_range: "$", hours: "Mon\u2013Sun 10am\u20135am", note: "Cash only. Grab a slice and eat standing \u2014 it's the NYC way." }
          },
          { type: "dinner", name: "Lombardi's Pizza", note: "America's first pizzeria \u2014 32 Spring St, Little Italy", status: "pending",
            detail: { address: "32 Spring St, Little Italy, NY 10012", phone: "+1 212-941-7994", cuisine: "Pizza \u00b7 Italian", price_range: "$$", hours: "Mon\u2013Sun 11:30am\u201311pm", note: "No slices \u2014 whole pies only. The classic Margherita is a must." }
          }
        ],
        transport: [
          { mode: "plane", label: "Flight to JFK", from: "Amsterdam (AMS)", to: "New York (JFK)", depart: "10:30", arrive: "13:45", duration: "8h 15m",
            detail: { flight: "DL47", terminal: "4", booking_ref: "KL7N2M", booking_platform: "delta.com", cabin_bag: "1\u00d7 carry-on + personal item", hold_bag: "1\u00d7 23kg included", check_in: "Opens 24h before departure", note: "Direct flight. Arrive 3h early for US immigration." }
          }
        ],
        tips: [
          { icon: "warning", title: "Arrive 3h early for immigration", content: "US immigration at JFK can take over an hour, especially in summer. Make sure to arrive at Schiphol at least 3 hours before departure. Have your ESTA confirmation ready on your phone.", priority: "high" },
          { icon: "info", title: "Get a MetroCard at JFK", content: "Buy an unlimited 7-day MetroCard ($34) at the AirTrain station. It covers all subway and bus rides for the entire trip \u2014 much cheaper than individual fares." }
        ]
      },
      {
        day_number: 2, date: "2026-05-16", title: "Central Park & Museums", subtitle: "The Met, Strawberry Fields & Upper West Side",
        description: "A full day of culture and green space \u2014 morning strolls through Central Park, world-class art at The Met, and an evening on Broadway.",
        hero_image: "https://images.unsplash.com/photo-1568515045052-f9a854d70bfd?w=800&h=500&fit=crop&crop=center&q=80",
        stats: [{ icon: "footprints", label: "Walking", value: "~16 km" }, { icon: "clock", label: "Full day", value: "AM\u2013PM" }],
        blocks: [
          { time_label: "Morning", content: "Early walk through Central Park \u2014 Bethesda Fountain, The Mall, Bow Bridge. Stop at Strawberry Fields (John Lennon memorial).", type: "activity" },
          { time_label: "Late morning", content: "The Metropolitan Museum of Art. Spend 2\u20133 hours exploring the Egyptian Temple of Dendur, European paintings, and rooftop garden.", type: "activity" },
          { time_label: "Afternoon", content: "Walk down Museum Mile. Grab lunch on the Upper East Side.", type: "options",
            options: [
              { label: "Guggenheim Museum", description: "Frank Lloyd Wright\u2019s iconic spiral building. Rotating modern art exhibitions.", duration: "1.5\u20132h", note: "Tickets $30 \u2014 book online to skip the queue" },
              { label: "Stroll the Upper East Side", description: "Window-shop on Madison Avenue, grab coffee, and people-watch in one of NYC\u2019s most elegant neighbourhoods.", duration: "1\u20131.5h" },
              { label: "Frick Collection", description: "Intimate art museum in a Gilded Age mansion \u2014 Vermeer, Rembrandt, and Bellini in a gorgeous setting.", duration: "1\u20131.5h", note: "Closed Mondays. $22 admission." }
            ]
          },
          { time_label: "Late afternoon", content: "Stroll through the American Museum of Natural History \u2014 dinosaur halls and the planetarium.", type: "activity" },
          { time_label: "Evening", content: "Dinner on the Upper West Side, then catch a Broadway show in the Theatre District.", type: "activity" }
        ],
        accommodation: { name: "The Manhattan at Times Square", price: "(night 2 of 3)", status: "booked", nights: 1, note: "Night 2 of 3" },
        meals: [
          { type: "breakfast", name: "Levain Bakery", note: "Famous cookies & pastries \u2014 167 W 74th St, Upper West Side", status: "pending" },
          { type: "lunch", name: "The Smith", note: "American brasserie \u2014 1900 Broadway, Upper West Side", status: "pending" },
          { type: "dinner", name: "Carmine's", note: "Family-style Italian \u2014 2450 Broadway. Share the veal parm.", status: "booked",
            detail: { address: "2450 Broadway, Upper West Side, NY 10024", phone: "+1 212-362-2200", cuisine: "Italian \u00b7 Family-style", price_range: "$$$", reservation: "7:00 PM \u2014 confirmed for 2", booking_platform: "OpenTable", hours: "Sun\u2013Thu 11am\u201311pm, Fri\u2013Sat 11am\u2013midnight", note: "Portions are huge \u2014 order family-style and share. The veal parm and pasta with vodka sauce are legendary." }
          }
        ],
        transport: [],
        tips: [
          { icon: "info", title: "Book Met tickets online", content: "Skip the line by buying timed-entry tickets at metmuseum.org. The suggested admission is $30 for adults. Friday evenings the museum is open until 9pm and less crowded." },
          { icon: "info", title: "Broadway show \u2014 TKTS booth", content: "Same-day discount Broadway tickets (up to 50% off) are available at the TKTS booth in Times Square. The line moves fast after 6pm. Check the app for what\u2019s available before queuing." }
        ]
      },
      {
        day_number: 3, date: "2026-05-17", title: "Brooklyn & Departure", subtitle: "DUMBO, High Line & Chelsea Market",
        description: "Make the most of a half day \u2014 Brooklyn waterfront views, the High Line\u2019s elevated gardens, and one last food crawl through Chelsea Market before heading to the airport.",
        hero_image: "https://images.unsplash.com/photo-1541336032412-2048a678540d?w=800&h=500&fit=crop&crop=center&q=80",
        stats: [{ icon: "footprints", label: "Walking", value: "~12 km" }, { icon: "clock", label: "Half day", value: "AM\u2013Afternoon" }],
        blocks: [
          { time_label: "Morning", content: "Subway to DUMBO, Brooklyn. Walk along the waterfront with Manhattan skyline views. Visit Brooklyn Bridge Park and Jane\u2019s Carousel.", type: "activity" },
          { time_label: "Late morning", content: "Coffee and brunch at a DUMBO caf\u00e9. Browse the shops under the bridge.", type: "activity" },
          { time_label: "Midday", content: "Subway back to Manhattan. Walk the High Line \u2014 the elevated park built on old railway tracks from Gansevoort St to Hudson Yards.", type: "activity" },
          { time_label: "Afternoon", content: "Chelsea Market for last bites \u2014 tacos, lobster rolls, artisan doughnuts. Pick up souvenirs.", type: "activity" },
          { time_label: "Late afternoon", content: "Collect bags from hotel. Taxi to JFK for evening flight home.", type: "transport" }
        ],
        accommodation: { name: "The Manhattan at Times Square", price: "(night 3 of 3, checkout)", status: "booked", nights: 1, note: "Check out by 11:00 AM, store bags at front desk" },
        meals: [
          { type: "breakfast", name: "Time Out Market DUMBO", note: "Multiple vendors \u2014 great coffee and pastries with a view", status: "pending" },
          { type: "lunch", name: "Chelsea Market", note: "Los Tacos No. 1 + Doughnuttery \u2014 75 9th Ave", status: "pending" }
        ],
        transport: [
          { mode: "car", label: "Taxi to JFK", from: "Times Square", to: "JFK Terminal 4", depart: "15:30", duration: "1h 15m", distance: "28 km", status: "pending",
            detail: { route: "Midtown Tunnel \u2192 I-495 E \u2192 Van Wyck Expressway", note: "Flat rate taxi from Manhattan to JFK: $70 + toll + tip. Allow extra time for rush hour traffic." }
          },
          { mode: "plane", label: "Flight home", from: "New York (JFK)", to: "Amsterdam (AMS)", depart: "19:30", arrive: "09:15+1", duration: "7h 45m",
            detail: { flight: "DL48", terminal: "4", booking_ref: "KL7N2M", booking_platform: "delta.com", check_in: "Opens 24h before departure", note: "Arrive 3h early. Duty-free shopping in Terminal 4." }
          }
        ]
      }
    ]
  }
];
