import { createAdminClient } from '@/lib/supabase/admin';
import bcrypt from 'bcryptjs';

/**
 * Validate an API key from the Authorization header.
 * Returns the user_id if valid, null otherwise.
 */
export async function validateApiKey(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);
  if (!apiKey) return null;

  const supabase = createAdminClient();

  // Fetch all active API keys (there should be very few per user)
  const { data: keys, error } = await supabase
    .from('api_keys')
    .select('id, user_id, key_hash');

  if (error || !keys?.length) return null;

  // Check the provided key against each stored hash
  for (const key of keys) {
    const match = await bcrypt.compare(apiKey, key.key_hash);
    if (match) {
      // Update last_used_at
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', key.id);

      return key.user_id;
    }
  }

  return null;
}

/**
 * Generate a new API key for a user.
 * Returns the plaintext key (only shown once) and stores the hash.
 */
export async function generateApiKey(userId: string, name = 'default'): Promise<string> {
  const supabase = createAdminClient();

  // Generate a random 32-char API key
  const rawKey = 'trp_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 32);

  const hash = await bcrypt.hash(rawKey, 10);

  const { error } = await supabase
    .from('api_keys')
    .insert({ user_id: userId, key_hash: hash, name });

  if (error) throw new Error(`Failed to create API key: ${error.message}`);

  return rawKey;
}
