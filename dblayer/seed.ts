import { query } from "./connection";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

async function seed() {
  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash("password123", 12);

  // Create test users
  const users = [
    { email: "riya@example.com", username: "riya_hosts", display_name: "Riya Sharma", bio: "Love hosting rooftop events! 🎉" },
    { email: "arjun@example.com", username: "arjun_explorer", display_name: "Arjun Patel", bio: "New in town, looking for good vibes." },
    { email: "meera@example.com", username: "meera_snaps", display_name: "Meera Kapoor", bio: "Photographer & event lover 📸" },
  ];

  const userIds: string[] = [];

  for (const u of users) {
    const id = uuidv4();
    try {
      await query(
        `INSERT INTO users (id, email, username, password_hash, display_name, bio)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (email) DO NOTHING`,
        [id, u.email, u.username, passwordHash, u.display_name, u.bio]
      );
      // Check if user was actually inserted or already existed
      const result = await query<{ id: string }>(
        `SELECT id FROM users WHERE email = ?`,
        [u.email]
      );
      if (result.rows[0]) {
        userIds.push(result.rows[0].id);
        console.log(`  ✓ Created user: ${u.display_name}`);
      } else {
        console.log(`  — Skipped (exists): ${u.display_name}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed to seed user ${u.display_name}:`, err);
      throw err;
    }
  }

  // Create a test event if we made users
  if (userIds.length >= 1) {
    const hostId = userIds[0];
    const eventId = uuidv4();
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 7); // 1 week from now

    await query(
      `INSERT INTO events (id, host_id, title, description, location_name, location_city, date_time, end_time, max_capacity, ticket_price, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventId,
        hostId,
        "Rooftop Vibes vol. 1",
        "Chill rooftop event with good music and great people. BYOB.",
        "Riya's Terrace, 4th Block Koramangala",
        "Bangalore",
        eventDate.toISOString().slice(0, 19).replace("T", " "),
        new Date(eventDate.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " "),
        30,
        50000, // ₹500 in paisa
        JSON.stringify(["rooftop", "music", "chill"]),
      ]
    );
    console.log("  ✓ Created test event: Rooftop Vibes vol. 1");
  }

  console.log("\n✓ Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
