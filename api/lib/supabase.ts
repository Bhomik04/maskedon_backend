import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
}

// Storage-only client — never used for auth
const supabaseStorageClient = createClient(supabaseUrl || "", supabaseServiceRoleKey || "");

/**
 * Upload a file buffer to a Supabase Storage bucket.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToStorage(
  bucket: string,
  buffer: Buffer,
  originalName: string,
  mimetype: string
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase() || ".jpg";
  const filePath = `${uuidv4()}${ext}`;

  const { error } = await supabaseStorageClient.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabaseStorageClient.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Delete a file from a Supabase Storage bucket using its public URL.
 */
export async function deleteFromStorage(
  bucket: string,
  publicUrl: string
): Promise<void> {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;

  const filePath = publicUrl.slice(idx + marker.length);
  if (!filePath) return;

  const { error } = await supabaseStorageClient.storage.from(bucket).remove([filePath]);
  if (error) {
    console.warn(`Supabase delete warning (${bucket}/${filePath}): ${error.message}`);
  }
}

/**
 * Upload a file to a PRIVATE Supabase Storage bucket.
 * Returns only the storage path (no public URL — access requires signed URLs).
 */
export async function uploadToPrivateStorage(
  bucket: string,
  userId: string,
  buffer: Buffer,
  originalName: string,
  mimetype: string
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
  const filePath = `${userId}/${uuidv4()}${ext}`;

  const { error } = await supabaseStorageClient.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase private upload failed: ${error.message}`);
  }

  // Return only the internal path — NOT a public URL
  return filePath;
}
