require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

async function clearSupabaseAuthUsers() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let page = 1;
  const perPage = 200;
  let totalDeleted = 0;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`List users failed: ${error.message}`);

    const users = data?.users || [];
    if (users.length === 0) break;

    for (const user of users) {
      const { error: delError } = await supabase.auth.admin.deleteUser(user.id);
      if (delError) {
        throw new Error(`Delete user ${user.id} failed: ${delError.message}`);
      }
      totalDeleted += 1;
    }

    if (users.length < perPage) break;
    page += 1;
  }

  console.log(`Deleted Supabase auth users: ${totalDeleted}`);
}

clearSupabaseAuthUsers().catch((error) => {
  console.error("Supabase auth cleanup failed:", error.message);
  process.exit(1);
});
