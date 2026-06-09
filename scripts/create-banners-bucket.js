// Creates the banners Supabase storage bucket if it doesn't already exist
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function main() {
  const BUCKET = 'banners';

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error('Failed to list buckets:', listErr.message);
    process.exit(1);
  }

  const exists = buckets.some(b => b.name === BUCKET);
  if (exists) {
    console.log(`✓ Bucket "${BUCKET}" already exists — nothing to do.`);
    return;
  }

  const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });

  if (createErr) {
    console.error(`Failed to create bucket "${BUCKET}":`, createErr.message);
    process.exit(1);
  }

  console.log(`✓ Bucket "${BUCKET}" created successfully.`);
}

main().catch(err => { console.error(err); process.exit(1); });
