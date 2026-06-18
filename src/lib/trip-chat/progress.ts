export const DEFAULT_CHAT_STATUS_PHASES = [
  'Reading the trip...',
  'Planning the next step...',
  'Checking dates and stay details...',
  'Preparing the edit...',
  'Reviewing the result...',
  'Still working through the details...',
  'Writing the reply...',
] as const;

export const POLICY_RESEARCH_STATUS_PHASES = [
  'Finding the relevant stays...',
  'Checking current policies...',
  'Comparing source details...',
  'Saving concise notes...',
  'Reviewing the policy evidence...',
  'Writing the reply...',
] as const;

export type ChatProgressStage =
  | 'queued'
  | 'starting'
  | 'thinking'
  | 'reading'
  | 'checking'
  | 'researching'
  | 'editing'
  | 'booking'
  | 'reviewing'
  | 'writing'
  | 'done'
  | 'error';

export interface ChatProgressUpdate {
  stage: ChatProgressStage;
  message: string;
}

export interface ChatProgressEvent extends ChatProgressUpdate {
  id: string;
  turn_index: number;
  created_at: string;
}

const POLICY_RESEARCH_RE = /\b(dog|dogs|pet|pets|policy|policies|allowed|hotel|hotels|stay|stays|accommodation|accommodations)\b/i;

const TOOL_PROGRESS: Record<string, ChatProgressUpdate> = {
  get_trip: { stage: 'reading', message: 'Reading the current itinerary...' },
  get_date_ledger: { stage: 'checking', message: 'Checking the date and stay ledger...' },
  get_logistics_audit: { stage: 'checking', message: 'Running a logistics check...' },
  list_accommodations: { stage: 'reading', message: 'Reading the stay details...' },
  list_accommodation_review: { stage: 'reading', message: 'Reading the accommodation shortlist...' },
  update_trip: { stage: 'editing', message: 'Saving an itinerary edit...' },
  update_accommodation: { stage: 'editing', message: 'Saving the stay details...' },
  update_accommodation_detail: { stage: 'editing', message: 'Saving accommodation notes...' },
  upsert_activity: { stage: 'editing', message: 'Saving the activity change...' },
  delete_activity: { stage: 'editing', message: 'Removing an activity...' },
  upsert_meal: { stage: 'editing', message: 'Saving the meal change...' },
  delete_meal: { stage: 'editing', message: 'Removing a meal...' },
  upsert_transport: { stage: 'editing', message: 'Saving the transport change...' },
  delete_transport: { stage: 'editing', message: 'Removing a transport leg...' },
  research_place_policy: { stage: 'researching', message: 'Checking current policy sources...' },
  create_accommodation_candidate: {
    stage: 'editing',
    message: 'Adding an accommodation option...',
  },
  update_accommodation_candidate: {
    stage: 'editing',
    message: 'Updating the accommodation shortlist...',
  },
  move_accommodation_candidate: {
    stage: 'editing',
    message: 'Moving an accommodation option...',
  },
  promote_accommodation_candidate: {
    stage: 'editing',
    message: 'Promoting the booked stay into the trip...',
  },
  booking_link_restaurant: { stage: 'booking', message: 'Building a restaurant booking link...' },
  booking_link_hotel: { stage: 'booking', message: 'Building a hotel booking link...' },
  booking_link_flight: { stage: 'booking', message: 'Building a flight search link...' },
  booking_link_activity: { stage: 'booking', message: 'Building an activity booking link...' },
};

const APPLIED_TOOL_PROGRESS: Record<string, ChatProgressUpdate> = {
  update_trip: { stage: 'reviewing', message: 'Saved the itinerary edit.' },
  update_accommodation: { stage: 'reviewing', message: 'Saved the stay details.' },
  update_accommodation_detail: { stage: 'reviewing', message: 'Saved the accommodation notes.' },
  upsert_activity: { stage: 'reviewing', message: 'Saved the activity change.' },
  delete_activity: { stage: 'reviewing', message: 'Removed the activity.' },
  upsert_meal: { stage: 'reviewing', message: 'Saved the meal change.' },
  delete_meal: { stage: 'reviewing', message: 'Removed the meal.' },
  upsert_transport: { stage: 'reviewing', message: 'Saved the transport change.' },
  delete_transport: { stage: 'reviewing', message: 'Removed the transport leg.' },
  create_accommodation_candidate: {
    stage: 'reviewing',
    message: 'Added the accommodation option.',
  },
  update_accommodation_candidate: {
    stage: 'reviewing',
    message: 'Updated the accommodation shortlist.',
  },
  move_accommodation_candidate: {
    stage: 'reviewing',
    message: 'Moved the accommodation option.',
  },
  promote_accommodation_candidate: {
    stage: 'reviewing',
    message: 'Promoted the booked stay into the trip.',
  },
};

function normalizeToolName(toolName: string): string {
  return toolName.replace(/^mcp__trip_editor__/, '');
}

export function getChatStatusPhases(message: string): readonly string[] {
  return POLICY_RESEARCH_RE.test(message)
    ? POLICY_RESEARCH_STATUS_PHASES
    : DEFAULT_CHAT_STATUS_PHASES;
}

export function getToolProgressUpdate(toolName: string): ChatProgressUpdate {
  if (toolName === 'WebSearch') {
    return { stage: 'researching', message: 'Searching current sources...' };
  }
  if (toolName === 'AskUserQuestion') {
    return { stage: 'thinking', message: 'Preparing a clarifying question...' };
  }

  return (
    TOOL_PROGRESS[normalizeToolName(toolName)] ?? {
      stage: 'thinking',
      message: 'Working through the next step...',
    }
  );
}

export function getAppliedToolProgressUpdate(toolName: string | undefined): ChatProgressUpdate {
  const normalized = normalizeToolName(toolName ?? 'update_trip');
  return (
    APPLIED_TOOL_PROGRESS[normalized] ?? {
      stage: 'reviewing',
      message: 'Saved a trip update.',
    }
  );
}
