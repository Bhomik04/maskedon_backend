const test = require("node:test");
const assert = require("node:assert/strict");

const { getTrustLevel, TRUST_LEVELS } = require("../dist/algorithms/social-rating.js");

test("getTrustLevel returns Newcomer for zero events", () => {
  const level = getTrustLevel(0, 0);
  assert.equal(level.name, "Newcomer");
  assert.equal(level.color, "#6B7280");
});

test("getTrustLevel returns Newcomer for zero rating", () => {
  const level = getTrustLevel(0, 5);
  assert.equal(level.name, "Newcomer");
});

test("getTrustLevel returns Wallflower for low ratings", () => {
  const level = getTrustLevel(1.5, 3);
  assert.equal(level.name, "Wallflower");
  assert.equal(level.color, "#EF4444");
});

test("getTrustLevel returns Drifter for 2.0-2.9", () => {
  const level = getTrustLevel(2.5, 5);
  assert.equal(level.name, "Drifter");
});

test("getTrustLevel returns Socialite for 3.0-3.5", () => {
  const level = getTrustLevel(3.2, 4);
  assert.equal(level.name, "Socialite");
});

test("getTrustLevel returns Spark for 3.6-4.2", () => {
  const level = getTrustLevel(4.0, 10);
  assert.equal(level.name, "Spark");
});

test("getTrustLevel returns Luminary for 4.3-4.7", () => {
  const level = getTrustLevel(4.5, 8);
  assert.equal(level.name, "Luminary");
  assert.equal(level.color, "#8B5CF6");
});

test("getTrustLevel returns Inferno for 4.8-5.0", () => {
  const level = getTrustLevel(5.0, 20);
  assert.equal(level.name, "Inferno");
  assert.equal(level.color, "#EC4899");
});

test("TRUST_LEVELS has 7 levels", () => {
  assert.equal(TRUST_LEVELS.length, 7);
});

test("getTrustLevel boundary: exactly 3.6 returns Spark", () => {
  const level = getTrustLevel(3.6, 5);
  assert.equal(level.name, "Spark");
});

test("getTrustLevel boundary: exactly 4.3 returns Luminary", () => {
  const level = getTrustLevel(4.3, 5);
  assert.equal(level.name, "Luminary");
});
