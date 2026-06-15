# OurTrips MCP Readable Schema

Generated: June 8, 2026

This document explains the public OurTrips MCP connector in plain language. It is meant for reviewing what an external planning agent is being asked to deliver when it saves or updates trips for us.

It intentionally avoids implementation details. Field names and tool names are included because they are the shared vocabulary between the agent and OurTrips.

## Scope

This covers the remote OurTrips MCP connector exposed at `/mcp`.

The connector is named `ourtrips`. It lets an authenticated agent save, read, edit, enrich, image, and verify trips for the signed-in user.

There is also a separate in-app trip editor MCP used by the chat assistant inside a specific saved trip. That in-app editor is narrower and trip-scoped. This document focuses on the remote connector because it is the surface external agents use to deliver whole trips into OurTrips.

## One-Page Agent Contract

The agent is expected to act as more than a text generator. It must deliver a structured, map-aware, image-aware itinerary.

Core expectations:

- Use `save_trip_v3` for new or substantially rewritten trips when exact dates, sleeps/nights, hotel stay segments, or transport requirements matter.
- Use `save_trip_v2` only when you intentionally want quality/logistics warnings without the hard logistics gate.
- Use `get_trip_schema` or `get_trip_template` when unsure about structure.
- Use `get_trip_logistics_ledger` before answering questions about trip start/end dates, day count, nights/sleeps, where the traveler stays, or how long they spend somewhere.
- Use `validate_trip_contract` before claiming the trip is complete.
- Use smaller reads first: `summary`, `day`, `days`, or `sections`.
- Avoid full-trip reads unless intentionally requested with `allow_large`.
- Treat the connector as self-contained. The agent should rely on the MCP tools and schema guidance from this connector.
- Do not ask the user for an API key. OAuth is already handled.
- Use focused editing tools for one meal, hotel, transport leg, or activity.
- Use replacement tools when old nested data must disappear.
- Represent every visible named hotel, restaurant, activity site, and route stop as a specific item.
- Include place context when known: name, address, coordinates, Maps URL, or place ID.
- For each overnight stop without a booked hotel, create 2-4 private accommodation candidates, usually 3.
- Keep hotel options in the private Accommodations Reviewer, one candidate per hotel.
- Keep `days[].accommodation` single-choice: the booked/current stay or a clear placeholder such as `Hotel not confirmed yet`.
- Treat one public accommodation day as one sleep/night.
- Put restaurant reservations in `days[].meals[]`, one restaurant per meal entry.
- Do not use `trip.services` for restaurants.
- Give every day at least one useful, place-specific tip.
- Use real image URLs from image search for trip and day hero images.
- Save generated cover and social images separately in image asset slots.
- Check image status, logistics contract, or public data before claiming the trip is complete.

## Top-Level Trip Shape

An OurTrips itinerary is saved as three top-level parts.

| Part | Required | Meaning |
|---|---:|---|
| `trip_schema_version` | Recommended | Current quality-contract version. `save_trip_v2` sets this to `2`. |
| `trip` | Yes | Metadata for the whole trip: title, dates, travelers, summary, hero image, route, notes, services, and image assets. |
| `days` | Yes | The day-by-day itinerary. Each day has a 1-indexed `day_number`. |
| `markdown_source` | Optional | The original plan markdown, stored verbatim, up to 256 KB. Useful when long notes, tables, or source material do not fit cleanly into structured fields. |

## Trip Metadata

The `trip` object describes the whole journey.

| Field | Required | Meaning |
|---|---:|---|
| `name` | Yes | Human-readable trip name. Also used as the saved trip name. |
| `subtitle` | Yes | Short descriptive subtitle. |
| `dates.start` | Yes | Start date, expected as `YYYY-MM-DD`. |
| `dates.end` | Yes | End date, expected as `YYYY-MM-DD`. |
| `travelers` | Yes | List of traveler names. |
| `summary` | Yes | High-level trip summary. |
| `hero_image` | Yes | Main trip hero image URL. Should come from the image workflow, not be invented. |
| `overview_image` | Optional | Secondary trip-level image. |
| `image_assets` | Optional | Generated or externally hosted cover/social assets. |
| `route_points` | Optional | Coordinates for route map points. |
| `accent_color` | Optional | Visual accent color. |
| `services` | Optional | External logistics providers not otherwise represented in the itinerary. |
| `notes` | Optional | Trip-level notes with title and content. |

### Services Rule

Use `trip.services` only for external logistics or providers that are not already shown as transport, accommodation, meals, or activities.

Good uses:

- Insurance provider
- Car rental provider
- Tour company that spans multiple days and is not otherwise represented
- Visa/document support

Bad uses:

- Restaurant reservations
- A list of restaurant options
- Hotels already shown in day accommodation
- Trains, flights, ferries, or drives already shown in day transport
- Activities already shown in day blocks

## Day Shape

Each day describes one calendar day in the itinerary.

| Field | Required | Meaning |
|---|---:|---|
| `day_number` | Yes | 1-indexed day number. Used for reads, patches, replacements, and deletes. |
| `date` | Yes | Date, expected as `YYYY-MM-DD`. |
| `title` | Yes | Day title. |
| `subtitle` | Optional | Short day subtitle. |
| `description_title` | Recommended | Editorial intro heading for the day. |
| `description` | Recommended | Editorial intro body for the day. |
| `day_type` | Recommended | Example values: `arrival`, `departure`, `travel`, `full`, `rest`. |
| `pace` | Recommended | Example values: `light`, `balanced`, `full`. |
| `hero_image` | Recommended | Day hero image URL, usually landscape. |
| `stats` | Optional | Small facts such as distance, driving time, or walking time. |
| `blocks` | Recommended | Actual programme items: sights, walks, museums, excursions, timed activities. |
| `transport` | Recommended when relevant | Travel legs for the day. |
| `accommodation` | Recommended when relevant | Hotel or stay for that day. Can be empty/null. |
| `meals` | Recommended | Restaurants, cafes, food stops, or meal guidance. |
| `tips` | Recommended | Practical, place-specific tips. At least one per day is expected. |
| `alternatives` | Optional | Rainy-day, tired-day, cheaper, lighter, or kid-friendly versions. |

### Day Intro Rule

Use `description_title` and `description` for the day intro.

Do not create a programme block just to introduce the day.

## Logistics Contract

The logistics contract is the strict arithmetic layer for dates, sleeps, stay segments, and transport requirements.

Canonical terms:

- `day`: one calendar itinerary date.
- `sleep` or `night`: one overnight stay. Check-in date is inclusive; check-out date is exclusive.
- `stay segment`: one hotel or stay across contiguous sleeps.
- `transport leg`: one movement from an origin to a destination on a specific itinerary day.

Hard logistics errors include:

- `trip.dates.start` and `trip.dates.end` are not real `YYYY-MM-DD` calendar dates.
- The number of itinerary days does not equal the inclusive calendar range.
- Day numbers are not continuous in array order.
- Day dates do not increase exactly one calendar day at a time.
- A public accommodation's `nights` count does not match its contiguous accommodation days.
- A scheduled, booked, or required transport leg is missing `from` or `to`.
- A booked scheduled transport leg is missing `depart`.

Use `get_trip_logistics_ledger` for compact date and stay answers: start date, end date, inclusive day count, scheduled sleeps, day-by-day sleep location, and nights by stay.

Use `validate_trip_contract` to get the compact repair report: hard errors, warnings, open questions, and the full logistics audit.

## Programme Blocks

Programme blocks live in `days[].blocks[]`.

They should be actual itinerary actions: sights, museums, viewpoints, walks, excursions, local activities, or timed plan items.

| Field | Required | Meaning |
|---|---:|---|
| `time_label` | Yes | Visible time label, such as `09:00`, `09:00-11:00`, `Morning`, or `Evening`. |
| `content` | Yes | The main visible activity text. |
| `type` | Yes | Category such as `activity`, `walk`, `museum`, `meal`, `transport`, or another clear label. |
| `starts_at` | Optional | Start time as `HH:mm` when known. |
| `ends_at` | Optional | End time as `HH:mm` when known. |
| `time_precision` | Recommended | Explains how trustworthy the time is. |
| `duration_minutes` | Optional | Numeric duration. |
| `place` | Recommended | Map-ready place details. |
| `booking_status` | Recommended when relevant | Whether this item is booked, open, pending, optional, etc. |
| `reservation_required` | Optional | Whether a reservation is needed. |
| `cost_hint` | Optional | Price or budget hint. |
| `pace` | Optional | Pace impact: light, balanced, full, or similar. |
| `detail` | Optional | Rich explanatory detail. |
| `options` | Optional | Simple options inside this block. |
| `alternatives` | Optional | Alternative ways to do this block. |

### Time Precision

Use `time_precision` whenever there is a specific time or planned time window.

| Value | Meaning |
|---|---|
| `fixed` | A real constraint: booked transport, booked entry time, restaurant reservation, researched opening-time dependency. |
| `suggested` | An AI-planned exact time that can move if needed. |
| `window` | A broad time of day: morning, afternoon, evening, sunset, late, etc. |

The quality checker warns when exact times appear without this context.

## Place Shape

Places can appear on activities and meals, and route context can appear at trip level.

| Field | Required | Meaning |
|---|---:|---|
| `name` | Yes | Specific place name. |
| `address` | Optional | Street address or local address text. |
| `lat` | Optional | Latitude. |
| `lng` | Optional | Longitude. |
| `google_maps_url` | Optional | Maps URL. |
| `place_id` | Optional | Google place ID or similar stable place identifier. |
| `note` | Optional | Place-specific note. |

### Map Contract

Every visible named hotel, restaurant, activity site, and meaningful route stop should be represented once as a specific place or route item.

Avoid vague combined entries such as:

- Three restaurant names in one meal note
- Several hotels in one accommodation title
- A route stop only mentioned in prose
- A whole city walking route without specific stops when the stops are named elsewhere

## Transport

Transport lives in `days[].transport[]`.

Use it for flights, trains, buses, ferries, drives, transfers, routes, and meaningful travel legs.

| Field | Required | Meaning |
|---|---:|---|
| `mode` | Yes | Transport mode: flight, train, car, ferry, bus, transfer, walk, etc. |
| `label` | Yes | Human-readable transport label. |
| `from` | Recommended | Origin. |
| `to` | Recommended | Destination. |
| `depart` | Recommended when scheduled | Departure time or label. |
| `arrive` | Recommended when scheduled | Arrival time or label. |
| `duration` | Recommended | Duration. |
| `distance` | Optional | Distance. |
| `status` | Optional | Status label. |
| `booking_status` | Recommended when bookable | Booked, confirmed, open, pending, optional, etc. |
| `reservation_required` | Optional | Whether a booking/reservation is needed. |
| `cost_hint` | Optional | Price or budget hint. |
| `detail` | Optional | Transport-specific detail. |

Useful transport detail fields:

| Field | Meaning |
|---|---|
| `class` | Cabin/class such as economy, first, sleeper, etc. |
| `cabin` | Cabin information. |
| `seats` or `seat` | Seat information. |
| `booking_ref` | Real booking reference. Never invent this. |
| `booking_platform` | Booking source or platform. |
| `flight` | Flight number. |
| `terminal` | Airport terminal. |
| `gate` | Gate if known. |
| `platform` | Train or bus platform if known. |
| `check_in` | Check-in guidance. |
| `cancellation_policy` | Cancellation rules. |
| `route` | Route notes. |
| `charging_stops` | EV charging stops. |
| `border` | Border crossing notes. |
| `wallet_items` | Confirmations, tickets, QR codes, PDFs, or private references. |

## Accommodation

Accommodation lives in `days[].accommodation`.

Use one accommodation object per day where relevant. It can be repeated across adjacent days for a multi-night stay.

The public itinerary accommodation is single-choice. It should be the booked/current stay, or a clear placeholder such as `Hotel not confirmed yet` while options are still under review. It should not contain a shortlist, slash-separated hotel names, or several options in one note.

One accommodation day equals one sleep/night. A 3-night hotel stay should appear on 3 contiguous itinerary days with `nights: 3`; the check-out date is the day after the final sleep.

| Field | Required | Meaning |
|---|---:|---|
| `name` | Yes | Hotel, apartment, campsite, or stay name. |
| `price` | Optional | Price text. |
| `rating` | Optional | Rating text. |
| `status` | Recommended | Open, pending, booked, optional, etc. |
| `booking_status` | Recommended | Normalized booking state. |
| `reservation_required` | Optional | Whether action is required. |
| `cost_hint` | Optional | Price or budget hint. |
| `nights` | Optional | Number of nights. |
| `note` | Optional | Short visible note. |
| `detail` | Optional | Accommodation-specific detail. |

Useful accommodation detail fields:

| Field | Meaning |
|---|---|
| `check_in` | Check-in time or instructions. |
| `check_out` | Check-out time or instructions. |
| `room_type` | Room type. |
| `address` | Address. |
| `phone` | Phone number. |
| `direct_website_url` | Direct website URL. |
| `direct_website_label` | Label for the direct website. |
| `confirmation` | Real confirmation number. Never invent this. |
| `booking_platform` | Booking source or platform. |
| `cancellation_deadline` | Cancellation deadline. |
| `wifi` | Wi-Fi details. |
| `parking` | Parking details. |
| `policy_source_url` | Source used for policy information. |
| `policy_source_label` | Human-readable policy source. |
| `policy_confidence` | High, medium, or low confidence. |
| `dog_note` | Pet/dog policy notes. |
| `wallet_items` | Confirmations, vouchers, PDFs, QR codes, or private references. |

### Hotel Swap Rule

When changing from one hotel to a different hotel, the agent should use a replacement-style tool. A merge can leave stale nested details from the previous hotel.

Good tools for hotel swaps:

- `replace_accommodation`
- `replace_day_section`
- `replace_day`
- `patch_trip` with replacement semantics

## Accommodation Candidates

Accommodation candidates live in the private Accommodations Reviewer, not in the public itinerary day card.

Use candidates for hotel shortlists and decision workflow. For each overnight stop without a booked hotel, the agent should usually create 3 candidates. Two is fine for constrained places; four is fine when there are meaningfully different options. Each candidate is one hotel.

Review lanes:

| Lane | Meaning |
|---|---|
| `proposed` | Travel-agent proposal, not yet actively chosen. |
| `considering` | Under consideration. |
| `dismissed` | Rejected or no longer suitable. |
| `booked` | Selected/booked hotel. Promoting to booked updates the public itinerary. |

Candidate fields:

| Field | Required | Meaning |
|---|---:|---|
| `candidate` | Yes | Hotel/stay name. |
| `directWebsite` | Yes for new candidates | Official/direct hotel website. Avoid OTA/search-result URLs here. |
| `ratings` | Yes for new candidates | Checked customer-review ratings. |
| `destinationId` | Recommended | Destination ID from the accommodation review. |
| `stop` | Recommended | Destination/stop name. |
| `dates` | Recommended | Stay date label. |
| `nights` | Recommended | Number of nights. |
| `lane` | Optional | Defaults to proposed. |
| `price` | Optional | Price or rate hint. |
| `dog` | Optional | Dog/pet policy note. |
| `parking` | Optional | Parking note. |
| `terms` | Optional | Cancellation or booking terms. |
| `why` | Recommended | Why this option fits. |
| `blockers` | Optional | Watch-outs or reasons to verify. |
| `action` | Optional | Next action needed. |
| `alternatives` | Optional | Comparison/alternative notes. |
| `links` | Optional | Additional useful links. |
| `rateCheck` | Optional | Direct/OTA rate comparison. |
| `dayNumbers` | Recommended | Related itinerary day numbers. |
| `checkInDate` | Optional | Check-in date. |
| `checkOutDate` | Optional | Check-out date. |
| `address` | Optional | Address. |
| `roomType` | Optional | Room type. |
| `checkIn` | Optional | Check-in time/instructions. |
| `checkOut` | Optional | Check-out time/instructions. |
| `phone` | Optional | Phone number. |
| `wifi` | Optional | Wi-Fi note. |
| `policySource` | Optional | Source for policy details. |
| `policyConfidence` | Optional | High, medium, or low. |
| `hotelNote` | Optional | Internal decision note. |
| `booking` | Optional | Real booking details. Never invent confirmations. |

Ratings should include when the check happened plus values for Booking.com, Tripadvisor, and Google. Use `Not found` only when that source was actually checked.

When a candidate has `destinationId`, OurTrips derives `stop`, `dates`, `nights`, `dayNumbers`, `checkInDate`, and `checkOutDate` from the Accommodations Reviewer destination. Agents should pass the destination ID instead of retyping date arithmetic.

Recommended candidate workflow:

1. Use `list_accommodation_review` after saving the trip.
2. For each unbooked overnight stop, create 2-4 candidates with `create_accommodation_candidate`, usually 3.
3. Use `update_accommodation_candidate` as research gets better.
4. Use `move_accommodation_candidate` to move options between proposed, considering, dismissed, and booked.
5. Use `promote_accommodation_candidate` when the user confirms one hotel should become the booked/current stay.
6. Use `replace_booked_accommodation_candidate` when changing from one booked candidate to another.

## Meals

Meals live in `days[].meals[]`.

One meal entry should equal one restaurant, cafe, bar, bakery, explicit food stop, or meal recommendation.

| Field | Required | Meaning |
|---|---:|---|
| `type` | Yes | Breakfast, lunch, dinner, cafe, snack, bar, tasting, etc. |
| `name` | Yes | Specific venue name or clear meal label. |
| `note` | Optional | Short visible note. |
| `status` | Optional | Status label. |
| `starts_at` | Optional | Meal start time as `HH:mm`. |
| `ends_at` | Optional | Meal end time as `HH:mm`. |
| `time_precision` | Recommended when timed | Fixed, suggested, or window. |
| `booking_status` | Recommended when reservable | Booked, confirmed, open, pending, optional, etc. |
| `reservation_required` | Recommended when relevant | Whether reservation action is needed. |
| `cost_hint` | Optional | Price or budget hint. |
| `place` | Recommended | Map-ready restaurant/place details. |
| `detail` | Optional | Meal-specific detail. |

Useful meal detail fields:

| Field | Meaning |
|---|---|
| `title` | Detail heading. |
| `body` | Detail body. |
| `why` | Why this meal fits the trip. |
| `vibe` | Atmosphere. |
| `cuisine` | Cuisine type. |
| `price_range` | Price range. |
| `reservation` | Reservation detail. |
| `booking_platform` | Booking source or platform. |
| `what_to_order` | Suggested dishes. |
| `booking_note` | Reservation guidance. |
| `address` | Address. |
| `phone` | Phone number. |
| `hours` | Opening hours. |
| `wallet_items` | Booking confirmations, vouchers, QR codes, PDFs, or notes. |

### Restaurant Reservation Rule

Restaurant reservations belong in `days[].meals[]`.

Do not put restaurant reservations in `trip.services`.

Do not combine multiple restaurants into one meal object, note, or reservation field.

## Tips

Tips live in `days[].tips[]`.

| Field | Required | Meaning |
|---|---:|---|
| `title` | Yes | Tip title. |
| `content` | Yes | Useful, practical content. |
| `icon` | Optional | Small visual/category hint. |
| `priority` | Optional | High or normal priority. |

Quality expectations:

- At least one practical, place-specific tip per day.
- No empty tip objects.
- No title-only placeholders.
- Good tips cover routing, booking timing, local etiquette, backup moves, safety, weather, or what to skip.

## Route Points

Route points live in `trip.route_points[]`.

They support route maps and trip geography.

| Field | Required | Meaning |
|---|---:|---|
| `label` | Yes | Visible route point label. |
| `lat` | Yes | Latitude. |
| `lng` | Yes | Longitude. |
| `day` | Optional | Related day number. |
| `mode` | Optional | Travel mode or route context. |
| `role` | Optional | Route role. |

Known route roles:

| Role | Meaning |
|---|---|
| `home` | Home/base point. |
| `stop` | General stop. |
| `stay` | Overnight stay. |
| `excursion` | Side trip or excursion. |
| `trail` | Trail or route segment. |
| `return` | Return point. |

## Alternatives

Alternatives can live on days or programme blocks.

| Field | Required | Meaning |
|---|---:|---|
| `label` | Yes | Short alternative name. |
| `description` | Yes | What changes in this alternative. |
| `trigger` | Optional | Rainy, tired, kid-friendly, cheaper, lighter, free-time, etc. |
| `duration` | Optional | Duration hint. |
| `cost_hint` | Optional | Price or budget hint. |

## Rich Detail

Many itinerary items can use a `detail` object for richer explanatory content.

Common detail fields:

| Field | Meaning |
|---|---|
| `title` | Detail heading. |
| `body` | Main explanatory body. |
| `why` | Why this choice fits the trip. |
| `vibe` | Atmosphere or travel feel. |
| `highlights` | Highlight list. |
| `what_to_see` | What to see. |
| `how_to_do_it` | Practical execution guidance. |
| `practical` | Practical notes. |
| `booking_note` | Booking advice or requirement. |
| `dog_note` | Pet/dog-related note where relevant. |
| `wallet_items` | Confirmations, tickets, QR codes, PDFs, vouchers, or private notes. |

## Travel Wallet Items

Wallet items can attach confirmations, tickets, files, QR codes, and private details to rich details.

| Field | Required | Meaning |
|---|---:|---|
| `title` | Yes | Human-readable item name. |
| `type` | Optional | Confirmation, ticket, voucher, QR, PDF, note, etc. |
| `url` | Optional | Public or private URL. |
| `file_url` | Optional | File URL. |
| `qr_code_url` | Optional | QR code URL. |
| `confirmation` | Optional | Real confirmation/reference. Never invent this. |
| `note` | Optional | Additional note. |
| `is_private` | Optional | Whether this item should be treated as private. |

## Image Schema

OurTrips separates real hero images from generated cover/social assets.

### Hero Images

Hero images appear in:

- `trip.hero_image`
- `trip.overview_image`
- `days[].hero_image`

The connector asks agents to search for real images through `search_trip_images`, then save the selected URL through `set_trip_image`.

Search result URLs include:

| Field | Meaning |
|---|---|
| `landscape` | Landscape crop, recommended for day hero images. |
| `portrait` | Portrait crop, recommended for trip hero images. |
| `download_url` | Unsplash tracking URL. Should be passed back when saving the selected image. |
| `description` | Image description. |
| `photographer` | Photographer name. |
| `photographer_url` | Photographer attribution URL. |

### Generated Image Assets

Generated or externally hosted images live in `trip.image_assets`.

Available slots:

| Slot | Meaning |
|---|---|
| `cover_portrait` | Generated 9:16 mobile cover. |
| `cover_landscape` | Generated 3:2 wide cover. |
| `social_og` | Generated 1.91:1 social preview. |

Asset fields:

| Field | Required | Meaning |
|---|---:|---|
| `url` | Yes | Hosted image URL. |
| `prompt` | Optional | Prompt used to generate the image. |
| `aspect_ratio` | Optional | Aspect ratio text. |
| `width` | Optional | Pixel width. |
| `height` | Optional | Pixel height. |
| `provider` | Optional | Image generation provider. |
| `model` | Optional | Image model. |
| `source` | Optional | `imagegen`, `manual`, or `search`. Defaults to manual if omitted. |
| `generated_at` | Optional | Generation timestamp. Defaults to save time if omitted. |

Recommended image workflow:

1. Use `search_trip_images` for real Unsplash trip/day hero images.
2. Use `set_trip_image` for selected trip, overview, or day hero images.
3. Use `get_trip_image_prompts` to generate grounded cover/social prompts.
4. Create and host generated images outside this MCP.
5. Use `save_trip_image_asset` to save the hosted generated image URL.
6. Use `get_trip_image_status` or `verify_trip_public_data` before saying the trip is done.

## Quality Contract

`save_trip_v3` applies the current quality contract plus the strict logistics contract. `save_trip_v2` returns the same quality/logistics report but does not reject logistics errors unless `strict_quality` is true.

What it normalizes:

- Sets `trip_schema_version` to `2`.
- Infers missing day type when possible.
- Infers missing pace when possible.
- Copies `status` into `booking_status` where useful.
- Adds meal place names from meal names when missing.
- Pulls `starts_at` and `ends_at` from exact time labels where possible.
- Marks exact booked times as `fixed` and other exact planned times as `suggested` when possible.
- Marks broad time labels like morning or evening as `window` when possible.

Hard errors:

- A v2 itinerary must include at least one day.
- The strict logistics contract has date, sleep/night, stay segment, or transport leg errors.

Warnings:

| Warning area | What triggers it |
|---|---|
| Missing day intro | A day lacks `description_title` and `description`. |
| Sparse programme | A full, arrival, or travel day usually has fewer than 3 programme blocks. |
| Overpacked programme | A day has more than 6 programme blocks. |
| Missing time structure | Programme exists but no time labels or start times are present. |
| Unqualified exact time | Exact time is used without `time_precision`. |
| Missing map targets | No clear hotel, meal, transport, activity place, or route target exists for the day. |
| Missing meals | A full programme day has no meal suggestion or reservation note. |
| Missing tips | A day has no practical tip. |
| Missing accommodation status | Accommodation exists but does not say whether it is booked, open, pending, or optional. |

Quality report output includes:

- Warning messages.
- Hard error messages.
- Issue list with level, code, path, and message.
- Per-day readiness summary.
- Total day count.
- Ready day count.
- Count of open action items.

Strict quality mode:

- `save_trip_v3` defaults `strict_quality` to true.
- `save_trip_v2` only rejects hard errors when `strict_quality` is true.
- Warnings are returned for repair guidance but do not block saving.

## Tool Catalog

### Reference And Templates

| Tool | What it asks the agent for | What it returns |
|---|---|---|
| `get_trip_schema` | Optional schema section name. | Plain schema guidance for overview, trip, day, meals, images, quality, patching, and related sections. |
| `get_trip_template` | Optional template name. | Compact examples for common save, edit, read, and image workflows. |

### Trip Save And Read

| Tool | Use when | Key inputs |
|---|---|---|
| `save_trip_v3` | Creating or substantially rewriting a trip with strict logistics. Preferred save tool. | `trip`, `days`, optional `markdown_source`, optional `trip_id`, optional `strict_quality` defaulting to true. |
| `save_trip_v2` | Creating or substantially rewriting a trip when warnings are acceptable. | `trip`, `days`, optional `markdown_source`, optional `trip_id`, optional `strict_quality`. |
| `save_trip` | Legacy save flow. | `trip`, `days`, optional `markdown_source`, optional `trip_id`. |
| `list_trips` | Finding saved trips for the authenticated user. | No inputs. |
| `get_trip` | Reading a saved trip. Prefer smaller views. | `trip_id`, `view`, optional day filters, optional sections, optional markdown inclusion, optional `allow_large`. |
| `get_trip_logistics_ledger` | Reading the compact canonical date/stay ledger before date, night, stay, or route-shape reasoning. | `trip_id`. |
| `validate_trip_contract` | Checking exact dates, sleeps/nights, stay segments, transport legs, and quality before claiming completion. | `trip_id`, optional `response_mode`. |

### Trip Editing

| Tool | Use when | Key inputs |
|---|---|---|
| `patch_trip` | Updating selected metadata, days, markdown, or safe paths. | `trip_id`, optional `trip`, optional `days`, optional `markdown_source`, optional `mode`, optional replacement/delete paths. |
| `replace_day` | Rewriting a whole day or changing destination/day structure. | `trip_id`, `day_number`, complete replacement day. |
| `replace_day_section` | Replacing one whole day section. | `trip_id`, `day_number`, section name, new value. |
| `delete_day` | Removing one day. | `trip_id`, `day_number`. |
| `truncate_days_after` | Shortening a trip by removing trailing days. | `trip_id`, `keep_through_day_number`. |
| `sync_markdown_source` | Replacing only the stored original markdown. | `trip_id`, `markdown_source`, optional expected hash. |
| `update_from_markdown` | Replacing markdown and optionally applying parsed structured trip/day data. | `trip_id`, `markdown_source`, optional parsed `trip`, optional parsed `days`, optional mode. |

### Accommodation Review

These tools manage private hotel candidates. They are for shortlists and decision workflow; the public itinerary accommodation remains single-choice.

| Tool | Use when | Key inputs |
|---|---|---|
| `list_accommodation_review` | Reading overnight destinations and current hotel candidates. | `trip_id`, optional `response_mode`. |
| `create_accommodation_candidate` | Adding one hotel proposal card. Call once per hotel; usually create 3 candidates per unbooked stop. | `trip_id`, candidate object, optional destination, optional message. |
| `update_accommodation_candidate` | Updating facts or decision notes for one candidate. | `trip_id`, `candidate_id`, candidate patch, optional message. |
| `move_accommodation_candidate` | Moving a candidate between proposed, considering, dismissed, and booked. Moving to booked also updates the public itinerary. | `trip_id`, `candidate_id`, lane, optional booking details. |
| `promote_accommodation_candidate` | Marking one candidate as booked/current and promoting it into the public itinerary. | `trip_id`, `candidate_id`, optional booking details. |
| `replace_booked_accommodation_candidate` | Switching a destination from one booked candidate to another. | `trip_id`, `candidate_id`, optional booking details. |

### Focused Day-Item Editing

Use these instead of replacing whole arrays when changing one item.

| Tool | Item type | Use when |
|---|---|---|
| `upsert_meal` | Meal/restaurant | Add or update one meal without replacing the whole meals list. |
| `delete_meal` | Meal/restaurant | Delete one meal by index, name, type, or match fields. |
| `upsert_accommodation` | Hotel/stay | Add or update accommodation for one day or matching adjacent stay days. |
| `delete_accommodation` | Hotel/stay | Clear accommodation for one day or matching stay days. |
| `replace_accommodation` | Hotel/stay | Swap hotels safely so stale details do not survive. |
| `upsert_transport` | Transport leg | Add or update one transport leg without replacing the whole transport list. |
| `delete_transport` | Transport leg | Delete one transport leg by index, route, mode, label, or match fields. |
| `upsert_activity` | Programme block | Add or update one actual activity/programme item. |
| `delete_activity` | Programme block | Delete one activity by index, title, time label, type, or content match. |

Common focused-edit inputs:

| Input | Meaning |
|---|---|
| `trip_id` | Saved trip ID. |
| `day_number` | Day to edit. |
| Item object | Meal, accommodation, transport, or activity content. |
| `match` | How to find the existing item. |
| `mode` | Merge or replace. |
| `position` | Append or prepend for new array items. |
| `scope` | For accommodation: one day or all days with matching accommodation name. |
| `response_mode` | Compact summary or full updated trip. |

Match fields:

| Field | Meaning |
|---|---|
| `index` | Array index returned by a prior read. |
| `name` | Match by name. |
| `label` | Match by label. |
| `title` | Match by title, label, name, or detail title. |
| `type` | Match by type. |
| `mode` | Match by transport mode. |
| `from` | Match by transport origin. |
| `to` | Match by transport destination. |
| `time_label` | Match by visible programme time label. |
| `content_contains` | Match an activity whose content includes text. |

### Image And Verification Tools

| Tool | Use when | Key inputs |
|---|---|---|
| `search_trip_images` | Finding real Unsplash-backed image URLs. | Search query and optional orientation. |
| `set_trip_image` | Saving a trip hero, overview image, or day hero image. | `trip_id`, target, URL, optional day number, optional Unsplash download URL. |
| `get_trip_image_status` | Checking image coverage. | `trip_id`. |
| `get_trip_image_prompts` | Getting grounded prompts for generated covers/social assets. | `trip_id`. |
| `save_trip_image_asset` | Saving an externally generated/hosted image asset. | `trip_id`, slot, asset. |
| `verify_trip_public_data` | Checking the public trip endpoint and page. | `trip_id` or `share_id`, optional page check flag. |

## Read Views

`get_trip` has several read modes.

| View | Meaning |
|---|---|
| `summary` | Compact trip metadata, day summaries, markdown summary, and image status. Default view. |
| `day` | One complete day. Requires `day_number`. |
| `days` | Selected complete days, chosen by day numbers or day range. |
| `sections` | Selected fields only, such as images, meals, accommodation, route points, quality, or notes. |
| `full` | Full saved record. Requires `allow_large=true` because trips can exceed agent token limits. |

Selectable sections:

- `trip`
- `markdown_source`
- `days`
- `images`
- `image_assets`
- `blocks`
- `transport`
- `accommodation`
- `meals`
- `tips`
- `stats`
- `route_points`
- `quality`
- `services`
- `notes`

Markdown source behavior:

- By default, reads return a markdown summary with presence, length, and hash.
- Full markdown is only returned in sections view when `include_markdown_source` is true.

## Patching Rules

There are two patching modes.

| Mode | Meaning |
|---|---|
| `merge` | Objects are deep-merged. Omitted nested keys remain. |
| `replace` | The addressed object or section is replaced. Old nested keys disappear. |

Important array rule:

- In `patch_trip`, arrays are replaced as complete arrays when included.
- For one meal, one transport leg, one activity, or one hotel, use the focused upsert/delete tools instead.

Safe path edits:

- `replace_paths` replaces exact safe paths.
- `delete_paths` deletes exact safe paths.
- Required roots `trip` and `days` cannot be deleted or replaced through path edits.
- Paths can target a day by day number, a property, or an array index.

Concurrency note for markdown:

- `sync_markdown_source` and `update_from_markdown` can use an expected current markdown hash.
- If the stored markdown changed since the agent last read it, the update fails instead of silently overwriting.

## Tool Outputs

### Save Output

Saving returns:

| Field | Meaning |
|---|---|
| `trip_id` | Saved trip ID. |
| `share_id` | Public share ID. |
| `url` | Shareable trip URL. |
| `status` | Created or updated. |
| `day_count` | Number of days saved. |
| `image_status` | Image coverage summary. |
| `quality` | v2 quality report when using `save_trip_v2`. |
| `accommodation_review` | Whether accommodation review data synced. |

### Mutation Output

Most edit tools return a compact mutation summary unless `response_mode` asks for the full updated trip.

Mutation summaries include:

| Field | Meaning |
|---|---|
| `trip_id` | Saved trip ID. |
| `share_id` | Public share ID. |
| `url` | Shareable URL. |
| `status` | Updated. |
| `updated_at` | Update timestamp. |
| `changed_paths` | Paths changed by the edit. |
| `warnings` | Edit warnings, such as array replacement warnings or stale hotel merge risks. |
| `markdown_source` | Markdown presence, length, hash, and sometimes previous hash. |
| `image_status` | Image coverage summary after the edit. |

### Image Status Output

Image status includes:

| Area | Meaning |
|---|---|
| `trip_hero_image` | Whether the main trip hero image is present. |
| `overview_image` | Whether the overview image is present. |
| `day_hero_images` | How many day heroes are present, total day count, and missing day numbers. |
| `image_assets` | Whether cover portrait, cover landscape, and social preview assets are present. |

## What This Asks Of The Agent

The MCP asks the agent to deliver a complete travel product, not just a nice itinerary draft.

The agent has to:

- Plan the trip day by day.
- Convert prose into structured fields.
- Keep days map-ready.
- Separate activities, meals, accommodation, transport, services, tips, and images.
- Track booking/action status.
- Preserve original markdown when useful.
- Use replacement tools when edits could leave stale information.
- Choose and save real hero images.
- Generate or coordinate cover/social assets outside the MCP, then save their hosted URLs.
- Read and verify the saved result before declaring success.

This is a fairly high bar. The schema is permissive in some places, but the quality contract makes the real expectation much stricter: a trip should be practical, structured, visible on maps, image-complete, and safe to edit later.

## Review Checklist

Use this checklist to evaluate agent-delivered trips.

Trip metadata:

- Name, subtitle, date range, travelers, summary, and trip hero image are present.
- Route points exist when the route/geography matters.
- Services are not used for restaurants, hotels, ordinary transport, or normal activities.

Days:

- Every day has day number, date, and title.
- Every full/travel/arrival day has a useful intro.
- Programme blocks are real activities, not intro prose.
- Full days usually have 3 to 6 programme blocks.
- Times are marked as fixed, suggested, or window.
- Each day has at least one practical tip.
- Full days include at least one meal suggestion or reservation note.

Map readiness:

- Hotels have specific names.
- Restaurants are separate meal entries.
- Named sights and stops are represented individually.
- Known places include address, coordinates, Maps URL, or place ID.

Booking/action readiness:

- Hotels have booked/open/pending/optional status.
- Unbooked overnight stops have 2-4 private accommodation candidates, usually 3.
- Hotel candidates are separate cards, one hotel per candidate.
- Public accommodation cards do not contain hotel shortlists.
- Reservable meals say whether a reservation is required and what the booking status is.
- Transport booking status is clear when relevant.
- Confirmation numbers and private references are only included when real.

Images:

- Trip hero is present.
- Day hero coverage is checked.
- Generated cover/social slots are saved when expected.
- Unsplash URLs came from search and include download tracking when available.

Editing safety:

- Hotel swaps used replacement semantics.
- Item-level changes used focused tools.
- Whole arrays were not accidentally replaced in a broad patch.
- Markdown-only updates were not mistaken for rendered itinerary updates.

## High-Risk Failure Patterns

Common ways an agent can produce a weak or unsafe trip:

- Saving a polished markdown plan without structured `trip` and `days`.
- Using `save_trip` instead of `save_trip_v2` for a new trip.
- Combining several restaurants into one meal entry.
- Combining several hotels into one accommodation entry or one candidate.
- Mentioning hotel options only in markdown/prose without creating private accommodation candidates.
- Creating only one hotel option for an unbooked stop when there should be a real shortlist.
- Putting restaurant reservations in `trip.services`.
- Mentioning places in prose but not giving them place/map structure.
- Creating exact times without saying whether they are fixed or suggested.
- Replacing a hotel by merge and leaving old address, phone, policy, or confirmation details behind.
- Updating markdown only and assuming the rendered trip changed.
- Inventing Unsplash URLs, confirmation numbers, place IDs, or booking references.
- Skipping image status/public verification before saying the trip is done.
